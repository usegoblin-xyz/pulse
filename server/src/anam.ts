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
    // Laurent — "Dependable Anchor", strong and steady, fits Pulse's calm edge.
    // Other male voices in the account: Archie 91b4ce0f-…, Corey 91a47e5a-…,
    // Cooper 90c1fb05-… (all share the -4fc0-11f1-84b0-52bacf74fa75 suffix).
    voiceId: env.PULSE_VOICE_ID || "8e67ed57-4fc0-11f1-84b0-52bacf74fa75",
    // Anam's built-in LLM (same default Goblin Labs uses), so the system prompt
    // below actually drives the conversation.
    llmId: env.PULSE_LLM_ID || "a7cf662c-2ace-4de1-a21e-ef0fbf144bb7",
    // The Pulse avatar only ships cara-4 (no cara-3), so pin cara-4 — passing a
    // version the avatar doesn't have makes Anam reject the session at connect.
    avatarModel: env.PULSE_AVATAR_MODEL || "cara-4",
    systemPrompt: env.PULSE_SYSTEM_PROMPT || PULSE_SYSTEM_PROMPT,
  };
}

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
