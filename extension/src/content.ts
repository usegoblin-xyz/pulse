// Content script: the only code that touches the page. Two jobs — read the
// form's fields, and apply approved fills. What it deliberately CANNOT do:
// submit. There is no call to form.submit(), form.requestSubmit(), or a click
// on any submit control anywhere in this file, and the M1 guardrail test greps
// the built bundle to keep it that way. Pulse fills; the human submits.

import type { FormField, FillItem } from "./types.js";
import { isSensitive } from "./sensitive.js";

const ID_ATTR = "data-pulse-id";
const FILLABLE_INPUT = new Set([
  "text", "email", "tel", "url", "number", "search", "date", "month", "week",
  "time", "datetime-local", "password", "color", "range",
]);

function labelFor(el: HTMLElement): string | undefined {
  const id = el.getAttribute("id");
  if (id) {
    const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lab?.textContent) return lab.textContent.trim();
  }
  const wrap = el.closest("label");
  if (wrap?.textContent) return wrap.textContent.trim();
  const aria = el.getAttribute("aria-label") || el.getAttribute("placeholder");
  return aria?.trim() || undefined;
}

function visible(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function scan(): FormField[] {
  const out: FormField[] = [];
  let n = 0;
  const els = document.querySelectorAll<HTMLElement>("input, select, textarea");
  for (const el of Array.from(els)) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || (tag === "input" ? "text" : tag)).toLowerCase();
    if (tag === "input" && !FILLABLE_INPUT.has(type)) continue; // skip submit/button/file/hidden/checkbox/radio in M1
    if (!visible(el)) continue;

    const fid = `f${n++}`;
    el.setAttribute(ID_ATTR, fid);
    const name = el.getAttribute("name") || undefined;
    const label = labelFor(el);
    const autocomplete = el.getAttribute("autocomplete") || undefined;
    const required = el.hasAttribute("required");

    let options: string[] | undefined;
    if (tag === "select") {
      options = Array.from((el as HTMLSelectElement).options).map((o) => o.value).filter(Boolean);
    }

    out.push({
      id: fid, name, label, type, autocomplete, required, options,
      sensitive: isSensitive({ name, label, type, autocomplete }),
    });
  }
  return out;
}

// Apply values ONLY. No submission, ever. Sensitive fields are refused here too.
function apply(fills: FillItem[]): { applied: number; refused: number } {
  let applied = 0;
  let refused = 0;
  for (const { fieldId, value } of fills) {
    const el = document.querySelector<HTMLElement>(`[${ID_ATTR}="${CSS.escape(fieldId)}"]`);
    if (!el) continue;
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    const name = el.getAttribute("name") || undefined;
    const label = labelFor(el);
    if (isSensitive({ name, label, type })) { refused++; continue; } // never auto-type a secret

    if (el instanceof HTMLSelectElement) {
      if (!Array.from(el.options).some((o) => o.value === value)) continue;
      el.value = value;
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = value;
    } else {
      continue;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    applied++;
  }
  return { applied, refused };
}

// Idempotent listener registration (background may inject this more than once).
const w = window as unknown as { __pulseLoaded?: boolean };
if (!w.__pulseLoaded) {
  w.__pulseLoaded = true;
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.cmd === "scan") { reply({ fields: scan() }); return true; }
    if (msg?.cmd === "apply") { reply(apply(msg.fills || [])); return true; }
    return false;
  });
}
