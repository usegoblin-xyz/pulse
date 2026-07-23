// Shared shapes for the fill planner. Deliberately small and duplicated on the
// extension side rather than shared through a package — the two halves ship to
// different runtimes (a public browser bundle vs. a key-holding server) and
// should never accidentally import each other's code.

export interface FormField {
  /** Stable id the content script assigns to each field (e.g. "f3"). */
  id: string;
  name?: string;
  label?: string;
  /** input type / "select" / "textarea". */
  type: string;
  autocomplete?: string;
  /** For selects and radio groups: the only values that may be filled. */
  options?: string[];
  required?: boolean;
  /** Classified client-side; sensitive fields never reach the model. */
  sensitive?: boolean;
}

/** A flat bag of the user's own details, e.g. { fullName, email, city }. */
export type Profile = Record<string, string>;

export interface FillItem {
  fieldId: string;
  value: string;
}

export interface AskItem {
  fieldId: string;
  /** Why Pulse is asking the human instead of filling it. */
  prompt: string;
}

/**
 * The planner's entire output surface. Note what is NOT here: there is no
 * "submit", "click", or "navigate". Pulse's Milestone-1 guardrail — never
 * submit a form on the user's behalf — is enforced by this type having no way
 * to express it, so no model output, however adversarial, can produce one.
 */
export interface FillPlan {
  fills: FillItem[];
  asks: AskItem[];
}
