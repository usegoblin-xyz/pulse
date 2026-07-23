# The talking avatar (Anam)

Clicking **Start conversation** on the Pulse landing page brings up a live Anam
avatar — same flow as Kara. The brain mints a short-lived Anam session token
(holding the API key), the page streams the avatar into the video element and
fades the beam poster out.

## Run it

```bash
cd server
cp .env.example .env      # then set ANAM_API_KEY (the same key Kara uses)
npm install && npm run build && npm start
# open http://localhost:8787  ->  click "Start conversation"
```

The brain serves the landing page in dev, so the page and `/session-token` are
one origin — no CORS, no mixed-content. In production you'd host the brain
(which can serve the page) and, if the marketing page stays on GitHub Pages, set
`window.PULSE_BRAIN_URL` in the page to the brain's URL and add that origin to
`PULSE_WEB_ORIGINS`.

## Who Pulse is on the call

- **Avatar:** `a3f92a18-ff4b-405d-9c40-de4acf96f0e4` (the one you provided).
- **Voice:** Laurent — "Dependable Anchor," strong and steady. Swap via
  `PULSE_VOICE_ID`; other male voices in the account are Archie, Corey, Cooper.
- **Brain:** Anam's built-in LLM, driven by the system prompt in
  `server/src/pulse-prompt.ts` — that's the file to edit to change how Pulse
  talks. It's written for text-to-speech (short sentences, no symbols, numbers
  spoken) and repeats the never-submit guardrails in speech.
- **Greeting:** Pulse speaks first (`PULSE_GREETING`).

## Two layers, one persona

This is the *conversation* layer — Pulse can talk. It does not yet drive the
form-fill tools from voice; that join (voice asks → the M1 planner fills the
page) is a later milestone. The system prompt already tells Pulse never to
submit without a spoken yes, and the M1 code enforces it structurally, so the
two stay consistent when they're wired together.
