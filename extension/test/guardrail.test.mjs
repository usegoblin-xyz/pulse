// The content script is the only code that touches the page, so this test is
// the backstop for Pulse's core promise: it never submits a form. It reads the
// BUILT bundle and fails if any submission call slipped in — so no future edit
// (or a sneaky dependency) can regress the guarantee without turning CI red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const content = await readFile(new URL("../dist/content.js", import.meta.url), "utf8");

const FORBIDDEN = [
  /\.submit\s*\(/, // form.submit()
  /\.requestSubmit\s*\(/, // form.requestSubmit()
  /type\s*=\s*["'`]submit["'`]/i, // targeting a submit control to click
  /\.click\s*\(/, // no synthetic clicks at all in M1
];

test("built content script contains no form-submission or click calls", () => {
  for (const re of FORBIDDEN) {
    assert.ok(!re.test(content), `content.js contains forbidden pattern ${re}`);
  }
});

test("built content script actually shipped (sanity)", () => {
  assert.ok(content.length > 200, "content.js looks empty — build may have failed");
});
