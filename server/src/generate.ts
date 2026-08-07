// Pulse's writing faculty. Turns a topic (and whatever he can read on the web)
// into a full product requirements document. Reuses the Gemini text endpoint
// (the same key as vision) so no new secret is needed — the model just writes
// prose here instead of reading an image.
//
// Reliability note: the generation model is often a flaky, rate-limited, or
// free-tier endpoint (e.g. an OpenRouter :free model). A demo cannot afford a
// blank document or a spinner that never finishes, so every call here is wrapped
// in a timeout + retry, and the streaming path falls back to a plain completion
// if the stream comes back empty. The result is either a real PRD or a clean,
// surfaced error — never a silent blank.

import { search, readPage, searchConfigFromEnv } from "./research.js";

// PRD writing needs a capable TEXT model, which the self-hosted vision VLM
// (moondream) is not. So generation reads its own config: PULSE_GEN_* if set,
// else the legacy PULSE_VISION_* (a hosted text/multimodal model). It never uses
// PULSE_VLM_*, so pointing vision at moondream doesn't break document writing.
let warnedWeakModel = false;
function genConfigFromEnv(env = process.env) {
  const usingGenKey = !!env.PULSE_GEN_API_KEY;
  const model = env.PULSE_GEN_MODEL || env.PULSE_VISION_MODEL || "glm-4.6-flash";
  // One-time nudge: writing full PRDs on a free/vision-tuned model is the usual
  // cause of intermittent empty or truncated output. Point PULSE_GEN_* at a real
  // text model for a reliable demo.
  if (!warnedWeakModel && !usingGenKey && (/:free$/i.test(model) || /-vl\b|vision|nemotron-nano/i.test(model))) {
    warnedWeakModel = true;
    console.warn(`[generate] PRD writing is using the vision model "${model}" — this is flaky for long documents. Set PULSE_GEN_API_KEY / PULSE_GEN_MODEL to a dedicated text model for reliable generation.`);
  }
  return {
    baseUrl: (env.PULSE_GEN_BASE_URL || env.PULSE_VISION_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, ""),
    apiKey: env.PULSE_GEN_API_KEY || env.PULSE_VISION_API_KEY || "",
    model,
  };
}

// --- network hardening ---------------------------------------------------

// Statuses worth another try: rate limits and transient upstream errors. A 4xx
// like 400/401/404 is a real misconfiguration and is surfaced immediately.
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const GEN_ATTEMPTS = 3;             // total tries per generation (1 + 2 retries)
const CONNECT_TIMEOUT_MS = 45_000;  // waiting for the first byte / full non-stream body
const STREAM_IDLE_MS = 30_000;      // abort a stream only after this long with no data

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// Exponential backoff with jitter, so parallel retries don't sync up.
function backoffMs(attempt: number): number {
  return Math.min(6000, 600 * 2 ** attempt) + Math.floor(Math.random() * 300);
}

interface GenCfg { baseUrl: string; apiKey: string; model: string; }

function chatBody(cfg: GenCfg, system: string, user: string, maxTokens: number, stream: boolean) {
  return JSON.stringify({
    model: cfg.model,
    temperature: 0.4,
    // Generous: a full PRD plus the model's hidden reasoning must both fit, or
    // the answer comes back truncated or empty.
    max_tokens: maxTokens,
    ...(stream ? { stream: true } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
}

// POST a chat request with a total timeout, retrying transient failures. Returns
// the raw Response (for streaming, the caller pumps res.body; the timeout only
// covers connection here, and streaming re-arms an idle watchdog while reading).
async function openChat(cfg: GenCfg, body: string, timeoutMs: number): Promise<{ res: Response; ac: AbortController }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < GEN_ATTEMPTS; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body,
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < GEN_ATTEMPTS - 1) { await sleep(backoffMs(attempt)); continue; }
      throw new Error(`generate request failed: ${(e as any)?.message ?? e}`);
    }
    clearTimeout(timer);

    if (res.ok) return { res, ac };

    // Drain the error body so the socket can be reused, and keep a snippet.
    const detail = await res.text().catch(() => "");
    if (res.status === 429) {
      if (attempt < GEN_ATTEMPTS - 1) { await sleep(backoffMs(attempt)); continue; }
      throw new Error("RATE_LIMIT");
    }
    if (RETRYABLE.has(res.status) && attempt < GEN_ATTEMPTS - 1) {
      lastErr = new Error(`generate ${res.status}`);
      await sleep(backoffMs(attempt));
      continue;
    }
    throw new Error(`generate ${res.status}: ${detail.slice(0, 200)}`);
  }
  throw new Error(`generate: retries exhausted${lastErr ? ` (${(lastErr as any)?.message ?? lastErr})` : ""}`);
}

// A plain text generation over an OpenAI-compatible endpoint (timed + retried).
async function generateText(system: string, user: string, maxTokens = 8000): Promise<string> {
  const cfg = genConfigFromEnv();
  if (!cfg.apiKey) throw new Error("generation not configured (no gen/vision key)");
  const { res } = await openChat(cfg, chatBody(cfg, system, user, maxTokens, false), CONNECT_TIMEOUT_MS);
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// A finished PRD is long and multi-section; anything shorter than this is an
// empty or half-dead completion and should trigger the non-streaming fallback.
const MIN_PRD_CHARS = 300;
export function isUsablePrd(markdown: string): boolean {
  return markdown.trim().length >= MIN_PRD_CHARS;
}

// Read an OpenAI-compatible SSE stream, handing each text delta to onToken. An
// idle watchdog (re-armed on every chunk) aborts a stalled stream without
// cutting a healthy one that is simply long. Throws if the stream is aborted.
async function pumpStream(res: Response, ac: AbortController, onToken: (t: string) => void): Promise<string> {
  let full = "";
  const reader = (res.body as any).getReader();
  const dec = new TextDecoder();
  let buf = "";
  let idle = setTimeout(() => ac.abort(new Error("idle timeout")), STREAM_IDLE_MS);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(idle);
      idle = setTimeout(() => ac.abort(new Error("idle timeout")), STREAM_IDLE_MS);
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // ignore ": keep-alive" comments
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const t = j?.choices?.[0]?.delta?.content;
          if (t) { full += t; onToken(t); }
        } catch { /* keep-alive or partial line */ }
      }
    }
  } finally {
    clearTimeout(idle);
  }
  return full;
}

// Streaming generation with a safety net: stream the doc as it writes, but if the
// stream errors early or comes back empty (common on flaky/free models), fall
// back to a single non-streaming completion so the user still gets a real PRD.
async function generateTextStream(
  system: string,
  user: string,
  onToken: (t: string) => void,
  maxTokens = 8000,
): Promise<string> {
  const cfg = genConfigFromEnv();
  if (!cfg.apiKey) throw new Error("generation not configured (no gen/vision key)");

  let full = "";
  try {
    const { res, ac } = await openChat(cfg, chatBody(cfg, system, user, maxTokens, true), CONNECT_TIMEOUT_MS);
    if (!res.body) {
      // Endpoint ignored stream:true — take the whole thing at once.
      const t = await generateText(system, user, maxTokens);
      if (t) onToken(t);
      return t;
    }
    full = await pumpStream(res, ac, onToken);
  } catch (e: any) {
    if (String(e?.message) === "RATE_LIMIT") throw e; // let the caller show a rate-limit message
    console.error("[generate] stream failed, falling back to non-streaming:", e?.message ?? e);
  }

  if (isUsablePrd(full)) return full;

  // Stream was empty or too thin — one non-streaming attempt (itself retried).
  const fallback = (await generateText(system, user, maxTokens)).trim();
  if (fallback.length > full.trim().length) {
    // Nothing was shown yet -> paint the whole thing; otherwise the SSE 'done'
    // event carries the final markdown and reconciles any partial on screen.
    if (!full.trim()) onToken(fallback);
    return fallback;
  }
  if (full.trim()) return full; // a partial doc still beats nothing
  throw new Error("empty generation");
}

const PRD_SYSTEM = `You are a senior product manager who writes crisp, buildable product requirements documents (PRDs). You write in clean Markdown. Given a product idea or a reference to research, produce a COMPLETE, detailed PRD a small team could start building from.

Always use exactly these sections, as level-two Markdown headings, in this order:
## Summary
## Problem & Opportunity
## Goals and Non-Goals
## Target Users & Personas
## Key Features
## User Stories
## Functional Requirements
## Non-Functional Requirements
## Milestones & Phases
## Risks & Open Questions
## Success Metrics

Rules:
- Under Key Features, list each feature as its own bold sub-item with a two to four sentence description and a priority of P0, P1, or P2. Be specific and concrete, not generic.
- Under User Stories, use the form "As a <user>, I want <capability>, so that <benefit>."
- Ground the document in the research context provided. If the context shows what real products in this space do, reflect and improve on it. Do not invent fake statistics or fake sources.
- Be thorough and opinionated. Prefer specifics over hand-waving. No preamble, no closing remarks, start directly with the title as a level-one heading (# ...).`;

export interface PrdSource { title: string; url: string; }
export interface PrdResult { title: string; markdown: string; sources: PrdSource[]; }

// Race a promise against a deadline, returning a fallback value if it is too
// slow. Used so research can never stall the start of the document.
async function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  try { return await Promise.race([p, timeout]); }
  finally { clearTimeout(timer!); }
}

// Shared grounding: read a pointed-at page and/or search the topic, returning the
// research context string and the sources list. `deep` reads the top search hit
// in full (better grounding, but slow via Playwright) — off for streaming so the
// doc starts appearing in seconds instead of after a long silent research pause.
// Every step is best-effort and time-boxed: generation must proceed even if the
// web is slow or down, so a research hiccup can never block the PRD.
async function gatherPrdContext(topic: string, url?: string, deep = true): Promise<{ context: string; sources: PrdSource[] }> {
  const sources: PrdSource[] = [];
  let context = "";
  const READ_MS = 20_000;
  const SEARCH_MS = 15_000;

  if (url && /^https?:\/\//.test(url)) {
    const page = await withDeadline(readPage(url).catch(() => null), READ_MS, null);
    if (page) {
      sources.push({ title: page.title, url: page.url });
      context += `Reference page — ${page.title} (${page.url}):\n${page.text.slice(0, 5000)}\n\n`;
    }
  }

  const found = await withDeadline(
    search(topic, searchConfigFromEnv(), 5).catch(() => null),
    SEARCH_MS,
    null,
  );
  if (found) {
    for (const r of found.results.slice(0, 5)) {
      sources.push({ title: r.title, url: r.url });
      context += `Source — ${r.title} (${r.url}):\n${r.snippet}\n\n`;
    }
    const top = found.results[0];
    if (deep && top && !url) {
      const page = await withDeadline(readPage(top.url).catch(() => null), READ_MS, null);
      if (page) context += `Top source read in full — ${page.title}:\n${page.text.slice(0, 4000)}\n\n`;
    }
  }

  return { context, sources };
}

function prdUserPrompt(topic: string, context: string): string {
  return `Product idea / topic: ${topic}\n\n` +
    (context ? `Research context you must ground the PRD in:\n\n${context}` : `No research context was available; write the PRD from the topic and your product judgment.`);
}

function titleFrom(markdown: string, topic: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return (m ? m[1] : `PRD: ${topic}`).trim();
}

export async function writePrd(topic: string, url?: string): Promise<PrdResult> {
  const { context, sources } = await gatherPrdContext(topic, url);
  const markdown = (await generateText(PRD_SYSTEM, prdUserPrompt(topic, context))).trim();
  if (!isUsablePrd(markdown)) throw new Error("empty generation");
  return { title: titleFrom(markdown, topic), markdown, sources };
}

// Streaming variant: research first (onSources), then stream the doc (onToken).
export async function writePrdStream(
  topic: string,
  url: string | undefined,
  hooks: { onSources: (s: PrdSource[]) => void; onToken: (t: string) => void },
): Promise<PrdResult> {
  const { context, sources } = await gatherPrdContext(topic, url, false); // snippets only -> fast start
  hooks.onSources(sources);
  const markdown = (await generateTextStream(PRD_SYSTEM, prdUserPrompt(topic, context), hooks.onToken)).trim();
  return { title: titleFrom(markdown, topic), markdown, sources };
}
