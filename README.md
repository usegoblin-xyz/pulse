# Pulse

**Live demo: [pulse-demo.fly.dev](https://pulse-demo.fly.dev/)**
**Landing page: [usegoblin-xyz.github.io/pulse](https://usegoblin-xyz.github.io/pulse/)**

Pulse is the fast, accurate research partner on your screen. He reads the whole
web for you, sees what you are looking at, and comes back with the answer and
where it came from. He also writes detailed PRDs in the background while you
keep working.

Full character definition, voice rules, and hard guardrails: [PERSONA.md](PERSONA.md).

## What is running today (the demo)

A single Fly.io app serves the front end and the brain API. The brain holds
every key; the client holds none. The conversational layer is the Anam avatar
with its built-in LLM, minted through `/session-token`, with four client tools
declared server-side at mint:

- `web_search` -> `/research/search`. Live web search. Sources render in a
  side panel and a Files box, and Pulse gets a digest with a standing
  instruction to always say which source the answer came from.
- `read_page` -> `/research/read`. Full-page reads with title and screenshot,
  handed back for reasoning.
- `look_at_screen` -> `/see`. The user clicks Share screen; Pulse grabs a
  frame only when his LLM decides to look. No ambient capture loop.
- `build_prd` -> `/prd-stream`. A background SSE stream that writes the PRD
  into the Files box while the conversation continues, announces when it is
  ready to download, and degrades politely on rate limits.

Companion Mode opens a document picture-in-picture window (340x560) with the
avatar and a mirrored sources and docs panel, so Pulse rides along while you
work in other windows. The client streams its own transcript to `/transcript`
because Anam's server transcripts come back empty for Pulse.

The demo app's server code lives outside this repo. This repo holds the
landing page, the persona definition, and the visual masters.

## Layout

- `site/` — the landing page. Self-contained: open `site/index.html` directly
  or serve the folder statically. Live via GitHub Pages (root index.html
  forwards to `site/`). The poster is `pulse-beam-loop.mp4` (17.2 MB,
  seamless 20 s palindrome loop) referenced by relative path. Gulax font
  (Velvetyne, SIL OFL — `fonts/LICENSE.txt` must travel with the page) is
  used for the wordmark only.
- `masters/` — the source beam assets (4K still, 2K static master, and the
  baked loop). How they were made: `docs/sessions/2026-07-23-origin.md`.
- `docs/beam-effect.md` — recipe for the materialization beam look, copied
  from the Kara-3 repo where the effect originated.

## History

Pulse began as an on-screen copilot concept: a browser extension that filled
forms and guided navigation through hostile sites. That direction was
superseded by the research partner that shipped as the demo above. The old
spec lives in git history; the lore, the visual identity, and the Kara-3
plumbing (turn loop hardening, the Anam client, the Companion window pattern)
carried over.

## Provenance

Started 2026-07-23, split out of the Kara-3 repo (files formerly at
`personas/pulse/`; session history in Kara-3's `docs/sessions/2026-07-23-pulse.md`).
