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
let micStream = null;

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
  try { return new URL(u).hostname.replace(/^www\./, ""); }
  catch { const m = String(u).match(/https?:\/\/([^/?#]+)/); return m ? m[1].replace(/^www\./, "") : "source"; }
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

/* ---------- files box (search results + PRDs Pulse writes) ----------
 * A single state (fileStore) rendered to two surfaces: the main-page files box
 * and, when open, a mirror inside the Companion (PiP) window. PRDs stream in
 * live here — no modal — and become downloadable the instant they finish. */
const filesBox = document.getElementById("files-box");
const fbSources = document.getElementById("fb-sources");
const fbDocs = document.getElementById("fb-docs");
const fbSourcesWrap = document.getElementById("fb-sources-wrap");
const fbDocsWrap = document.getElementById("fb-docs-wrap");
let companionFb = null; // { sources, docs } elements in the Companion window, when open
let docSeq = 0;
const fileStore = { sources: [], docs: [] }; // docs: {id,label,markdown,done,error,sources}

function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function mdToHtml(md) {
  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
  let html = "", inList = false;
  for (const raw of escHtml(md).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) { if (inList) { html += "</ul>"; inList = false; } const lv = h[1].length; html += `<h${lv}>${inline(h[2])}</h${lv}>`; continue; }
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (!line) { if (inList) { html += "</ul>"; inList = false; } continue; }
    if (inList) { html += "</ul>"; inList = false; }
    html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}
function slug(s) { return (s || "prd").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "prd"; }

function sourcesHtml(list) {
  if (!list || !list.length) return "";
  return list.map((r) =>
    `<a class="fb-source" href="${escHtml(r.url)}" target="_blank" rel="noopener">` +
    `<span class="fb-source-title">${escHtml(r.title || r.url)}</span>` +
    `<span class="fb-source-domain">${escHtml(domainOf(r.url))}</span></a>`).join("");
}
function docsHtml() {
  return fileStore.docs.map((d) => {
    const action = d.done && !d.error
      ? `<button class="fb-dl" data-id="${d.id}">Download .md</button>`
      : `<span class="fb-writing">${d.error ? "" : "writing…"}</span>`;
    const body = d.error ? `<p class="fb-err">${escHtml(d.error)}</p>`
      : (d.markdown ? mdToHtml(d.markdown) : `<p class="fb-writing">researching the web…</p>`);
    const n = (d.done && d.sources && d.sources.length) || 0;
    const label = `View source${n === 1 ? "" : "s"}`;
    const srcs = n
      ? `<button class="fb-src-toggle" data-id="${d.id}" data-label="${label}">${label}</button>` +
        `<div class="fb-doc-sources" data-src="${d.id}" hidden>` +
        d.sources.map((s) => {
          const ok = /^https?:\/\//i.test(s.url);
          const text = escHtml(s.title || domainOf(s.url));
          return ok ? `<a href="${escHtml(s.url)}" target="_blank" rel="noopener">${text}</a>` : `<span>${text}</span>`;
        }).join("") + `</div>`
      : "";
    return `<div class="fb-doc" data-id="${d.id}"><div class="fb-doc-head"><span class="fb-doc-title">${escHtml(d.label)}</span>${action}</div><div class="fb-doc-body">${body}</div>${srcs}</div>`;
  }).join("");
}
function renderFiles() {
  const sHtml = sourcesHtml(fileStore.sources);
  const dHtml = docsHtml();
  if (fbSources) fbSources.innerHTML = sHtml;
  if (fbDocs) fbDocs.innerHTML = dHtml;
  if (fbSourcesWrap) fbSourcesWrap.style.display = fileStore.sources.length ? "block" : "none";
  if (fbDocsWrap) fbDocsWrap.style.display = fileStore.docs.length ? "block" : "none";
  if (companionFb) { companionFb.sources.innerHTML = sHtml; companionFb.docs.innerHTML = dHtml; }
  scrollStreaming(fbDocs); if (companionFb) scrollStreaming(companionFb.docs);
}
function scrollStreaming(container) {
  if (!container) return;
  const s = fileStore.docs.find((d) => !d.done);
  if (!s) return;
  const el = container.querySelector(`.fb-doc[data-id="${s.id}"] .fb-doc-body`);
  if (el) el.scrollTop = el.scrollHeight;
}
function showFiles() { if (filesBox) filesBox.classList.add("show"); }
function downloadDoc(id) {
  const d = fileStore.docs.find((x) => x.id === id);
  if (!d || !d.done || d.error) return;
  const blob = new Blob([d.markdown], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = slug(d.label) + ".md";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function announce(text) { try { client?.talk?.(text); } catch (e) { console.error("[pulse] announce", e); } }

// Delegated clicks for a files container (works for both the main box and the
// Companion mirror): download buttons, and the "View sources" toggle.
function wireFilesClicks(container) {
  if (!container) return;
  container.addEventListener("click", (e) => {
    const dl = e.target.closest && e.target.closest(".fb-dl");
    if (dl) { downloadDoc(dl.dataset.id); return; }
    const tg = e.target.closest && e.target.closest(".fb-src-toggle");
    if (tg) {
      const list = container.querySelector(`.fb-doc-sources[data-src="${tg.dataset.id}"]`);
      if (list) { const show = list.hasAttribute("hidden"); if (show) list.removeAttribute("hidden"); else list.setAttribute("hidden", ""); tg.textContent = show ? "Hide sources" : tg.dataset.label; }
    }
  });
}
wireFilesClicks(fbDocs);
document.getElementById("fb-close")?.addEventListener("click", () => filesBox?.classList.remove("show"));

let renderTimer = null;
function throttledRender() { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = null; renderFiles(); }, 200); }

// Non-blocking: streams a PRD into the files box in the background. Pulse keeps
// chatting; we announce when it is ready (or if it fell over).
async function startPrdStream(topic, url) {
  topic = (topic || "").trim();
  const id = "d" + (++docSeq);
  const doc = { id, label: topic ? `PRD — ${topic}` : "PRD", markdown: "", done: false, error: null, sources: [] };
  fileStore.docs.unshift(doc);
  showFiles(); renderFiles();
  try {
    const res = await fetch(`${BRAIN}/prd-stream`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, url }),
    });
    if (res.status === 429) { doc.error = "Writing limit hit. Try again in a minute."; doc.done = true; renderFiles(); announce("I hit my writing limit for a moment, so I could not finish that document. Ask me again shortly."); return; }
    if (!res.ok || !res.body) { doc.error = "Could not write that just now."; doc.done = true; renderFiles(); announce("I could not write that document just now."); return; }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let evt = null;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1);
        if (line.startsWith("event:")) evt = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          try {
            const j = JSON.parse(data);
            if (evt === "sources") { doc.sources = j || []; throttledRender(); }
            else if (evt === "token") { doc.markdown += j.t || ""; throttledRender(); }
            else if (evt === "done") {
              doc.markdown = j.markdown || doc.markdown; doc.label = j.title || doc.label; doc.sources = j.sources || doc.sources; doc.done = true;
              if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
              renderFiles();
              announce(`Your PRD titled ${j.title} is ready in the files box, and you can download it now. Want me to change anything in it?`);
            } else if (evt === "error") {
              doc.error = j.error === "rate_limited" ? "Writing limit hit. Try again shortly." : "Something went wrong writing that."; doc.done = true; renderFiles();
              announce("I ran into a snag finishing that document.");
            }
          } catch { /* keep-alive or partial line */ }
        } else if (line === "") evt = null;
      }
    }
    if (!doc.done) { doc.done = true; renderFiles(); }
  } catch (e) { console.error("[pulse] prd-stream", e); doc.error = "Lost the connection while writing."; doc.done = true; renderFiles(); announce("I lost the connection while writing that document."); }
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
  renderResults(query, results);           // main page (research panel)
  if (results.length) { fileStore.sources = results; showFiles(); renderFiles(); } // + files box
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
// On-demand only: Pulse looks when his LLM calls look_at_screen (e.g. after the
// share nudge, or when the user asks). Simple and reliable — no ambient loop.
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
    // No auto-narration: Pulse looks only when the user asks about their screen.
    screenStream.getVideoTracks()[0].addEventListener("ended", stopScreen);
  } catch { setStatus("Screen share was cancelled."); }
}

/* ---------- Companion mode (floating window: avatar + files box) ---------- */
// PiP is a SEPARATE document, so its styles must be injected inline here.
const COMPANION_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#050505;color:#e8ecf3;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;height:100%;overflow:hidden}
  .cp-vid{flex:0 0 46%;position:relative;background:#050505}
  .cp-vid video{width:100%;height:100%;object-fit:cover}
  .cp-files{flex:1;overflow-y:auto;padding:10px 12px;border-top:1px solid rgba(255,255,255,.12);background:rgba(8,9,12,.6)}
  .cp-h{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7fb0ff;margin:2px 0 6px}
  .fb-source{display:block;text-decoration:none;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);margin-bottom:6px}
  .fb-source-title{display:block;font-size:12px;font-weight:600;color:#eef2f7;line-height:1.3}
  .fb-source-domain{display:block;font-size:10px;color:#7fb0ff;margin-top:1px}
  .fb-doc{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:8px 10px;margin-bottom:8px}
  .fb-doc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px}
  .fb-doc-title{font-size:12px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fb-dl{background:#78b4ff;color:#06111f;border:none;border-radius:999px;padding:4px 10px;font:inherit;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap}
  .fb-writing{font-size:11px;color:#9fb4d0;font-style:italic;white-space:nowrap}
  .fb-doc-body{max-height:180px;overflow-y:auto;font-size:11.5px;line-height:1.5;color:#dfe1e6}
  .fb-doc-body h1{font-size:14px;color:#fff;margin:0 0 5px}
  .fb-doc-body h2{font-size:12px;color:#cfe2ff;margin:9px 0 3px}
  .fb-doc-body h3{font-size:11.5px;color:#eef2f7;margin:6px 0 2px}
  .fb-doc-body p{margin:0 0 5px}
  .fb-doc-body ul{margin:0 0 6px;padding-left:16px}
  .fb-doc-body strong{color:#fff}
  .fb-src-toggle{background:none;border:none;color:#7fb0ff;font:inherit;font-size:10.5px;font-weight:600;cursor:pointer;padding:6px 0 0;text-decoration:underline}
  .fb-doc-sources{display:flex;flex-direction:column;gap:3px;margin-top:5px;font-size:10px}
  .fb-doc-sources[hidden]{display:none}
  .fb-doc-sources a{color:#7fb0ff;text-decoration:none}
  .fb-doc-sources span{color:#9fb4d0}
  .fb-err{color:#e88;font-size:11.5px}
  .cp-empty{font-size:11px;color:#8090a5;font-style:italic;padding:6px 2px}
`;
async function toggleCompanion() {
  if (!("documentPictureInPicture" in window)) { setStatus("Companion mode needs a Chromium browser."); return; }
  if (companionWin && !companionWin.closed) { companionWin.close(); return; }
  companionWin = await window.documentPictureInPicture.requestWindow({ width: 340, height: 560 });
  const d = companionWin.document;
  d.documentElement.style.height = "100%";
  const st = d.createElement("style"); st.textContent = COMPANION_CSS; d.head.appendChild(st);

  const vidWrap = d.createElement("div"); vidWrap.className = "cp-vid";
  const pipVideo = d.createElement("video");
  pipVideo.autoplay = true; pipVideo.playsInline = true; pipVideo.muted = true;
  pipVideo.srcObject = videoEl.srcObject;
  vidWrap.appendChild(pipVideo); d.body.appendChild(vidWrap);
  await pipVideo.play().catch(() => {});

  const files = d.createElement("div"); files.className = "cp-files";
  files.innerHTML =
    `<div class="cp-h">Search results</div><div class="cp-sources"></div>` +
    `<div class="cp-h" style="margin-top:10px">Documents</div><div class="cp-docs"></div>`;
  d.body.appendChild(files);
  companionFb = { sources: files.querySelector(".cp-sources"), docs: files.querySelector(".cp-docs") };
  wireFilesClicks(companionFb.docs);
  renderFiles();

  companionWin.addEventListener("pagehide", () => { pipVideo.srcObject = null; companionFb = null; });
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
      client.registerToolCallHandler?.("build_prd", {
        onStart: async (p) => {
          const topic = String(p?.arguments?.topic ?? "").trim();
          const url = String(p?.arguments?.url ?? "").trim();
          console.log("[pulse] build_prd", topic, url);
          if (!topic && !url) return "Tell me what you'd like a PRD for and I'll get started on it.";
          // Kick off streaming in the BACKGROUND (do not await) so Pulse stays
          // free to keep chatting. We announce ourselves when it's ready.
          startPrdStream(topic, url);
          return "I've started building that PRD in the background. You can keep chatting with me about anything while I work, and I'll let you know the moment it's ready to download.";
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
      client.talk("Greetings. I can help you get better at generative AI research. What would you like to learn?");
    });
    client.addListener(AnamEvent.CONNECTION_CLOSED, stop);
    // Capture the mic ourselves with speech-friendly processing (auto-gain lifts
    // a quiet voice, noise + echo suppression clean it up) and hand that stream
    // to Anam, instead of letting it grab the raw default. One permission prompt.
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (e) { console.warn("[pulse] mic capture failed, using default", e); micStream = null; }
    await client.streamToVideoElement("persona-video", micStream || undefined);
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
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  if (poster) poster.style.opacity = "1";
  enable(stopBtn, false); enable(screenBtn, false); enable(pipBtn, false);
  startBtn.disabled = false;
  setStatus("");
}

startBtn?.addEventListener("click", start);
stopBtn?.addEventListener("click", stop);
screenBtn?.addEventListener("click", toggleScreen);
pipBtn?.addEventListener("click", toggleCompanion);
