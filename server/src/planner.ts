// The heart of Milestone 1: turn a page's form fields + the user's profile into
// a set of proposed fills. Pure and model-injected so it is fully unit-testable
// with a fake model. Every safety property Pulse promises lives here, enforced
// by construction rather than by trusting the model:
//
//   1. Sensitive fields (passwords, card numbers, SSNs) are never sent to the
//      model and never auto-filled — they become "asks".
//   2. Only values for known, non-sensitive field ids survive; hallucinated
//      ids are dropped.
//   3. Select/radio values must be one of the real options.
//   4. The output type (FillPlan) cannot express "submit", so nothing here can.

import type { FormField, Profile, FillPlan, FillItem, AskItem } from "./types.js";
import { isSensitive } from "./sensitive.js";

export interface ModelClient {
  /** Returns the model's raw text reply (expected to be a JSON object). */
  complete(system: string, user: string): Promise<string>;
}

export const SYSTEM_PROMPT = [
  "You map web form fields to a person's saved profile so they don't retype it.",
  "You are given `fields` (each with an id, label, type, and optional options) and `profile` (their details).",
  'Reply with ONLY a JSON object: {"fills":[{"fieldId":"<id>","value":"<string>"}]}.',
  "Rules:",
  "- Only use ids present in `fields`. Never invent an id.",
  "- Only fill a field when the profile clearly supplies the value. If unsure, omit it.",
  "- Never guess, fabricate, or infer sensitive data.",
  "- For a field with `options`, value MUST be exactly one of those options.",
  "- Do not include anything except the fills array. You cannot submit or navigate; that is not your job.",
].join("\n");

/** Strip code fences / prose and parse the first JSON object the model emitted. */
function safeParseObject(raw: string): any {
  if (!raw) return null;
  const fenced = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(fenced);
  } catch {
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(fenced.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/** What we expose to the model — never includes the `sensitive` flag's targets. */
function publicField(f: FormField) {
  return {
    id: f.id,
    ...(f.label ? { label: f.label } : {}),
    ...(f.name ? { name: f.name } : {}),
    type: f.type,
    ...(f.options?.length ? { options: f.options } : {}),
    ...(f.required ? { required: true } : {}),
  };
}

export async function planFill(
  fields: FormField[],
  profile: Profile,
  model: ModelClient,
): Promise<FillPlan> {
  const sensitive = fields.filter((f) => f.sensitive || isSensitive(f));
  const safe = fields.filter((f) => !(f.sensitive || isSensitive(f)));

  const asks: AskItem[] = sensitive.map((f) => ({
    fieldId: f.id,
    prompt: `Type ${f.label || f.name || "this field"} in yourself. Pulse never auto-fills passwords or payment details.`,
  }));

  // Even the profile is scrubbed before it reaches the model: if the user ever
  // stored a sensitive value (an SSN, a card number) under some key, that key
  // must not be shipped off to a third-party model for matching.
  const safeProfile: Profile = Object.fromEntries(
    Object.entries(profile).filter(([k]) => !isSensitive({ name: k, label: k })),
  );

  const fills: FillItem[] = [];
  if (safe.length > 0) {
    const known = new Map(safe.map((f) => [f.id, f]));
    const user = JSON.stringify({ fields: safe.map(publicField), profile: safeProfile });
    const parsed = safeParseObject(await model.complete(SYSTEM_PROMPT, user));
    const proposed = Array.isArray(parsed?.fills) ? parsed.fills : [];

    for (const item of proposed) {
      const fieldId = String(item?.fieldId ?? "");
      const value = item?.value;
      const field = known.get(fieldId); // unknown/sensitive ids simply aren't here
      if (!field) continue;
      if (typeof value !== "string" || value.trim() === "") continue;
      if (field.options?.length && !field.options.includes(value)) continue;
      fills.push({ fieldId, value });
    }

    const filled = new Set(fills.map((x) => x.fieldId));
    for (const f of safe) {
      if (f.required && !filled.has(f.id)) {
        asks.push({
          fieldId: f.id,
          prompt: `Pulse could not find a value for ${f.label || f.name || f.id}.`,
        });
      }
    }
  }

  return { fills, asks };
}
