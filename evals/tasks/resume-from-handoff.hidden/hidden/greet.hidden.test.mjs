import test from "node:test";
import assert from "node:assert/strict";
import { greet } from "../app/greet.mjs";

// Hidden from the agent: copied in only when grading.
test("greet() returns exactly hi", () => assert.equal(greet(), "hi"));
