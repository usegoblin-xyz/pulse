// Model adapter. Deliberately just an OpenAI-compatible chat call, so the same
// code drives Z.ai GLM (the free GLM-4.6V/Flash tier), Gemini's OpenAI
// endpoint, OpenRouter, Groq, a local server, or Claude — swap by env, never by
// rewrite. Config is all environment-driven; the key lives here on the server
// and never in the browser extension.

import type { ModelClient } from "./planner.js";

export interface ModelConfig {
  baseUrl: string; // e.g. https://api.z.ai/api/paas/v4
  apiKey: string;
  model: string; // e.g. glm-4.6-flash
}

export function modelConfigFromEnv(env = process.env): ModelConfig {
  return {
    baseUrl: (env.PULSE_MODEL_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, ""),
    apiKey: env.PULSE_MODEL_API_KEY || "",
    model: env.PULSE_MODEL || "glm-4.6-flash",
  };
}

export function makeOpenAIModel(cfg: ModelConfig): ModelClient {
  return {
    async complete(system, user) {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content ?? "";
    },
  };
}
