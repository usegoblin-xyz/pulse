// Runs only on the Pulse page. Bridges the page (which can't talk to the
// extension directly) and the background worker, via window.postMessage on one
// side and chrome.runtime on the other. The page asks Pulse to fill; this relays
// it to the background, which fills the form tab the user is looking at.

const PAGE = "pulse-page";
const EXT = "pulse-ext";

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const msg = ev.data;
  if (!msg || msg.source !== PAGE) return;

  if (msg.cmd === "ping") {
    window.postMessage({ source: EXT, cmd: "pong", id: msg.id }, window.location.origin);
    return;
  }
  if (msg.cmd === "fill") {
    chrome.runtime.sendMessage(
      { type: "fillForPulse", brainUrl: msg.brainUrl, profile: msg.profile },
      (result) => {
        window.postMessage(
          { source: EXT, cmd: "fill-result", id: msg.id, result: result || { ok: false, error: "no response" } },
          window.location.origin,
        );
      },
    );
  }
});

// Announce presence so the page doesn't have to poll from a cold start.
window.postMessage({ source: EXT, cmd: "ready" }, window.location.origin);
