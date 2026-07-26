// Server-side browser agent. Opens a form URL in a real Chromium (Playwright),
// fills it with the heuristic + VLM loop, and never submits — streamed to the
// page as JPEG frames. This is the no-install path: nothing runs in the user's
// browser. It is a fresh session, so gated sites need an in-panel login.
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { planFill } from "./planner.js";
import { planAction, visionConfigFromEnv } from "./vision.js";
import { makeOpenAIModel, modelConfigFromEnv } from "./model.js";
import type { Profile, FormField } from "./types.js";

let browserP: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (!browserP) browserP = chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  return browserP;
}

const vision = visionConfigFromEnv();
const mcfg = modelConfigFromEnv();
const model = mcfg.apiKey ? makeOpenAIModel(mcfg) : null;

interface Session { context: BrowserContext; page: Page; frame: string | null; status: "running" | "done" | "error"; message: string; updatedAt: number; }
const sessions = new Map<string, Session>();

async function snap(s: Session, status: Session["status"], message?: string) {
  try {
    const buf = await s.page.screenshot({ type: "jpeg", quality: 50 });
    s.frame = "data:image/jpeg;base64," + buf.toString("base64");
  } catch { /* page may be navigating */ }
  s.status = status;
  if (message !== undefined) s.message = message;
  s.updatedAt = Date.now();
}

// Scan fillable fields (for the heuristic). Runs in the page.
function scanFields(): FormField[] {
  const SENS = /pass(word|code)|\bssn\b|social.?security|card.?(number|num)|\bcvv\b|\bcvc\b|security.?code|account.?number|routing|\bpin\b|tax.?id|passport/i;
  const FILLABLE = ["text", "email", "tel", "url", "number", "search", "date", "month", "password", "textarea", "select"];
  const out: FormField[] = []; let n = 0;
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || (tag === "input" ? "text" : tag)).toLowerCase();
    if (!FILLABLE.includes(type) && !FILLABLE.includes(tag)) continue;
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const id = "f" + n++; el.setAttribute("data-pf", id);
    const name = el.getAttribute("name") || undefined;
    const domId = el.getAttribute("id");
    const label = (domId && document.querySelector(`label[for="${CSS.escape(domId)}"]`)?.textContent?.trim()) ||
      el.getAttribute("aria-label") || el.getAttribute("placeholder") || undefined;
    const options = tag === "select" ? Array.from((el as HTMLSelectElement).options).map((o) => o.value).filter(Boolean) : undefined;
    out.push({ id, name, label, type, autocomplete: el.getAttribute("autocomplete") || undefined, required: el.hasAttribute("required"), options,
      sensitive: type === "password" || SENS.test([name, label, el.getAttribute("autocomplete")].filter(Boolean).join(" ")) });
  }
  return out;
}

// Set-of-marks: number the interactive elements, draw badges, return the list.
function markInteractive(): Array<{ n: number; tag: string; type?: string; label?: string; value?: string }> {
  document.querySelectorAll(".pulse-mark").forEach((n) => n.remove());
  const sel = "input,textarea,select,button,[role=button],[role=combobox],[role=option],[role=menuitem],a[href],[contenteditable=true],[tabindex]";
  const out: any[] = []; let i = 0; const seen = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    if (seen.has(el)) continue;
    if (el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue;
    seen.add(el); el.setAttribute("data-pulse-idx", String(i));
    const b = document.createElement("div"); b.className = "pulse-mark"; b.textContent = String(i);
    b.style.cssText = `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top)}px;background:#e11d48;color:#fff;font:bold 11px sans-serif;padding:0 3px;z-index:2147483647`;
    document.body.appendChild(b);
    const id = el.getAttribute("id");
    const label = (id && document.querySelector(`label[for="${id}"]`)?.textContent?.trim()) ||
      el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim()?.slice(0, 30) || undefined;
    out.push({ n: i, tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || undefined, label, value: (el as HTMLInputElement).value || undefined });
    i++;
    if (i >= 60) break;
  }
  return out;
}

function isSubmitEl(el: Element): boolean {
  const t = (el.getAttribute("type") || "").toLowerCase();
  if (t === "submit") return true;
  const txt = (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").toLowerCase();
  return /\b(submit|create account|sign ?up|sign ?in|log ?in|pay|continue|next|confirm|place order|checkout|purchase|delete|apply now)\b/.test(txt);
}

export async function startRun(sessionId: string, url: string, profile: Profile): Promise<void> {
  const browser = await getBrowser();
  const old = sessions.get(sessionId);
  if (old) old.context.close().catch(() => {});
  const context = await browser.newContext({
    viewport: { width: 1000, height: 1100 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const s: Session = { context, page, frame: null, status: "running", message: "Opening the page…", updatedAt: Date.now() };
  sessions.set(sessionId, s);
  runLoop(s, url, profile).catch((e) => { console.error("[browser]", e?.message ?? e); s.status = "error"; s.message = "Something went wrong in the browser."; });
}

async function runLoop(s: Session, url: string, profile: Profile) {
  const { page } = s;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(900);
  await snap(s, "running", "Reading the form…");

  // Pass 1: heuristic — deterministic standard fields.
  const fields = await page.evaluate(scanFields);
  if (fields.length) {
    const plan = await planFill(fields, profile, model);
    for (const { fieldId, value } of plan.fills) {
      const loc = page.locator(`[data-pf="${fieldId}"]`).first();
      try {
        const tag = await loc.evaluate((e) => e.tagName);
        if (tag === "SELECT") await loc.selectOption({ label: value }, { timeout: 2500 }).catch(() => loc.selectOption(value, { timeout: 2500 }));
        else await loc.fill(value, { timeout: 2500 });
      } catch { /* skip stubborn field */ }
      await snap(s, "running");
    }
    await snap(s, "running", `Filled ${plan.fills.length} field${plan.fills.length === 1 ? "" : "s"}.`);
  }

  // Pass 2: VLM loop — the custom widgets.
  if (vision.apiKey) {
    const history: any[] = [];
    for (let i = 0; i < 12; i++) {
      const elements = await page.evaluate(markInteractive);
      await page.waitForTimeout(150);
      const shot = "data:image/jpeg;base64," + (await page.screenshot({ type: "jpeg", quality: 50 })).toString("base64");
      await page.evaluate(() => document.querySelectorAll(".pulse-mark").forEach((n) => n.remove()));
      let action: any;
      try { action = await planAction(shot, { elements, profile, history }, vision); } catch { break; }
      if (!action || action.action === "done") break;
      const loc = page.locator(`[data-pulse-idx="${action.element}"]`).first();
      try {
        if (action.action === "type") await loc.fill(String(action.value ?? ""), { timeout: 2500 });
        else if (action.action === "select") await loc.selectOption({ label: String(action.value) }, { timeout: 2500 }).catch(() => loc.selectOption(String(action.value), { timeout: 2500 }));
        else if (action.action === "click") {
          const submit = await loc.evaluate(isSubmitEl).catch(() => false);
          if (!submit) await loc.click({ timeout: 2500 }); // never click submit
        }
      } catch { /* skip */ }
      history.push({ action: action.action, element: action.element, value: action.value });
      await page.waitForTimeout(700);
      await snap(s, "running", "Working through the form…");
    }
  }
  await snap(s, "done", "Done. I filled what I could and did not submit anything.");
}

export function getFrame(sessionId: string) {
  const s = sessions.get(sessionId);
  return s ? { frame: s.frame, status: s.status, message: s.message } : null;
}
