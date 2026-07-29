"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeClasses } = require("../../server/ml-assets/model-weight-inspector");

test("model weight labels preserve numeric class order and remove duplicates", () => {
  assert.deepEqual(normalizeClasses({ 2: "truck", 0: "car", 1: "tank" }), ["car", "tank", "truck"]);
  assert.deepEqual(normalizeClasses(["car", "tank", "car", ""]), ["car", "tank"]);
});
