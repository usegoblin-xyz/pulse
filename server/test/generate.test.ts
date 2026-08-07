import { test } from "node:test";
import assert from "node:assert/strict";
import { isUsablePrd } from "../src/generate.js";

// The empty-output guard is what turns a dead/flaky model response into a
// surfaced error (and a non-streaming retry) instead of a silent blank doc.
test("isUsablePrd rejects empty and half-dead completions", () => {
  assert.equal(isUsablePrd(""), false);
  assert.equal(isUsablePrd("   \n  "), false);
  assert.equal(isUsablePrd("# PRD\n\nSorry, I can't."), false); // too short to be a real PRD
});

test("isUsablePrd accepts a full-length document", () => {
  const doc = "# Title\n\n## Summary\n" + "This is a real, detailed section. ".repeat(20);
  assert.equal(isUsablePrd(doc), true);
});
