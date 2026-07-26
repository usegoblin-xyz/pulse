// Pulse's front end. Starts the Anam avatar (fast, built-in LLM) and gives it a
// research faculty: when Pulse decides to look something up, its LLM calls one of
// three client tools declared server-side at mint — `web_search`, `read_page`,
// and `look_at_screen`. The handlers below call the brain's /research and /see
// endpoints, show the sources and the page Pulse is reading in the side panel,
// and hand the findings back to Pulse to speak. The brain holds every key.
import { createClient } from "https://esm.sh/@anam-ai/js-sdk@latest";
import { AnamEvent } from "https://esm.sh/@anam-ai/js-sdk@latest/dist/module/types";

const BRAIN = (window.PULSE_BRAIN_URL || "").replace(/\/$/, "");

const startBtn = document.getElementById("start-button");
const stopBtn = document.getElementById("stop-button");
const screenBtn = document.getElementById("screen-button");
const pipBtn = document.getElementById("pip-button");
const status = document.getElementById("status");
const poster = document.getElementById("poster");
const videoEl = document.getElementById("persona-video");

let client = null;
let screenStream = null;
let screenVideo = null;
let companionWin = null;

// Conversation capture — Anam's server transcript comes back empty for Pulse,
// so we stream the live message history to the brain ourselves.
let conversationId = null;
let convoLog = [];
const seenMsgs = new Set();
let transcriptTimer = null;
function logMsg(role, content) {
  content = (content || "").trim();
  const key = role + "::" + content;
  if (!content || seenMsgs.has(key)) return;
  seenMsgs.add(key);
  convoLog.push({ role, content });
  if (!transcriptTimer) transcriptTimer = setTimeout(() => { transcriptTimer = null; saveTranscript(); }, 2000);
}
async function saveTranscript() {
  if (!conversationId || !convoLog.length) return;
  try {
    await fetch(`${BRAIN}/transcript`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: conversationId, ua: navigator.userAgent, messages: convoLog }),
    });
  } catch { /* best-effort */ }
}

function setStatus(text) {
  if (!status) return;
  status.textContent = text || "";
  status.style.display = text ? "block" : "none";
}
function enable(btn, on) {
  if (!btn) return;
  btn.disabled = !on;
  btn.style.opacity = on ? "1" : ".55";
}
function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

/* ---------- research panel (shows Pulse's sources and what he's reading) ---------- */
const panel = document.getElementById("research-panel");
const rpStatus = document.querySelector(".rp-status");
const rpResults = document.getElementById("rp-results");
const rpReading = document.getElementById("rp-reading");
const rpShot = document.getElementById("rp-shot");
const rpCaption = document.getElementById("rp-caption");

function openPanel(statusText) {
  panel?.classList.add("show");
  if (statusText && rpStatus) rpStatus.textContent = statusText;
}
function closePanel() { panel?.classList.remove("show"); }
document.getElementById("rp-close")?.addEventListener("click", closePanel);

function renderResults(query, results) {
  if (!rpResults) return;
  rpResults.innerHTML = "";
  for (const r of results) {
    const a = document.createElement("a");
    a.className = "rp-source"; a.href = r.url; a.target = "_blank"; a.rel = "noopener";
    a.innerHTML =
      `<span class="rp-source-title"></span>` +
      `<span class="rp-source-domain"></span>` +
      `<span class="rp-source-snip"></span>`;
    a.querySelector(".rp-source-title").textContent = r.title || r.url;
    a.querySelector(".rp-source-domain").textContent = domainOf(r.url);
    a.querySelector(".rp-source-snip").textContent = r.snippet || "";
    rpResults.appendChild(a);
  }
  rpResults.style.display = results.length ? "block" : "none";
}
function renderReading(title, url, screenshot) {
  if (rpReading) rpReading.style.display = "block";
  if (rpShot) { if (screenshot) { rpShot.src = screenshot; rpShot.style.display = "block"; } else rpShot.style.display = "none"; }
  if (rpCaption) rpCaption.textContent = title ? `${title} — ${domainOf(url)}` : domainOf(url);
}

/* ---------- the three research tools ---------- */

// Search the live web. Renders the sources and returns a compact digest Pulse
// reads back and reasons over.
async function webSearch(query) {
  query = (query || "").trim();
  if (!query) return "Tell me what you'd like me to look up.";
  openPanel(`Searching for ${query}…`);
  if (rpReading) rpReading.style.display = "none";
  let data;
  try {
    const res = await fetch(`${BRAIN}/research/search`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }),
    });
    if (!res.ok) return "I couldn't reach the web just then. Give me a moment and ask again.";
    data = await res.json();
  } catch { return "I couldn't reach the web just then. Give me a moment and ask again."; }
  const results = Array.isArray(data.results) ? data.results : [];
  renderResults(query, results);
  if (rpStatus) rpStatus.textContent = results.length ? `Found ${results.length} sources for ${query}.` : `Nothing solid for ${query}.`;
  if (!results.length && !data.answer) return `I searched for ${query} but didn't find anything solid. Want me to try different words?`;
  let digest = `Web search results for "${query}":\n`;
  if (data.answer) digest += `\nQuick synthesized answer: ${data.answer}\n`;
  results.forEach((r, i) => {
    digest += `\n${i + 1}. ${r.title} (${domainOf(r.url)})\n   ${r.url}\n   ${(r.snippet || "").slice(0, 300)}\n`;
  });
  digest += `\nUse these to answer. If the snippets are thin, call read_page on the most useful web address above before replying. Always tell the user which source your answer came from.`;
  return digest;
}

// Read one page in full. Shows the page snapshot and returns its text to Pulse.
async function readPage(url) {
  url = (url || "").trim();
  if (!url) return "Give me the web address and I'll read it.";
  openPanel(`Opening ${domainOf(url)}…`);
  let data;
  try {
    const res = await fetch(`${BRAIN}/research/read`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    });
    if (!res.ok) return "I couldn't open that page just then. It may block outside readers.";
    data = await res.json();
  } catch { return "I couldn't open that page just then. It may block outside readers."; }
  renderReading(data.title, data.url || url, data.screenshot);
  if (rpStatus) rpStatus.textContent = `Read ${domainOf(data.url || url)}.`;
  const text = (data.text || "").trim();
  if (!text) return `I opened ${domainOf(url)} but couldn't pull readable text from it. It may be mostly images or behind a wall.`;
  return `I read this page.\nTitle: ${data.title || url}\nSource: ${data.url || url}\n\n${text.slice(0, 4800)}\n\nAnswer the user from this, and say it came from ${domainOf(data.url || url)}.`;
}

/* ---------- vision: look at the shared screen ---------- */
async function captureScreenFrame() {
  if (!screenVideo || !screenVideo.videoWidth) return null;
  try {
    const scale = Math.min(1, 1280 / screenVideo.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(screenVideo.videoWidth * scale);
    canvas.height = Math.round(screenVideo.videoHeight * scale);
    canvas.getContext("2d").drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch (e) { console.error("[pulse] captureScreenFrame failed", e); return null; }
}
async function lookAtScreen() {
  if (!screenStream) return "You haven't shared your screen yet. Click Share screen, pick the window you want me to look at, and I'll take a look.";
  const image = await captureScreenFrame();
  if (!image) return "I couldn't grab your screen just then. Try sharing it again.";
  try {
    const res = await fetch(`${BRAIN}/see`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }),
    });
    if (res.status === 503) return "My eyes aren't switched on yet. My vision needs a key added in settings.";
    if (!res.ok) return "I looked but couldn't quite make it out just then.";
    const { text } = await res.json();
    return text || "I looked but couldn't tell what's there.";
  } catch { return "I couldn't reach my vision just then."; }
}

/* ---------- Share screen ---------- */
function stopScreen() {
  screenStream?.getTracks().forEach((t) => t.stop());
  screenStream = null;
  if (screenVideo) { screenVideo.srcObject = null; screenVideo.remove(); screenVideo = null; }
  if (screenBtn) screenBtn.textContent = "Share screen";
}
async function toggleScreen() {
  if (screenStream) { stopScreen(); return; }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 4 } });
    screenBtn.textContent = "Stop sharing";
    screenVideo = document.createElement("video");
    screenVideo.srcObject = screenStream;
    screenVideo.muted = true; screenVideo.playsInline = true;
    screenVideo.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px";
    document.body.appendChild(screenVideo);
    await screenVideo.play().catch(() => {});
    client?.sendUserMessage?.("[The user just shared their screen. Call look_at_screen now, then tell them what you see.]");
    screenStream.getVideoTracks()[0].addEventListener("ended", stopScreen);
  } catch { setStatus("Screen share was cancelled."); }
}

/* ---------- Companion mode (floating always-on-top window) ---------- */
async function toggleCompanion() {
  if (!("documentPictureInPicture" in window)) { setStatus("Companion mode needs a Chromium browser."); return; }
  if (companionWin && !companionWin.closed) { companionWin.close(); return; }
  companionWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 380 });
  const d = companionWin.document;
  d.documentElement.style.cssText = "height:100%";
  d.body.style.cssText = "margin:0;height:100%;background:#050505;overflow:hidden";
  const pipVideo = d.createElement("video");
  pipVideo.autoplay = true; pipVideo.playsInline = true; pipVideo.muted = true;
  pipVideo.srcObject = videoEl.srcObject;
  pipVideo.style.cssText = "position:fixed;inset:0;width:100%;height:100%;object-fit:cover";
  d.body.append(pipVideo);
  await pipVideo.play().catch(() => {});
  companionWin.addEventListener("pagehide", () => { pipVideo.srcObject = null; });
}

/* ---------- session lifecycle ---------- */
async function start() {
  startBtn.disabled = true;
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
    window.__pulseClient = client;

    conversationId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
      if (Array.isArray(messages)) for (const m of messages) logMsg(m.role === "user" ? "user" : "persona", m.content);
    });

    // Register handlers BEFORE streaming, or an early tool call is missed.
    try {
      client.registerToolCallHandler?.("web_search", {
        onStart: async (p) => {
          const query = p?.arguments?.query ?? "";
          console.log("[pulse] web_search", query);
          try { return await webSearch(String(query)); }
          catch (e) { console.error("[pulse] web_search", e); return "Something went wrong searching just then."; }
        },
      });
      client.registerToolCallHandler?.("read_page", {
        onStart: async (p) => {
          const url = p?.arguments?.url ?? "";
          console.log("[pulse] read_page", url);
          try { return await readPage(String(url)); }
          catch (e) { console.error("[pulse] read_page", e); return "Something went wrong reading that page."; }
        },
      });
      client.registerToolCallHandler?.("look_at_screen", {
        onStart: async () => {
          console.log("[pulse] look_at_screen invoked");
          try { return await lookAtScreen(); }
          catch (e) { console.error("[pulse] look_at_screen", e); return "I had trouble looking at your screen just then."; }
        },
      });
    } catch (e) { console.warn("[pulse] could not register tools", e); }

    client.addListener(AnamEvent.SESSION_READY, () => {
      setStatus("");
      enable(stopBtn, true); enable(screenBtn, true); enable(pipBtn, true);
      if (poster) poster.style.opacity = "0";
      client.talk("I'm Pulse. Ask me anything and I'll go read the web and come back with the real answer, or share your screen and I'll tell you what I see.");
    });
    client.addListener(AnamEvent.CONNECTION_CLOSED, stop);
    await client.streamToVideoElement("persona-video");
  } catch (err) {
    console.error("[pulse] stream failed:", err);
    const n = String(err?.name || err?.message || "");
    let msg = "Couldn't start Pulse. Refresh the page and press Start again.";
    if (/NotAllowed|permission|denied/i.test(n))
      msg = "Pulse needs your microphone. Click the mic icon in the address bar, allow it, then press Start.";
    else if (/NotReadable|in ?use|busy|already/i.test(n))
      msg = "Your microphone is busy. Close other apps or Pulse tabs using it (Zoom, Meet, another tab), then press Start.";
    else if (/NotFound|no.*device|Requested device/i.test(n))
      msg = "No microphone found. Check your input device, then press Start.";
    setStatus(msg);
    startBtn.disabled = false;
  }
}

function stop() {
  if (companionWin && !companionWin.closed) companionWin.close();
  stopScreen();
  if (transcriptTimer) { clearTimeout(transcriptTimer); transcriptTimer = null; }
  saveTranscript();
  if (client) { client.stopStreaming(); client = null; }
  if (poster) poster.style.opacity = "1";
  enable(stopBtn, false); enable(screenBtn, false); enable(pipBtn, false);
  startBtn.disabled = false;
  setStatus("");
}

startBtn?.addEventListener("click", start);
stopBtn?.addEventListener("click", stop);
screenBtn?.addEventListener("click", toggleScreen);
pipBtn?.addEventListener("click", toggleCompanion);
