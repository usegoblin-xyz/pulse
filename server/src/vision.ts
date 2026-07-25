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

// --- computer-use loop: pick the next action from a marked-up screenshot ---

const AGENT_PROMPT = `You are Pulse, filling a web form for a user by choosing ONE next action at a time. You get a screenshot with numbered boxes drawn on the interactive elements, the list of those elements, the user's saved details, and the actions you have already taken.

Reply with ONLY a JSON object for the SINGLE next action:
{"action":"type","element":<n>,"value":"<text>","why":"..."}   type text into a field
{"action":"click","element":<n>,"why":"..."}                    click a button, open a dropdown, or pick an option that appeared
{"action":"select","element":<n>,"value":"<option text>","why":"..."}  choose an option in a native dropdown
{"action":"done","why":"..."}                                    when every field you can fill is filled

Rules:
- NEVER type into a password, card number, CVV, or other secret field. Leave those for the user.
- Only use values from the user's details. Never invent a value.
- For an autocomplete field (city, address), type the value, then on the NEXT turn click the matching option that appeared in the screenshot.
- NEVER click a submit, create, sign up, continue, pay, or next button. Only fill fields.
- Do not repeat an action already in the history. If a field is already filled correctly, move on.
- When nothing else can be filled, return done.`;

export interface AgentContext {
  elements: Array<{ n: number; tag: string; type?: string; label?: string; value?: string }>;
  profile: Record<string, string>;
  history: Array<{ action: string; element?: number; value?: string }>;
}

function parseJson(raw: string): any {
  const s = (raw || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

export async function planAction(
  screenshot: string,
  ctx: AgentContext,
  cfg: VisionConfig,
): Promise<any> {
  const text =
    AGENT_PROMPT +
    "\n\nElements:\n" + JSON.stringify(ctx.elements) +
    "\n\nUser details:\n" + JSON.stringify(ctx.profile) +
    "\n\nActions already taken:\n" + JSON.stringify(ctx.history);
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      // Reasoning VLMs (GLM-4.5V) spend most tokens on hidden reasoning before
      // the JSON answer, so keep the budget generous or the answer gets cut off.
      max_tokens: 1500,
      temperature: 0,
      messages: [
        { role: "user", content: [
          { type: "text", text },
          { type: "image_url", image_url: { url: screenshot } },
        ] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`agent ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return parseJson(data?.choices?.[0]?.message?.content ?? "");
}

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
