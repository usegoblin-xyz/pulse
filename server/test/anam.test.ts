import { test } from "node:test";
import assert from "node:assert/strict";
import { anamConfigFromEnv, buildPersonaConfig } from "../src/anam.js";
import { PULSE_SYSTEM_PROMPT } from "../src/pulse-prompt.js";

test("default persona config is Pulse: given avatar, a real voice, the prompt", () => {
  const cfg = anamConfigFromEnv({} as NodeJS.ProcessEnv);
  const pc = buildPersonaConfig(cfg) as Record<string, string>;
  assert.equal(pc.name, "Pulse");
  assert.equal(pc.avatarId, "a3f92a18-ff4b-405d-9c40-de4acf96f0e4");
  assert.equal(pc.voiceId, "8e67ed57-4fc0-11f1-84b0-52bacf74fa75"); // Laurent
  assert.equal(pc.systemPrompt, PULSE_SYSTEM_PROMPT);
  assert.ok(!("personaId" in pc));
});

test("env overrides win (avatar, voice, prompt)", () => {
  const cfg = anamConfigFromEnv({
    PULSE_AVATAR_ID: "avatar-x",
    PULSE_VOICE_ID: "voice-y",
    PULSE_SYSTEM_PROMPT: "custom",
  } as unknown as NodeJS.ProcessEnv);
  const pc = buildPersonaConfig(cfg) as Record<string, string>;
  assert.equal(pc.avatarId, "avatar-x");
  assert.equal(pc.voiceId, "voice-y");
  assert.equal(pc.systemPrompt, "custom");
});

test("PULSE_PERSONA_ID mints by reference (voice/prompt come from the saved persona)", () => {
  const cfg = anamConfigFromEnv({ PULSE_PERSONA_ID: "persona-123" } as unknown as NodeJS.ProcessEnv);
  const pc = buildPersonaConfig(cfg);
  assert.deepEqual(pc, { personaId: "persona-123" });
});
