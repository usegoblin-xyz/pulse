# Publishing Pulse to the Chrome Web Store

Goal: turn "load unpacked in developer mode" into a one-click **Add to Chrome**.
Everything below is prepared; these are the steps only you can do (they need your
account and the one-time fee).

## One-time setup (~15 min, $5)
1. Go to the **[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)** and sign in with the Google account you want to own the listing.
2. Pay the **one-time $5 developer registration fee**.

## Upload the package
3. Build the zip (already scripted):
   ```bash
   cd extension && npm run pack      # writes extension/pulse-extension.zip
   ```
4. In the dashboard → **New item** → upload `pulse-extension.zip`.

## Fill the listing (copy is in `listing.md`)
5. **Name / summary / description** — paste from `listing.md`.
6. **Icon** — the store pulls the 128px icon from the package automatically (`icons/icon-128.png`).
7. **Screenshots** — add at least one 1280×800 screenshot (a shot of Pulse filling the sample form works; `pulse-demo.fly.dev/sample.html` + the popup).
8. **Category:** Productivity. **Language:** English.
9. **Privacy:**
   - Privacy policy URL: **https://pulse-demo.fly.dev/privacy.html** (already hosted).
   - Single purpose: "Fill web forms from the user's own saved details."
   - Justify each permission with the lines in `listing.md` → *Permission justifications*. The broad host access (`<all_urls>`) is the one reviewers scrutinize; the justification explains it fills forms on whatever site the user is on, only on their trigger.
   - Data use: declare that personally identifiable info (name, address, etc.) is handled, **used only to fill forms**, **not sold**, **not used for unrelated purposes**.
10. **Submit for review.** Approval typically takes a few days.

## After it's approved
11. Copy the published listing URL (looks like `https://chromewebstore.google.com/detail/<id>`).
12. Tell me the URL — I'll set `window.PULSE_EXTENSION_URL` on the Pulse page so the in-app **"Add to Chrome"** prompt one-clicks straight to it. That's the frictionless install for every user.

Optional before wide launch: submit as **Unlisted** first (same one-click link for people you invite, but not publicly searchable) to test the flow, then flip to Public.
