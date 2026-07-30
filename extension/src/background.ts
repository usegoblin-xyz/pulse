// Service worker: orchestrates one fill. It injects the content script into the
// active tab (only on the user's click — activeTab, not a standing content
// script on every page), scans the form, asks the brain for a plan, and hands
// the fills back to the page. The brain URL and profile come from the local
// vault; the model API key lives on the brain, never here.

import { getProfile, getBrainUrl } from "./vault.js";
import type { FormField, FillPlan } from "./types.js";

async function fillActiveTab(): Promise<{ ok: boolean; plan?: FillPlan; applied?: number; error?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: "no active tab" };
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    return { ok: false, error: "Pulse can't act on browser pages — open a real website." };
  }

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });

  const scan = (await chrome.tabs.sendMessage(tab.id, { cmd: "scan" })) as { fields: FormField[] };
  const fields = scan?.fields ?? [];
  if (!fields.length) return { ok: true, plan: { fills: [], asks: [] }, applied: 0 };

  const [profile, brainUrl] = await Promise.all([getProfile(), getBrainUrl()]);
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

  const result = (await chrome.tabs.sendMessage(tab.id, { cmd: "apply", fills: plan.fills })) as {
    applied: number;
  };
  return { ok: true, plan, applied: result?.applied ?? 0 };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "fillActiveTab") {
    fillActiveTab().then(reply);
    return true; // async reply
  }
  return false;
});
