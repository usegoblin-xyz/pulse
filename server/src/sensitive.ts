// Which fields Pulse must never auto-fill or send to a third-party model.
// Passwords and payment/identity secrets stay between the human and the page;
// the vault and the guardrails both defer to this classifier.

const SENSITIVE_RE =
  /pass(word|code|phrase)|\bssn\b|social.?security|card.?(number|num)|\bcc.?num|\bcvv\b|\bcvc\b|security.?code|routing.?number|account.?number|\bpin\b|tax.?id|passport|\bsecret\b|\botp\b|one.?time.?(code|password)/i;

export interface SensitiveHints {
  name?: string;
  label?: string;
  type?: string;
  autocomplete?: string;
}

export function isSensitive(f: SensitiveHints): boolean {
  if ((f.type ?? "").toLowerCase() === "password") return true;
  const hay = [f.name, f.label, f.autocomplete].filter(Boolean).join(" ");
  return SENSITIVE_RE.test(hay);
}
