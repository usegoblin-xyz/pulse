// Pulse's eyes. Takes a screenshot (data URL) from the shared screen and asks a
// vision model to describe it, so Pulse can tell the user what's on their screen
// before filling anything. OpenAI-compatible, so it works with Z.ai's free
// GLM-4.6V, Google Gemini Flash, OpenRouter, etc. — swap by env, and it's the
// only place a vision key lives (never in the browser).

export interface VisionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function visionConfigFromEnv(env = process.env): VisionConfig {
  return {
    baseUrl: (env.PULSE_VISION_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, ""),
    apiKey: env.PULSE_VISION_API_KEY || "",
    model: env.PULSE_VISION_MODEL || "glm-4.6v",
  };
}

const DEFAULT_PROMPT =
  "Look at this screen. In two or three short spoken sentences, say what app or page it is, and if there is a form, its heading and the main fields it is asking for. Plain speech, no markdown, no lists.";

export async function describeScreen(
  dataUrl: string,
  question: string | undefined,
  cfg: VisionConfig,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question || DEFAULT_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}
