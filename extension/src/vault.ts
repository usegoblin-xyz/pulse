// The profile vault. Lives in chrome.storage.local — on the user's device,
// never in server state. Pulse's promise is that your saved details stay yours;
// this is the only place they persist.

import type { Profile } from "./types.js";

const PROFILE_KEY = "pulse.profile";
const BRAIN_KEY = "pulse.brainUrl";
const DEFAULT_BRAIN = "http://localhost:8787";

export async function getProfile(): Promise<Profile> {
  const got = await chrome.storage.local.get(PROFILE_KEY);
  const p = got[PROFILE_KEY];
  return p && typeof p === "object" ? (p as Profile) : {};
}

export async function setProfile(p: Profile): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_KEY]: p });
}

export async function getBrainUrl(): Promise<string> {
  const got = await chrome.storage.local.get(BRAIN_KEY);
  return (got[BRAIN_KEY] as string) || DEFAULT_BRAIN;
}

export async function setBrainUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [BRAIN_KEY]: url.replace(/\/$/, "") });
}
