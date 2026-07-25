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

// Declared to Anam at mint time so Pulse's LLM knows it can call it. The
// browser handler that runs when Pulse invokes it is registered client-side in
// pulse.js (it scans the page, plans the fill, and types the values in). Anam
// honors inline tool defs on ephemeral mints, so no pre-created tool is needed.
export const FILL_FORM_TOOL = {
  type: "client",
  name: "fill_form",
  description:
    "Fill the form on the user's current screen from their saved details. Call this the moment the user asks you to fill out, complete, or auto-fill a form. It reads the visible form's fields, fills the ones it can, and NEVER submits. Returns a short summary of what was filled and what still needs the user (including any password or payment field, which you must never fill).",
  parameters: { type: "object", properties: {}, required: [] },
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

// Memory: Pulse collects the user's common form details conversationally and
// keeps them on the user's own device (localStorage on the page). Summoned on
// demand to help fill forms — no extension, no install. Handlers in pulse.js.
export const SAVE_DETAILS_TOOL = {
  type: "client",
  name: "save_details",
  description:
    "Remember details the user gives you (name, email, phone, address, company, job title, etc.) so you can help them fill forms later. Call this whenever the user tells you a detail worth keeping. Never save a password, card number, or other secret. Pass the details as key/value pairs.",
  parameters: {
    type: "object",
    properties: {
      details: { type: "object", description: 'e.g. {"fullName":"Ada Lovelace","email":"ada@x.com","city":"London"}' },
    },
    required: ["details"],
  },
  awaitResult: true,
} as const;

export const RECALL_DETAILS_TOOL = {
  type: "client",
  name: "recall_details",
  description:
    "Get the details you have saved for this user, so you can tell them what goes in each form field. Returns the saved key/value pairs (or nothing if this is a first visit).",
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
    tools: [FILL_FORM_TOOL, LOOK_AT_SCREEN_TOOL, SAVE_DETAILS_TOOL, RECALL_DETAILS_TOOL],
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
