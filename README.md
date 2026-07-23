# Pulse

**Live landing page: [usegoblin-xyz.github.io/pulse](https://usegoblin-xyz.github.io/pulse/)**

Pulse is the agent on your screen that fills the forms, finds the buttons, and
walks you through the web's most stubborn sites. Where Kara makes things,
Pulse gets things done.

Full character definition, voice rules, and hard guardrails: [PERSONA.md](PERSONA.md).

## Layout

- `site/` — the landing page. Self-contained: open `site/index.html` directly
  or serve the folder statically.
  Live at https://usegoblin-xyz.github.io/pulse/ via GitHub Pages (root index.html
  forwards to `site/`). The poster is `pulse-beam-loop.mp4` (17.2 MB,
  seamless 20 s palindrome loop) referenced by relative path; swap to a CDN URL
  once hosting is settled. Gulax font (Velvetyne, SIL OFL — `fonts/LICENSE.txt`
  must travel with the page) is used for the wordmark only.
- `masters/` — the source beam assets (4K still, 2K static master, and the
  baked loop). How they were made: `docs/sessions/2026-07-23-origin.md`.
- `docs/beam-effect.md` — recipe for the materialization beam look, copied from
  the Kara-3 repo where the effect originated. Pulse's loop was built with it.

## Roadmap (agreed milestones, none started)

The product is a voice-driven on-screen copilot: a browser-extension content
script exposing five tools to the brain (read_page, fill_fields, highlight,
click, scroll_to), an Anam avatar in a document picture-in-picture window, and
a profile vault in `chrome.storage.local` so personal values never transit the
server. Turn-loop hardening (utterance dedupe, newest-wins abort) is ported
from Kara-3's `src/fast-brain.js`.

1. Form filling, text-only (extension + vault + fill/read tools)
2. Voice + the PiP avatar window
3. Guided navigation (highlight ring, element-by-element pointing)
4. Driven navigation (Pulse clicks, pausing at every point of no return)

Non-negotiable guardrails regardless of milestone: never submit, pay, sign, or
delete without a spoken confirmation; payment and password fields are read-only
unless the user dictates the value in the moment; vault stays local.

## Provenance

Started 2026-07-23, split out of the Kara-3 repo (files formerly at
`personas/pulse/`; session history in Kara-3's `docs/sessions/2026-07-23-pulse.md`).
