import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyBlockers } from "./bodyBlockers.mjs";

test("Blocked by line", () => {
  assert.deepEqual(bodyBlockers("Blocked by: #12, #7\n\n## Problem\nsee #99"), [12, 7]);
});
test("Blocked by section stops at the next heading", () => {
  const body = "## Problem\nsee #1\n\n## Blocked by\n\n- #5\n- #6 (later)\n\n## Acceptance\n- #8";
  assert.deepEqual(bodyBlockers(body), [5, 6]);
});
test("section at end of body, repeated numbers", () => {
  assert.deepEqual(bodyBlockers("## Blocked by\n- #5\n- #5"), [5]);
});
test("no blockers", () => {
  assert.deepEqual(bodyBlockers("Fixes nothing, mentions #3"), []);
  assert.deepEqual(bodyBlockers(null), []);
});
