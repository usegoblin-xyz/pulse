# Pulse

**Live demo: [pulse-demo.fly.dev](https://pulse-demo.fly.dev)**

Pulse is the voice research partner on your screen. He reads the whole live web
for you and comes back with the answer and where it came from, sees what you're
looking at when you share your screen, and spins up detailed PRDs in the
background while you keep talking to him. Fast, accurate, and built to make you
a far better generative AI researcher.

A real-time interactive avatar built on Anam's Cara 4 model.

Full character definition, voice rules, and hard guardrails: [PERSONA.md](PERSONA.md).

## Layout

- `server/` — the brain. Node server that mints Anam session tokens and holds
  every API key (Anam, OpenRouter for vision + PRD writing, Nimble for web
  search). Deployed on Fly, always-warm, and serves the front-end too.
- `site/` — the front-end (vanilla JS, no framework). Served by the brain at
  [pulse-demo.fly.dev](https://pulse-demo.fly.dev). The poster is
  `pulse-beam-loop.mp4` (17.2 MB,
  seamless 20 s palindrome loop) referenced by relative path; swap to a CDN URL
  once hosting is settled. Gulax font (Velvetyne, SIL OFL — `fonts/LICENSE.txt`
  must travel with the page) is used for the wordmark only.
- `masters/` — the source beam assets (4K still, 2K static master, and the
  baked loop). How they were made: `docs/sessions/2026-07-23-origin.md`.
- `docs/beam-effect.md` — recipe for the materialization beam look, copied from
  the Kara-3 repo where the effect originated. Pulse's loop was built with it.

## What Pulse does

A voice-driven research copilot. You talk to him; he works.

- **Live web research, cited** — searches the web (Nimble SERP) and reads pages
  in full (headless browser), then answers in plain speech and names his sources.
- **Screen vision, on demand** — share your screen and ask; an open vision model
  (via OpenRouter) reads what's on it and he tells you. He looks only when asked.
- **Background PRD writing** — ask for a product spec and he researches and writes
  a full PRD, streaming it into the Files box while you keep chatting, then hands
  you the download.
- **Companion mode** — pops into a floating window (document picture-in-picture)
  with your files, so he travels across tabs and apps.

Ask him "who are you" and he'll tell you: *it does not matter who I am, what
matters is his plan* — to make you a far better generative AI researcher.

Guardrails: no API key ever reaches the browser (the brain holds them all);
vision and research run only when the conversation calls for it.

## Provenance

Started 2026-07-23, split out of the Kara-3 repo (files formerly at
`personas/pulse/`; session history in Kara-3's `docs/sessions/2026-07-23-pulse.md`).
