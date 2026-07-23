// Starts a live Pulse avatar session on "Start conversation" — same flow as
// Kara: fetch a short-lived Anam session token from the brain, stream the avatar
// into #persona-video, and fade the beam poster out once video is live. The
// brain holds the Anam key; nothing secret lives in this file.
import { createClient } from "https://esm.sh/@anam-ai/js-sdk@latest";
import { AnamEvent } from "https://esm.sh/@anam-ai/js-sdk@latest/dist/module/types";

// Where the brain lives. Empty = same origin (when the brain serves this page).
// If you host this page apart from the brain (e.g. GitHub Pages), set a full
// URL, e.g. window.PULSE_BRAIN_URL = "https://pulse-brain.fly.dev".
const BRAIN = (window.PULSE_BRAIN_URL || "").replace(/\/$/, "");
const GREETING = "I'm Pulse. Point me at whatever's giving you trouble and I'll handle the boring parts.";

const startBtn = document.getElementById("start-button");
const stopBtn = document.getElementById("stop-button");
const status = document.getElementById("status");
const poster = document.getElementById("poster");

let client = null;

function setStatus(text) {
  if (status) {
    status.textContent = text;
    status.style.display = "block";
  }
}

async function start() {
  startBtn.disabled = true;
  setStatus("Waking Pulse up…");

  // Step 1: get a session token from the brain.
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

  // Step 2: stream the avatar. This asks for your microphone (Pulse needs to
  // hear you); a dismissed or blocked mic prompt is the usual failure here.
  try {
    client = createClient(sessionToken);
    client.addListener(AnamEvent.SESSION_READY, () => {
      setStatus("Connected. Just talk to Pulse.");
      stopBtn.disabled = false;
      stopBtn.style.opacity = "1";
      if (poster) poster.style.opacity = "0"; // live video takes the stage
      client.talk(GREETING); // Pulse speaks first
    });
    client.addListener(AnamEvent.CONNECTION_CLOSED, stop);
    await client.streamToVideoElement("persona-video");
  } catch (err) {
    console.error("[pulse] stream failed:", err);
    const denied = String(err?.name || err?.message || "").match(/permission|denied|NotAllowed/i);
    setStatus(
      denied
        ? "Pulse needs your microphone. Allow it in the address bar, then press Start."
        : "Couldn't start the video. Check mic access and press Start again.",
    );
    startBtn.disabled = false;
  }
}

function stop() {
  if (client) {
    client.stopStreaming();
    client = null;
  }
  if (poster) poster.style.opacity = "1";
  stopBtn.disabled = true;
  stopBtn.style.opacity = ".55";
  startBtn.disabled = false;
  setStatus("Ready when you are");
}

startBtn?.addEventListener("click", start);
stopBtn?.addEventListener("click", stop);
