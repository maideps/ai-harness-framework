import test from "node:test";
import assert from "node:assert/strict";
import { greet } from "../app/greet.mjs";

// Hidden from the agent: the behavior feature_list.json declares.
test("greet() returns exactly hi", () => assert.equal(greet(), "hi"));
