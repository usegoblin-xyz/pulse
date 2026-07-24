// The key-holding proxy. Two secrets it holds so the browser never has to: the
// model API key (for /plan-fill) and the Anam API key (for /session-token). It
// also serves the Pulse landing page in dev, so page + endpoints are one origin
// and "Start conversation" just works. Zero runtime deps — Node http + fetch.
//
//   POST /plan-fill      { fields, profile }  -> { fills, asks }
//   POST /session-token  -> { sessionToken }   (Anam, persona = Pulse)
//   GET  /health         -> { ok: true }
//   GET  /*              -> static file from ../site (dev convenience)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planFill } from "./planner.js";
import { makeOpenAIModel, modelConfigFromEnv } from "./model.js";
import { mintSessionToken, anamConfigFromEnv } from "./anam.js";
import { describeScreen, visionConfigFromEnv } from "./vision.js";
import type { FormField, Profile } from "./types.js";

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY = 256 * 1024; // form field metadata is small; cap to refuse abuse

// Web origins allowed to call the API cross-origin (when the page is hosted
// apart from this server, e.g. GitHub Pages). Same-origin dev needs nothing here.
const WEB_ORIGINS = (process.env.PULSE_WEB_ORIGINS || "https://usegoblin-xyz.github.io")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/src/server.js -> repo/site
const SITE_DIR = process.env.PULSE_SITE_DIR || path.resolve(__dirname, "../../../site");

// The model is optional: with no key, /plan-fill runs heuristic-only (still
// fills standard fields for free). With a key, the model handles leftovers.
const modelCfg = modelConfigFromEnv();
const model = modelCfg.apiKey ? makeOpenAIModel(modelCfg) : null;

// Minimal per-IP rate limit for /session-token — it mints paid Anam sessions
// on a public endpoint, so cap how fast one caller can spend. In-memory, which
// is fine on a single machine (the only way this app is meant to run).
const RL_MAX = Number(process.env.PULSE_SESSION_RATE_MAX || 40); // per window
const RL_WINDOW_MS = Number(process.env.PULSE_SESSION_RATE_WINDOW_MS || 10 * 60 * 1000);
const rlHits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const fresh = (rlHits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  fresh.push(now);
  rlHits.set(ip, fresh);
  return fresh.length > RL_MAX;
}
function clientIp(req: http.IncomingMessage): string {
  const fwd = (req.headers["x-forwarded-for"] as string) || "";
  return fwd.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function allowOrigin(origin?: string): string | null {
  if (!origin) return null;
  if (origin.startsWith("chrome-extension://")) return origin; // the extension
  if (origin.startsWith("http://localhost")) return origin; // dev
  return WEB_ORIGINS.includes(origin) ? origin : null;
}

function readBody(req: http.IncomingMessage, max = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) reject(new Error("payload too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const vision = visionConfigFromEnv();

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(urlPath: string, res: http.ServerResponse) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const abs = path.resolve(SITE_DIR, rel);
  if (!abs.startsWith(SITE_DIR + path.sep) && abs !== path.join(SITE_DIR, "index.html")) {
    res.writeHead(403).end("forbidden"); // path traversal guard
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    const ext = path.extname(abs);
    // App logic (html/js) must always revalidate so a deploy is picked up
    // immediately — a stale cached pulse.js is a debugging nightmare. Heavy
    // media (video/images/fonts) is content-stable, so cache it hard.
    const codeExt = ext === ".html" || ext === ".js" || ext === ".mjs";
    const cache = codeExt ? "no-cache" : "public, max-age=86400";
    res
      .writeHead(200, {
        "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
        "cache-control": cache,
      })
      .end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = allowOrigin(req.headers.origin as string | undefined);
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

  // --- Anam: mint a Pulse session token ---
  if (req.method === "POST" && req.url === "/session-token") {
    if (rateLimited(clientIp(req))) {
      res.writeHead(429, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "slow down" }));
      return;
    }
    try {
      const sessionToken = await mintSessionToken(anamConfigFromEnv());
      res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify({ sessionToken }));
    } catch (e: any) {
      console.error("[session-token]", e?.message ?? e);
      res.writeHead(502, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "could not start session" }));
    }
    return;
  }

  // --- vision: describe the user's shared screen ---
  if (req.method === "POST" && req.url === "/see") {
    if (!vision.apiKey) {
      res.writeHead(503, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "vision not configured" }));
      return;
    }
    try {
      const body = JSON.parse((await readBody(req, 8 * 1024 * 1024)) || "{}"); // screenshots are big
      const image = String(body.image || "");
      if (!image.startsWith("data:image/")) {
        res.writeHead(400, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "image required" }));
        return;
      }
      const text = await describeScreen(image, body.question ? String(body.question) : undefined, vision);
      res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify({ text }));
    } catch (e: any) {
      console.error("[see]", e?.message ?? e);
      res.writeHead(502, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "could not read the screen" }));
    }
    return;
  }

  // --- form-fill planner ---
  if (req.method === "POST" && req.url === "/plan-fill") {
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
    return;
  }

  // --- static landing page (dev) ---
  if (req.method === "GET" && req.url) {
    serveStatic(req.url, res);
    return;
  }

  res.writeHead(404, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => console.log(`pulse brain on http://localhost:${PORT}`));
