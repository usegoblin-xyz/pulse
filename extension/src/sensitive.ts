// Client-side copy of the sensitive-field classifier (defense in depth: the
// content script also refuses to auto-fill these, so a compromised server can't
// coax the extension into typing a password).

const SENSITIVE_RE =
  /pass(word|code|phrase)|\bssn\b|social.?security|card.?(number|num)|\bcc.?num|\bcvv\b|\bcvc\b|security.?code|routing.?number|account.?number|\bpin\b|tax.?id|passport|\bsecret\b|\botp\b|one.?time.?(code|password)/i;

export function isSensitive(f: { name?: string; label?: string; type?: string; autocomplete?: string }): boolean {
  if ((f.type ?? "").toLowerCase() === "password") return true;
  const hay = [f.name, f.label, f.autocomplete].filter(Boolean).join(" ");
  return SENSITIVE_RE.test(hay);
}
