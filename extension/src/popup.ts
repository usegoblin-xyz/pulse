// Popup: edit the local vault, point at the brain, and trigger a fill. No
// network here beyond messaging the background worker.

import { getProfile, setProfile, getBrainUrl, setBrainUrl } from "./vault.js";
import type { FillPlan } from "./types.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load() {
  const [profile, brain] = await Promise.all([getProfile(), getBrainUrl()]);
  $<HTMLTextAreaElement>("profile").value = JSON.stringify(profile, null, 2);
  $<HTMLInputElement>("brain").value = brain;
}

function status(msg: string, kind: "ok" | "err" | "info" = "info") {
  const el = $("status");
  el.textContent = msg;
  el.dataset.kind = kind;
}

$<HTMLButtonElement>("save").addEventListener("click", async () => {
  try {
    const profile = JSON.parse($<HTMLTextAreaElement>("profile").value || "{}");
    await setProfile(profile);
    await setBrainUrl($<HTMLInputElement>("brain").value.trim());
    status("Saved to this device.", "ok");
  } catch {
    status("Profile must be valid JSON.", "err");
  }
});

$<HTMLButtonElement>("fill").addEventListener("click", async () => {
  status("Reading the form…", "info");
  const res = (await chrome.runtime.sendMessage({ type: "fillActiveTab" })) as {
    ok: boolean; plan?: FillPlan; applied?: number; error?: string;
  };
  if (!res?.ok) { status(res?.error || "Something went wrong.", "err"); return; }
  const asks = res.plan?.asks ?? [];
  const askLine = asks.length ? ` ${asks.length} field(s) need you (incl. anything sensitive).` : "";
  status(`Filled ${res.applied ?? 0} field(s). Nothing was submitted.${askLine}`, "ok");
});

// Hands-free = the broad "fill on any site" access, requested only when the
// user opts in (keeps the install minimal for Chrome review).
const BROAD: chrome.permissions.Permissions = { permissions: ["tabs"], origins: ["https://*/*", "http://*/*"] };
async function refreshHandsFree() {
  const on = await chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] });
  const btn = $<HTMLButtonElement>("handsfree");
  btn.textContent = on ? "Hands-free fill is on ✓" : "Enable hands-free fill on any site";
  btn.disabled = on;
}
$<HTMLButtonElement>("handsfree").addEventListener("click", async () => {
  const granted = await chrome.permissions.request(BROAD);
  if (granted) { status("Hands-free enabled — Pulse can fill by voice now.", "ok"); refreshHandsFree(); }
  else status("Left off. You can still fill from this popup.", "info");
});

load();
refreshHandsFree();
