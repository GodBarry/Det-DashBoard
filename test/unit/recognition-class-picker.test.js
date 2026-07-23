import assert from "node:assert/strict";
import test from "node:test";

import {
  moveRecognitionClass,
  parseRecognitionClasses,
} from "../../src/components/recognition-class-utils.js";

test("recognition class parser accepts spaces and common Chinese separators", () => {
  assert.deepEqual(
    parseRecognitionClasses("tank fasheche、car，truck;bus\nvan tank"),
    ["tank", "fasheche", "car", "truck", "bus", "van"],
  );
});

test("recognition class reorder preserves all values and moves one index", () => {
  assert.deepEqual(
    moveRecognitionClass(["car", "tank", "truck"], 2, 0),
    ["truck", "car", "tank"],
  );
});
