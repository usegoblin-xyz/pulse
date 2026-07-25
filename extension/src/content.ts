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

// React/Vue attach their own value setter to inputs and ignore a plain
// `el.value = x` (their internal state overwrites it). Going through the native
// prototype setter bypasses that so the framework registers the change.
type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function setNativeValue(el: Fillable, value: string) {
  const proto = Object.getPrototypeOf(el);
  const protoSet = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const ownSet = Object.getOwnPropertyDescriptor(el, "value")?.set;
  if (protoSet && ownSet !== protoSet) protoSet.call(el, value);
  else if (ownSet) ownSet.call(el, value);
  else (el as unknown as { value: string }).value = value;
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

    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) continue;
    if (el instanceof HTMLSelectElement && !Array.from(el.options).some((o) => o.value === value)) continue;

    el.focus(); // some fields only accept input while focused
    setNativeValue(el, value);
    // The events frameworks and validators listen for.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur(); // triggers "field touched" validation / onBlur handlers
    applied++;
  }
  return { applied, refused };
}

/* ---------- computer-use loop: set-of-marks, marks overlay, actions ---------- */
const MARK_ATTR = "data-pulse-idx";
let markLayer: HTMLElement | null = null;

// The one hard line for the agent's clicks: it must never press a control that
// submits, pays, signs, or advances. Enforced in code, not just the prompt.
function isSubmitLike(el: HTMLElement): boolean {
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (type === "submit") return true;
  const txt = (el.textContent || el.getAttribute("value") || el.getAttribute("aria-label") || "").toLowerCase();
  if (/\b(submit|create account|sign ?up|sign ?in|log ?in|pay|continue|next|confirm|place order|apply now|checkout|purchase|delete|send)\b/.test(txt)) return true;
  if (el.tagName === "BUTTON" && !el.getAttribute("type") && el.closest("form")) return true; // bare <button> defaults to submit
  return false;
}

function interactiveEls(): HTMLElement[] {
  const sel =
    "input,textarea,select,button,[role=button],[role=combobox],[role=option],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[contenteditable=true],[tabindex]:not([tabindex='-1'])";
  const out: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    if (seen.has(el)) continue;
    if (el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue; // in viewport only
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") continue;
    seen.add(el); out.push(el);
  }
  return out.slice(0, 60);
}

function mapMark(): { elements: any[] } {
  clearMarks();
  markLayer = document.createElement("div");
  markLayer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const elements: any[] = [];
  interactiveEls().forEach((el, i) => {
    el.setAttribute(MARK_ATTR, String(i));
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:1.5px solid #e11d48;box-sizing:border-box`;
    const badge = document.createElement("div");
    badge.textContent = String(i);
    badge.style.cssText = `position:absolute;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top - 2)}px;background:#e11d48;color:#fff;font:bold 11px sans-serif;padding:0 3px;border-radius:2px`;
    markLayer!.append(box, badge);
    const id = el.getAttribute("id");
    const label =
      (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim()) ||
      el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
      el.textContent?.trim()?.slice(0, 30) || undefined;
    elements.push({ n: i, tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || undefined, label,
                    value: (el as HTMLInputElement).value || undefined });
  });
  document.body.appendChild(markLayer);
  return { elements };
}
function clearMarks() { markLayer?.remove(); markLayer = null; }

function actOn(action: any): { ok: boolean; reason?: string } {
  const el = document.querySelector<HTMLElement>(`[${MARK_ATTR}="${CSS.escape(String(action?.element))}"]`);
  if (!el) return { ok: false, reason: "no element" };
  const type = (el.getAttribute("type") || el.tagName).toLowerCase();
  const name = el.getAttribute("name") || undefined;
  const label = labelFor(el);

  if (action.action === "type" || action.action === "select") {
    if (isSensitive({ name, label, type })) return { ok: false, reason: "sensitive" };
    el.scrollIntoView({ block: "center" });
    (el as HTMLElement).focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      setNativeValue(el, String(action.value ?? ""));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = String(action.value ?? "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return { ok: true };
  }
  if (action.action === "click") {
    if (isSubmitLike(el)) return { ok: false, reason: "refused submit" }; // Pulse never submits
    el.scrollIntoView({ block: "center" });
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    (el as HTMLElement).click();
    return { ok: true };
  }
  return { ok: false, reason: "unknown action" };
}

// Idempotent listener registration (background may inject this more than once).
const w = window as unknown as { __pulseLoaded?: boolean };
if (!w.__pulseLoaded) {
  w.__pulseLoaded = true;
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.cmd === "scan") { reply({ fields: scan() }); return true; }
    if (msg?.cmd === "apply") { reply(apply(msg.fills || [])); return true; }
    if (msg?.cmd === "mapmark") { reply(mapMark()); return true; }
    if (msg?.cmd === "clearmarks") { clearMarks(); reply({ ok: true }); return true; }
    if (msg?.cmd === "act") { reply(actOn(msg.action)); return true; }
    return false;
  });
}
