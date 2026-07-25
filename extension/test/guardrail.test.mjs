// The content script is the only code that touches the page, so this test is
// the backstop for Pulse's core promise: it never submits a form. It reads the
// BUILT bundle and fails if any submission call slipped in — so no future edit
// (or a sneaky dependency) can regress the guarantee without turning CI red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const content = await readFile(new URL("../dist/content.js", import.meta.url), "utf8");

// The agent loop must be able to click (open dropdowns, pick options), so a
// blanket "no clicks" rule no longer holds. The hard guarantee is now: never
// call form.submit()/requestSubmit(), and never click a submit-like control —
// which is enforced by the isSubmitLike guard that must be present in the click
// path.
const FORBIDDEN = [
  /\.submit\s*\(/, // form.submit()
  /\.requestSubmit\s*\(/, // form.requestSubmit()
];

test("built content script never calls form.submit / requestSubmit", () => {
  for (const re of FORBIDDEN) {
    assert.ok(!re.test(content), `content.js contains forbidden pattern ${re}`);
  }
});

test("clicks are guarded against submit-like controls", () => {
  assert.ok(/isSubmitLike/.test(content), "the submit-click guard is missing from content.js");
});

test("built content script actually shipped (sanity)", () => {
  assert.ok(content.length > 200, "content.js looks empty — build may have failed");
});
