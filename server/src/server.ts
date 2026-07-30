// The key-holding proxy. The extension can't carry the model API key (it ships
// to users' browsers), so it POSTs form fields + profile here and gets back a
// FillPlan. Zero runtime dependencies — Node's built-in http + global fetch.
//
//   POST /plan-fill   { fields: FormField[], profile: Profile }  -> FillPlan
//   GET  /health      -> { ok: true }

import http from "node:http";
import { planFill } from "./planner.js";
import { makeOpenAIModel, modelConfigFromEnv } from "./model.js";
import type { FormField, Profile } from "./types.js";

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY = 256 * 1024; // form field metadata is small; cap to refuse abuse
// Comma-separated allowlist of extension origins, e.g.
// "chrome-extension://<id>". Empty = reflect any chrome-extension origin (dev).
const ALLOWED = (process.env.PULSE_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const model = makeOpenAIModel(modelConfigFromEnv());

function corsOrigin(origin?: string): string | null {
  if (!origin) return null;
  if (ALLOWED.length) return ALLOWED.includes(origin) ? origin : null;
  return origin.startsWith("chrome-extension://") ? origin : null; // dev default
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new Error("payload too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = corsOrigin(req.headers.origin as string | undefined);
  const cors: Record<string, string> = origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        vary: "origin",
      }
    : {};

  if (req.method === "OPTIONS") {
    res.writeHead(origin ? 204 : 403, cors).end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/plan-fill") {
    res.writeHead(404, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "not found" }));
    return;
  }

  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const fields: FormField[] = Array.isArray(body.fields) ? body.fields.slice(0, 300) : [];
    const profile: Profile = body.profile && typeof body.profile === "object" ? body.profile : {};
    const plan = await planFill(fields, profile, model);
    res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify(plan));
  } catch (e: any) {
    console.error("[plan-fill]", e?.message ?? e);
    res.writeHead(400, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "could not plan fill" }));
  }
});

server.listen(PORT, () => console.log(`pulse brain on :${PORT}`));
