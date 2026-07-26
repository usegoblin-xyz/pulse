# Chrome Web Store listing — copy

## Name
Pulse — form autofill

## Summary (132 char max)
Pulse fills web forms from your own saved details. It reads the page, fills what it can, and never submits — that stays your call.

## Description
Pulse is the hands for the boring web. Save your details once, and Pulse fills them into forms for you — name, email, phone, address, company, and more — on whatever site you're on.

- Fills standard fields instantly, and works out the tricky ones too.
- Never fills passwords, card numbers, or security codes. Those are always yours to type.
- Never submits a form for you. It fills; you review and send.
- Your saved details stay on your device.

Pulse pairs with the Pulse assistant at usegoblin.xyz, but the extension works on its own from the popup: save your details, open a form, click "Fill this form."

## Category
Productivity

## Language
English

## Privacy policy URL
https://pulse-demo.fly.dev/privacy.html

## Single purpose
Fill web forms from the user's own saved details.

## Permission justifications
Install-time permissions are minimal; broad site access is optional and only
requested at runtime when the user turns on hands-free fill.

- **activeTab** — when the user clicks the Pulse icon and "Fill this form", grants access to just that one tab to read and fill it. No standing access.
- **scripting** — to inject the content script that reads the form and types the values into the page the user asked to fill.
- **storage** — to keep the user's saved details (name, email, address, etc.) locally on their device.
- **optional: tabs + host access (all sites)** — NOT requested at install. Only requested at runtime, via a Chrome prompt the user approves, when they enable "hands-free fill" so Pulse can fill a form on another tab by voice. It acts only on the user's request, never in the background, and never reads or transmits page contents beyond the form's field structure.

## Data usage disclosures
- Collects personally identifiable information (name, address, email, phone) that the user chooses to save — used only to fill forms.
- Does not sell or transfer user data to third parties except service providers used to perform the fill.
- Does not use the data for anything unrelated to the single purpose.
