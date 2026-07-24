// Pulse's front end. Starts the Anam avatar (fast, built-in LLM) and connects
// it to the form-filler: when Pulse decides to fill a form, its LLM calls the
// `fill_form` client tool (declared server-side at mint), and the handler below
// reads the page, asks the brain's /plan-fill planner for values, and types them
// in — never submitting. Also wires Share screen and Companion (PiP) mode.
//
// Reach: this page's handler fills a form in THIS document. To fill a form on
// another website, the Pulse browser extension carries the same scan/plan/apply
// to that tab (computer use). The brain holds every secret; nothing here does.
import { createClient } from "https://esm.sh/@anam-ai/js-sdk@latest";
import { AnamEvent } from "https://esm.sh/@anam-ai/js-sdk@latest/dist/module/types";

const BRAIN = (window.PULSE_BRAIN_URL || "").replace(/\/$/, "");
const GREETING = "I'm Pulse. Point me at whatever's giving you trouble and I'll handle the boring parts.";

const startBtn = document.getElementById("start-button");
const stopBtn = document.getElementById("stop-button");
const screenBtn = document.getElementById("screen-button");
const pipBtn = document.getElementById("pip-button");
const status = document.getElementById("status");
const poster = document.getElementById("poster");
const videoEl = document.getElementById("persona-video");

let client = null;
let screenStream = null;
let companionWin = null;

/* ---------- extension bridge (fill forms on any tab) ----------
 * The Pulse extension injects a relay content script on this page. We talk to
 * it over window.postMessage; it carries the fill to whatever tab the user is
 * looking at (Companion mode). If the extension isn't installed, fill_form
 * falls back to filling a form on THIS page. */
const EXT = "pulse-ext", PAGE = "pulse-page";
let extPresent = false;
let msgId = 0;
const pending = new Map();

window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.data?.source !== EXT) return;
  const { cmd, id, result } = ev.data;
  if (cmd === "ready" || cmd === "pong") { extPresent = true; hideInstall(); } // helper arrived
  if (cmd === "fill-result" && pending.has(id)) { pending.get(id)(result); pending.delete(id); }
});

function extCall(cmd, extra = {}, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const id = ++msgId;
    const done = (r) => resolve(r);
    pending.set(id, done);
    window.postMessage({ source: PAGE, cmd, id, ...extra }, window.location.origin);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, timeoutMs);
  });
}

// Detect the extension shortly after load (it also announces itself via "ready").
extCall("ping", {}, 600).then((r) => { if (r) extPresent = true; });

/* ---------- "Add Pulse to Chrome" prompt ---------- */
// Set window.PULSE_EXTENSION_URL to the Chrome Web Store listing once published.
const EXTENSION_URL = window.PULSE_EXTENSION_URL || "";
const installPrompt = document.getElementById("install-prompt");
const ipAdd = document.getElementById("ip-add");
const ipDismiss = document.getElementById("ip-dismiss");
const ipNote = document.getElementById("ip-note");

function showInstall() { installPrompt?.classList.add("show"); }
function hideInstall() { installPrompt?.classList.remove("show"); }

ipAdd?.addEventListener("click", (e) => {
  e.preventDefault();
  if (EXTENSION_URL) {
    window.open(EXTENSION_URL, "_blank", "noopener");
  } else {
    // Not on the Web Store yet — show the developer load steps.
    ipNote.textContent =
      "Not on the Chrome Web Store yet. For now: open chrome://extensions, turn on Developer mode, click Load unpacked, and choose the pulse extension/dist folder.";
    ipNote.classList.add("show");
  }
  // After they add it, the page needs a reload for the helper to attach.
  ipAdd.textContent = "I've added it — refresh";
  ipAdd.onclick = () => location.reload();
});
ipDismiss?.addEventListener("click", hideInstall);

function setStatus(text) {
  if (status) { status.textContent = text; status.style.display = "block"; }
}
function enable(btn, on) {
  if (!btn) return;
  btn.disabled = !on;
  btn.style.opacity = on ? "1" : ".55";
}

/* ---------- form filling (the fill_form tool handler) ---------- */
const ID_ATTR = "data-pulse-id";
const FILLABLE = new Set(["text","email","tel","url","number","search","date","month","password","textarea","select"]);
const SENSITIVE = /pass(word|code)|\bssn\b|social.?security|card.?(number|num)|\bcvv\b|\bcvc\b|security.?code|account.?number|routing|\bpin\b|tax.?id|passport/i;
function sensitive(f) {
  if ((f.type || "").toLowerCase() === "password") return true;
  return SENSITIVE.test([f.name, f.label, f.autocomplete].filter(Boolean).join(" "));
}
function labelFor(el) {
  const id = el.getAttribute("id");
  if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l?.textContent) return l.textContent.trim(); }
  const w = el.closest("label"); if (w?.textContent) return w.textContent.trim();
  return (el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim() || undefined;
}
function scanForm() {
  const out = []; let n = 0;
  for (const el of document.querySelectorAll("input, select, textarea")) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || (tag === "input" ? "text" : tag)).toLowerCase();
    if (!FILLABLE.has(type) && !FILLABLE.has(tag)) continue;
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const fid = `f${n++}`; el.setAttribute(ID_ATTR, fid);
    const name = el.getAttribute("name") || undefined;
    const label = labelFor(el);
    const options = tag === "select" ? Array.from(el.options).map((o) => o.value).filter(Boolean) : undefined;
    out.push({ id: fid, name, label, type, autocomplete: el.getAttribute("autocomplete") || undefined,
               required: el.hasAttribute("required"), options, sensitive: sensitive({ name, label, type }) });
  }
  return out;
}
// Bypass React/Vue's value tracker (a plain el.value = x gets discarded).
function setNativeValue(el, value) {
  const protoSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  const ownSet = Object.getOwnPropertyDescriptor(el, "value")?.set;
  if (protoSet && ownSet !== protoSet) protoSet.call(el, value);
  else if (ownSet) ownSet.call(el, value);
  else el.value = value;
}
function applyFills(fills) {
  let applied = 0;
  for (const { fieldId, value } of fills) {
    const el = document.querySelector(`[${ID_ATTR}="${CSS.escape(fieldId)}"]`);
    if (!el) continue;
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (sensitive({ name: el.getAttribute("name"), label: labelFor(el), type })) continue; // never type a secret
    if (el.tagName === "SELECT" && !Array.from(el.options).some((o) => o.value === value)) continue;
    el.focus();
    setNativeValue(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    applied++;
  }
  return applied; // NOTE: never .submit() — filling only.
}
async function fillForm() {
  // Preferred path: the extension fills the real site the user is looking at.
  if (extPresent) {
    const r = await extCall("fill", { brainUrl: BRAIN || window.location.origin });
    if (r == null) return "My browser helper didn't answer. Make sure the Pulse extension is on and try again.";
    if (!r.ok) {
      if (r.error === "no form tab") return "Open the page with the form in another tab, then ask me again.";
      if (String(r.error || "").includes("no details")) return "I don't have your details saved yet. Open the Pulse extension and add them.";
      return "I couldn't fill that just now. Give it another go in a moment.";
    }
    const asks = r.asks || 0;
    return `Filled ${r.applied || 0} field${r.applied === 1 ? "" : "s"} on the page. I did not submit anything.${asks ? ` ${asks} still need you, including anything sensitive like a password.` : ""}`;
  }

  // No helper installed — put up the "Add Pulse to Chrome" prompt.
  showInstall();
  return "To fill that in for you I need my browser helper. I've put an Add to Chrome button on your screen. Add it, refresh, and I'll take care of the rest.";
}

// Kept for when a form lives on the Pulse page itself (e.g. a demo form).
async function fillSamePage() {
  const fields = scanForm();
  if (!fields.length) return "There's no form on this screen.";
  let profile = {};
  try { profile = JSON.parse(localStorage.getItem("pulse.profile") || "{}"); } catch {}
  if (!Object.keys(profile).length) return "I don't have your details saved yet. Tell me your name and I'll start there.";
  let plan;
  try {
    const res = await fetch(`${BRAIN}/plan-fill`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields, profile }),
    });
    if (!res.ok) throw new Error(String(res.status));
    plan = await res.json();
  } catch { return "I couldn't work out the values just now. Give it another go in a moment."; }
  const applied = applyFills(plan.fills || []);
  const asks = (plan.asks || []).length;
  return `Filled ${applied} field${applied === 1 ? "" : "s"}. I did not submit anything.${asks ? ` ${asks} still need you, including anything sensitive like a password.` : ""}`;
}

/* ---------- Share screen ---------- */
async function toggleScreen() {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null; screenBtn.textContent = "Share screen";
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenBtn.textContent = "Stop sharing";
    // Pulse's fast LLM can't see pixels; this tells it the user is now pointing
    // at something so it prompts them to open the form and ask for a fill.
    client?.sendUserMessage?.("[The user just shared their screen. Ask what form they want filled, then call fill_form.]");
    screenStream.getVideoTracks()[0].addEventListener("ended", () => {
      screenStream = null; screenBtn.textContent = "Share screen";
    });
  } catch { setStatus("Screen share was cancelled."); }
}

/* ---------- Companion mode (floating always-on-top window) ---------- */
async function toggleCompanion() {
  if (!("documentPictureInPicture" in window)) {
    setStatus("Companion mode needs a Chromium browser.");
    return;
  }
  if (companionWin && !companionWin.closed) { companionWin.close(); return; }
  companionWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 380 });
  const d = companionWin.document;
  d.body.style.cssText = "margin:0;background:#050505;overflow:hidden";
  videoEl.style.cssText = "width:100%;height:100%;object-fit:cover";
  d.body.append(videoEl); // the live WebRTC stream keeps playing as it moves
  companionWin.addEventListener("pagehide", () => {
    videoEl.style.cssText = "";
    document.querySelector(".hero").prepend(videoEl);
  });
}

/* ---------- session lifecycle ---------- */
async function start() {
  startBtn.disabled = true;
  setStatus("Waking Pulse up…");

  let sessionToken;
  try {
    const res = await fetch(`${BRAIN}/session-token`, { method: "POST" });
    if (!res.ok) throw new Error(`session ${res.status}`);
    ({ sessionToken } = await res.json());
  } catch (err) {
    console.error("[pulse] token failed:", err);
    setStatus("Couldn't reach Pulse right now. Give it a second and press Start again.");
    startBtn.disabled = false;
    return;
  }

  try {
    client = createClient(sessionToken);

    // Register the fill_form handler BEFORE streaming, or an early tool call is missed.
    try {
      client.registerToolCallHandler?.("fill_form", {
        onStart: async () => {
          try { return await fillForm(); }
          catch (e) { console.error("[pulse] fill_form", e); return "Something went wrong filling that in."; }
        },
      });
    } catch (e) { console.warn("[pulse] could not register fill_form", e); }

    client.addListener(AnamEvent.SESSION_READY, () => {
      setStatus("Connected. Just talk to Pulse.");
      enable(stopBtn, true); enable(screenBtn, true); enable(pipBtn, true);
      if (poster) poster.style.opacity = "0";
      client.talk(GREETING);
    });
    client.addListener(AnamEvent.CONNECTION_CLOSED, stop);
    await client.streamToVideoElement("persona-video");
  } catch (err) {
    console.error("[pulse] stream failed:", err);
    const denied = String(err?.name || err?.message || "").match(/permission|denied|NotAllowed/i);
    setStatus(denied
      ? "Pulse needs your microphone. Allow it in the address bar, then press Start."
      : "Couldn't start the video. Check mic access and press Start again.");
    startBtn.disabled = false;
  }
}

function stop() {
  if (companionWin && !companionWin.closed) companionWin.close();
  if (screenStream) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; }
  if (screenBtn) screenBtn.textContent = "Share screen";
  if (client) { client.stopStreaming(); client = null; }
  if (poster) poster.style.opacity = "1";
  enable(stopBtn, false); enable(screenBtn, false); enable(pipBtn, false);
  startBtn.disabled = false;
  setStatus("Ready when you are");
}

startBtn?.addEventListener("click", start);
stopBtn?.addEventListener("click", stop);
screenBtn?.addEventListener("click", toggleScreen);
pipBtn?.addEventListener("click", toggleCompanion);
