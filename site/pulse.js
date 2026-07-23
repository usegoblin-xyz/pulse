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
  try {
    const res = await fetch(`${BRAIN}/session-token`, { method: "POST" });
    if (!res.ok) throw new Error(`session ${res.status}`);
    const { sessionToken } = await res.json();

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
    console.error("[pulse] start failed:", err);
    setStatus(
      BRAIN
        ? "Couldn't reach Pulse. Is the brain running?"
        : "Couldn't reach Pulse. Run the brain (server/) and open this page from it.",
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
