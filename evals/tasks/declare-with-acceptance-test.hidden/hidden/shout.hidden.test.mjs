import test from "node:test";
import assert from "node:assert/strict";
import { shout } from "../app/shout.mjs";

// Hidden from the agent: copied in only when grading.
test("shout() upper-cases its input", () => {
  assert.equal(shout("hi"), "HI");
  assert.equal(shout("Hello, World"), "HELLO, WORLD");
});
