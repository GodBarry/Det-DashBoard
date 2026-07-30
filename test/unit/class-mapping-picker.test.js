import assert from "node:assert/strict";
import test from "node:test";

import { reconcileClassMappings } from "../../src/components/class-mapping-utils.js";

test("reconcileClassMappings removes sources that are absent from the newly selected datasets", () => {
  assert.deepEqual(
    reconcileClassMappings([
      { target: "vehicle", sources: ["tank", "truck"] },
      { target: "person", sources: ["person"] },
    ], ["tank", "aircraft"]),
    [{ target: "vehicle", sources: ["tank"] }],
  );
});

test("reconcileClassMappings normalizes labels before comparing both dataset selection paths", () => {
  assert.deepEqual(
    reconcileClassMappings([{ target: "Vehicle", sources: [" Tank ", "TRUCK"] }], ["TANK", "truck"]),
    [{ target: "vehicle", sources: ["tank", "truck"] }],
  );
});
