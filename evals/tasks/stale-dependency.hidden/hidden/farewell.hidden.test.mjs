import test from "node:test";
import assert from "node:assert/strict";
import { farewell } from "../app/farewell.mjs";

// Hidden from the agent: copied in only when grading.
test("farewell() returns exactly bye", () => assert.equal(farewell(), "bye"));
