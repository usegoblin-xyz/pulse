// Pulse's writing faculty. Turns a topic (and whatever he can read on the web)
// into a full product requirements document. Reuses the Gemini text endpoint
// (the same key as vision) so no new secret is needed — the model just writes
// prose here instead of reading an image.

import { search, readPage, searchConfigFromEnv } from "./research.js";

// PRD writing needs a capable TEXT model, which the self-hosted vision VLM
// (moondream) is not. So generation reads its own config: PULSE_GEN_* if set,
// else the legacy PULSE_VISION_* (a hosted text/multimodal model). It never uses
// PULSE_VLM_*, so pointing vision at moondream doesn't break document writing.
function genConfigFromEnv(env = process.env) {
  return {
    baseUrl: (env.PULSE_GEN_BASE_URL || env.PULSE_VISION_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, ""),
    apiKey: env.PULSE_GEN_API_KEY || env.PULSE_VISION_API_KEY || "",
    model: env.PULSE_GEN_MODEL || env.PULSE_VISION_MODEL || "glm-4.6-flash",
  };
}

// A plain text generation over an OpenAI-compatible endpoint.
async function generateText(system: string, user: string, maxTokens = 6000): Promise<string> {
  const cfg = genConfigFromEnv();
  if (!cfg.apiKey) throw new Error("generation not configured (no gen/vision key)");
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      // Generous: a full PRD plus the model's hidden reasoning must both fit,
      // or the answer comes back truncated or empty.
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error(`generate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// Streaming generation: parse the OpenAI-compatible SSE and hand each text
// delta to onToken as it arrives. Returns the full text at the end.
async function generateTextStream(
  system: string,
  user: string,
  onToken: (t: string) => void,
  maxTokens = 6000,
): Promise<string> {
  const cfg = genConfigFromEnv();
  if (!cfg.apiKey) throw new Error("generation not configured (no gen/vision key)");
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      max_tokens: maxTokens,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error(`generate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (!res.body) return generateText(system, user, maxTokens); // no stream support -> fallback

  let full = "";
  const reader = (res.body as any).getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const t = j?.choices?.[0]?.delta?.content;
        if (t) { full += t; onToken(t); }
      } catch { /* keep-alive or partial line */ }
    }
  }
  return full;
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

// Shared grounding: read a pointed-at page and/or search the topic, returning the
// research context string and the sources list. `deep` reads the top search hit
// in full (better grounding, but slow via Playwright) — off for streaming so the
// doc starts appearing in seconds instead of after a long silent research pause.
async function gatherPrdContext(topic: string, url?: string, deep = true): Promise<{ context: string; sources: PrdSource[] }> {
  const sources: PrdSource[] = [];
  let context = "";

  if (url && /^https?:\/\//.test(url)) {
    try {
      const page = await readPage(url);
      sources.push({ title: page.title, url: page.url });
      context += `Reference page — ${page.title} (${page.url}):\n${page.text.slice(0, 5000)}\n\n`;
    } catch { /* fall back to search-only grounding */ }
  }

  try {
    const found = await search(topic, searchConfigFromEnv(), 5);
    for (const r of found.results.slice(0, 5)) {
      sources.push({ title: r.title, url: r.url });
      context += `Source — ${r.title} (${r.url}):\n${r.snippet}\n\n`;
    }
    const top = found.results[0];
    if (deep && top && !url) {
      try { const page = await readPage(top.url); context += `Top source read in full — ${page.title}:\n${page.text.slice(0, 4000)}\n\n`; }
      catch { /* snippet is enough */ }
    }
  } catch { /* generation can still proceed from the topic alone */ }

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
