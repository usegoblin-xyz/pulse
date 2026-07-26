// Mints Anam session tokens for Pulse. Same shape Goblin Labs / Kara use: POST
// a personaConfig to Anam's auth endpoint with the ANAM_API_KEY, get back a
// short-lived session token the browser streams with. The key lives here on the
// server and never in the page.
//
// Everything is env-driven so Pulse reuses the same Anam account as Kara — set
// ANAM_API_KEY to that key and the avatar/voice/prompt below take over.

import { PULSE_SYSTEM_PROMPT } from "./pulse-prompt.js";

const ANAM_BASE = "https://api.anam.ai/v1";

export interface AnamConfig {
  apiKey: string;
  /** If set, mint by reference to a saved Anam persona (voice/prompt come from it). */
  personaId?: string;
  name: string;
  avatarId: string;
  voiceId: string;
  llmId: string;
  avatarModel: string;
  systemPrompt: string;
}

export function anamConfigFromEnv(env = process.env): AnamConfig {
  return {
    apiKey: env.ANAM_API_KEY || "",
    personaId: env.PULSE_PERSONA_ID || undefined,
    name: env.PULSE_NAME || "Pulse",
    // The "Pulse" avatar in the Anam account. (The originally-supplied id
    // a3f92a18… did not exist in the account; this is the real one.) Override
    // with PULSE_AVATAR_ID.
    avatarId: env.PULSE_AVATAR_ID || "a2f0f964-6d5d-4bd9-81fe-973ef6a6215b",
    // The custom "Pulse" voice the user built (from the stored Pulse persona
    // a3f92a18…). Override with PULSE_VOICE_ID.
    voiceId: env.PULSE_VOICE_ID || "96005cba-c7d6-494f-9de9-7cea4d1322b6",
    // Anam's built-in LLM (same default Goblin Labs uses), so the system prompt
    // below actually drives the conversation.
    llmId: env.PULSE_LLM_ID || "a7cf662c-2ace-4de1-a21e-ef0fbf144bb7",
    // The Pulse avatar only ships cara-4 (no cara-3), so pin cara-4 — passing a
    // version the avatar doesn't have makes Anam reject the session at connect.
    avatarModel: env.PULSE_AVATAR_MODEL || "cara-4",
    systemPrompt: env.PULSE_SYSTEM_PROMPT || PULSE_SYSTEM_PROMPT,
  };
}

// Declared to Anam at mint time so Pulse's LLM knows it can call them. The
// handlers run client-side in pulse.js and call the brain's /research endpoints.
// Anam honors inline tool defs on ephemeral mints, so no pre-created tool needed.

// Pulse searches the live web. Returns a short list of sources with snippets
// (and, with Tavily, a synthesized answer) he can read back and reason over.
export const WEB_SEARCH_TOOL = {
  type: "client",
  name: "web_search",
  description:
    "Search the live web for current information. Call this whenever the user asks a question whose answer you are not certain of, asks about anything recent, or asks you to look something up, find, research, compare, or check the facts on a topic. Returns a short list of sources (title, web address, and a snippet) and sometimes a quick answer. Read the snippets, and if you need more depth call read_page on the most promising source before you reply.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "what to search the web for" } },
    required: ["query"],
  },
  awaitResult: true,
} as const;

// Pulse opens one page and reads it in full (server-side headless browser).
export const READ_PAGE_TOOL = {
  type: "client",
  name: "read_page",
  description:
    "Open one specific web page and read it in full. Call this after web_search when the snippets are not enough and you need the details from a source, or the moment the user gives you a web address and asks what it says or to summarize it. Returns the page's title and its readable text. Use what you read to answer, and say which source it came from.",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "the web address of the page to read" } },
    required: ["url"],
  },
  awaitResult: true,
} as const;

// Pulse researches a topic and writes a full product requirements document,
// surfaced to the user as a downloadable document. Handler in pulse.js.
export const BUILD_PRD_TOOL = {
  type: "client",
  name: "build_prd",
  description:
    "Research a product idea and write a detailed product requirements document (a PRD) for it, then surface it to the user to read and download. Call this whenever the user asks you to build, write, spin up, or draft a PRD, a product spec, a requirements doc, or a feature plan, or points you at a product or website and asks for a spec or a plan to build something like it. Pass the product idea as topic, and if the user pointed you at a specific web page, pass its address as url. You do the web research yourself. Returns the document's title and a short summary you should read back.",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", description: "the product idea or thing to spec, in a sentence" },
      url: { type: "string", description: "optional web address the user pointed at, to base the PRD on" },
    },
    required: ["topic"],
  },
  awaitResult: true,
} as const;

// Lets Pulse actually look at the shared screen (a vision model reads a
// screenshot). Handler is registered client-side in pulse.js.
export const LOOK_AT_SCREEN_TOOL = {
  type: "client",
  name: "look_at_screen",
  description:
    "Look at the user's shared screen and describe what is on it. Call this the moment the user shares their screen, asks what you see or what is on their screen, or before filling a form you have not looked at yet. Returns a plain description of the screen, including any form's heading and the fields it asks for.",
  parameters: { type: "object", properties: {}, required: [] },
  awaitResult: true,
} as const;

/** Pure: the personaConfig we send to Anam. Split out so it's unit-testable. */
export function buildPersonaConfig(cfg: AnamConfig): Record<string, unknown> {
  if (cfg.personaId) return { personaId: cfg.personaId };
  return {
    name: cfg.name,
    avatarId: cfg.avatarId,
    voiceId: cfg.voiceId,
    llmId: cfg.llmId,
    avatarModel: cfg.avatarModel,
    systemPrompt: cfg.systemPrompt,
    tools: [WEB_SEARCH_TOOL, READ_PAGE_TOOL, BUILD_PRD_TOOL, LOOK_AT_SCREEN_TOOL],
  };
}

export async function mintSessionToken(cfg: AnamConfig): Promise<string> {
  if (!cfg.apiKey) throw new Error("ANAM_API_KEY not set");
  const res = await fetch(`${ANAM_BASE}/auth/session-token`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ personaConfig: buildPersonaConfig(cfg) }),
  });
  if (!res.ok) throw new Error(`anam ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const token = data?.sessionToken ?? data?.token;
  if (!token) throw new Error("anam returned no session token");
  return token;
}
