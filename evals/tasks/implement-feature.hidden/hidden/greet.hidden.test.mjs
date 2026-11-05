import test from "node:test";
import assert from "node:assert/strict";
import { greet } from "../app/greet.mjs";

// Hidden from the agent: copied in only when grading.
test("greet() returns exactly hi, every time", () => {
  assert.equal(typeof greet, "function");
  assert.equal(greet(), "hi");
  assert.equal(greet(), "hi");
});
