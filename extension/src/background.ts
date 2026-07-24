// Service worker. Fills a form on a tab: inject the content script, scan the
// fields, ask the brain's /plan-fill for values, apply them — never submit.
// Two triggers:
//   - the popup's "Fill this form" button   -> fill the tab the user is on
//   - the Pulse avatar (via the page relay)  -> fill the tab the user is looking
//     at while Pulse floats over it (Companion mode)

import { getProfile, getBrainUrl } from "./vault.js";
import type { FormField, FillPlan, Profile } from "./types.js";

const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source):/;

async function fillTab(
  tabId: number,
  opts: { brainUrl?: string; profile?: Profile } = {},
): Promise<{ ok: boolean; applied?: number; asks?: number; error?: string }> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });

  const scan = (await chrome.tabs.sendMessage(tabId, { cmd: "scan" })) as { fields: FormField[] };
  const fields = scan?.fields ?? [];
  if (!fields.length) return { ok: true, applied: 0, asks: 0 };

  const brainUrl = (opts.brainUrl || (await getBrainUrl())).replace(/\/$/, "");
  const profile = opts.profile ?? (await getProfile());

  let plan: FillPlan;
  try {
    const res = await fetch(`${brainUrl}/plan-fill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields, profile }),
    });
    if (!res.ok) return { ok: false, error: `brain ${res.status}` };
    plan = (await res.json()) as FillPlan;
  } catch {
    return { ok: false, error: `couldn't reach the brain at ${brainUrl}` };
  }

  const applied = (await chrome.tabs.sendMessage(tabId, { cmd: "apply", fills: plan.fills })) as {
    applied: number;
  };
  return { ok: true, applied: applied?.applied ?? 0, asks: (plan.asks ?? []).length };
}

/** The tab the user is actually looking at — never the Pulse page or a chrome:// page. */
async function resolveTargetTab(excludeTabId?: number): Promise<chrome.tabs.Tab | null> {
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused && focused.id !== excludeTabId && !RESTRICTED.test(focused.url || "")) return focused;
  // Fall back to the most recently accessed normal tab that isn't the caller.
  const tabs = await chrome.tabs.query({});
  return (
    tabs
      .filter((t) => t.id !== excludeTabId && t.url && !RESTRICTED.test(t.url))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null
  );
}

async function fillActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || RESTRICTED.test(tab.url || "")) {
    return { ok: false, error: "Open a real website first." };
  }
  return fillTab(tab.id);
}

// On install, inject the relay into any already-open Pulse tabs so the page
// detects the helper immediately — the user doesn't have to refresh.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({
    url: ["https://pulse-demo.fly.dev/*", "http://localhost:8787/*"],
  });
  for (const t of tabs) {
    if (t.id) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["relay.js"] }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // From the popup: fill the tab the user is on.
  if (msg?.type === "fillActiveTab") {
    fillActiveTab().then(reply);
    return true;
  }
  // From the Pulse page relay: fill the form tab the user is looking at.
  if (msg?.type === "fillForPulse") {
    (async () => {
      const target = await resolveTargetTab(sender.tab?.id);
      if (!target?.id) return reply({ ok: false, error: "no form tab" });
      reply(await fillTab(target.id, { brainUrl: msg.brainUrl, profile: msg.profile }));
    })();
    return true;
  }
  if (msg?.type === "pulsePing") {
    reply({ ok: true });
    return true;
  }
  return false;
});
