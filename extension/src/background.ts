// Service worker. Fills a form on a tab in two passes:
//   1. heuristic  — instant, sets standard fields from the profile (/plan-fill)
//   2. agent loop — for what's left (custom widgets, autocompletes): screenshot
//      the marked-up page, ask /agent-step for the next action, execute it,
//      repeat. Never submits (the content script refuses submit-like clicks).

import { getProfile, getBrainUrl } from "./vault.js";
import type { FormField, FillPlan, Profile } from "./types.js";

const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source):/;
const AGENT_MAX_STEPS = 10;

async function fetchAgentStep(brainUrl: string, payload: unknown): Promise<any> {
  try {
    const res = await fetch(`${brainUrl}/agent-step`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    if (res.status === 503) return { unavailable: true };
    if (!res.ok) return null;
    return (await res.json()).action;
  } catch {
    return null;
  }
}

// screenshot -> plan next action -> execute -> repeat, until "done" or the cap.
async function agentLoop(
  tab: chrome.tabs.Tab,
  brainUrl: string,
  profile: Profile,
): Promise<{ steps: number; filled: number }> {
  const history: any[] = [];
  let filled = 0;
  for (let i = 0; i < AGENT_MAX_STEPS; i++) {
    let elements: any[];
    try { ({ elements } = await chrome.tabs.sendMessage(tab.id!, { cmd: "mapmark" })); }
    catch { break; }
    await new Promise((r) => setTimeout(r, 150)); // let marks paint
    let screenshot: string;
    try { screenshot = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: "jpeg", quality: 55 }); }
    catch { await chrome.tabs.sendMessage(tab.id!, { cmd: "clearmarks" }).catch(() => {}); break; }
    await chrome.tabs.sendMessage(tab.id!, { cmd: "clearmarks" }).catch(() => {});

    const action = await fetchAgentStep(brainUrl, { screenshot, elements, profile, history });
    if (!action || action.unavailable || action.action === "done") break;
    const r = await chrome.tabs.sendMessage(tab.id!, { cmd: "act", action }).catch(() => ({ ok: false }));
    if (r?.ok && (action.action === "type" || action.action === "select")) filled++;
    history.push({ action: action.action, element: action.element, value: action.value });
    await new Promise((r) => setTimeout(r, 900)); // let the page react (dropdowns open, etc.)
  }
  return { steps: history.length, filled };
}

async function fillTab(
  tab: chrome.tabs.Tab,
  opts: { brainUrl?: string; profile?: Profile } = {},
): Promise<{ ok: boolean; applied?: number; asks?: number; agentSteps?: number; error?: string }> {
  const tabId = tab.id!;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });

  const scan = (await chrome.tabs.sendMessage(tabId, { cmd: "scan" })) as { fields: FormField[] };
  const fields = scan?.fields ?? [];
  const brainUrl = (opts.brainUrl || (await getBrainUrl())).replace(/\/$/, "");
  const profile = opts.profile ?? (await getProfile());

  let applied = 0;
  let asks = 0;

  if (fields.length) {
    let plan: FillPlan;
    try {
      const res = await fetch(`${brainUrl}/plan-fill`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields, profile }),
      });
      if (!res.ok) return { ok: false, error: `brain ${res.status}` };
      plan = (await res.json()) as FillPlan;
    } catch {
      return { ok: false, error: `couldn't reach the brain at ${brainUrl}` };
    }
    const r = (await chrome.tabs.sendMessage(tabId, { cmd: "apply", fills: plan.fills })) as { applied: number };
    applied = r?.applied ?? 0;
    asks = (plan.asks ?? []).length;

    // Standard fields the heuristic couldn't fill (autocompletes, custom pickers)
    // → hand off to the visual agent loop.
    const done = new Set((plan.fills ?? []).map((f) => f.fieldId));
    const stuck = fields.filter((f) => f.required && !f.sensitive && !done.has(f.id));
    if (stuck.length) {
      const a = await agentLoop(tab, brainUrl, profile);
      applied += a.filled;
    }
    return { ok: true, applied, asks };
  }

  // No standard inputs found — the whole form is likely custom widgets; run the agent.
  const a = await agentLoop(tab, brainUrl, profile);
  return { ok: true, applied: a.filled, asks: 0, agentSteps: a.steps };
}

async function resolveTargetTab(excludeTabId?: number): Promise<chrome.tabs.Tab | null> {
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused && focused.id !== excludeTabId && !RESTRICTED.test(focused.url || "")) return focused;
  const tabs = await chrome.tabs.query({});
  return (
    tabs.filter((t) => t.id !== excludeTabId && t.url && !RESTRICTED.test(t.url))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null
  );
}

async function fillActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || RESTRICTED.test(tab.url || "")) return { ok: false, error: "Open a real website first." };
  return fillTab(tab);
}

// On install, inject the relay into any already-open Pulse tabs so the page
// detects the helper immediately — the user doesn't have to refresh.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ["https://pulse-demo.fly.dev/*", "http://localhost:8787/*"] });
  for (const t of tabs) {
    if (t.id) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["relay.js"] }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === "fillActiveTab") {
    fillActiveTab().then(reply);
    return true;
  }
  if (msg?.type === "fillForPulse") {
    (async () => {
      const target = await resolveTargetTab(sender.tab?.id);
      if (!target?.id) return reply({ ok: false, error: "no form tab" });
      reply(await fillTab(target, { brainUrl: msg.brainUrl, profile: msg.profile }));
    })();
    return true;
  }
  if (msg?.type === "pulsePing") {
    reply({ ok: true });
    return true;
  }
  return false;
});
