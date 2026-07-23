# Milestone 1 — form filling, text-only

The first working slice of Pulse: read the form on the current page, fill what
your saved profile covers, and **never submit**. No voice, no avatar, no
navigation yet — those are M2–M4.

## Shape

```
extension/   MV3 browser extension (ships to the browser — no secrets here)
  src/content.ts     reads fields, applies fills. The ONLY code that touches the page.
  src/background.ts   injects content on click, calls the brain, hands back fills
  src/popup.ts + popup.html   edit the local vault, trigger a fill
  src/vault.ts        profile + brain URL in chrome.storage.local (on-device only)
server/      the "brain": a tiny key-holding proxy (Node, zero deps)
  src/planner.ts      PURE fill planner — every guardrail lives here
  src/model.ts        OpenAI-compatible adapter (GLM by default, swap by env)
  src/server.ts       POST /plan-fill { fields, profile } -> { fills, asks }
```

The split exists because the model API key can't ship in a public browser
bundle. The extension sends field metadata + your profile to the brain; the
brain calls the model and returns a plan.

## Guardrails (enforced by code + tests, not by prompting)

- **Never submit.** The planner's output type has no "submit"/"click"/"navigate"
  field, so no model output can produce one. The content script contains no
  `.submit()`, `.requestSubmit()`, or `.click()` — a test greps the built
  bundle to keep it that way.
- **Sensitive fields stay with you.** Passwords, card numbers, SSNs, etc. are
  classified on both sides, never sent to the model, and never auto-filled —
  they come back as "asks" for you to type yourself.
- **Profile scrubbing.** Sensitive-looking profile keys are stripped before the
  profile is sent to the model.
- **Vault is local.** Your details live in `chrome.storage.local`, never in
  server state.

## Run it

```bash
# 1. brain
cd server && npm install
PULSE_MODEL_API_KEY=<your Z.ai key> PULSE_MODEL=glm-4.6-flash npm run build && npm start
#   defaults: base https://api.z.ai/api/paas/v4 — override PULSE_MODEL_BASE_URL /
#   PULSE_MODEL to point at Gemini's OpenAI endpoint, OpenRouter, Groq, Claude, etc.

# 2. extension
cd extension && npm install && npm run build
#   Chrome → chrome://extensions → Developer mode → Load unpacked → extension/dist
#   Click Pulse, paste your details as JSON, Save, then "Fill this form" on any page.
```

## Model note

Defaults to the free Z.ai GLM Flash tier. Because the adapter is
OpenAI-compatible, switching providers (or back to Claude when credits return)
is an env change, not a code change. Free Flash models are weaker at tool-use
than Claude, which is exactly why the never-submit guardrail is structural and
the human stays in the loop.

## Not yet (later milestones)

Voice + the picture-in-picture avatar (M2), guided highlight navigation (M3),
driven navigation with per-step confirmation (M4). See `../README.md`.
