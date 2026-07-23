"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  networkRunnerKind,
  parseImage,
} = require("../../server/runtime-jobs/network-inference-service");

test("network inference maps every supported algorithm to an explicit runner", () => {
  assert.equal(networkRunnerKind("ultralytics_yolo"), "ultralytics_yolo");
  assert.equal(networkRunnerKind("dinov3_faster_rcnn"), "dinov3_faster_rcnn");
  assert.equal(networkRunnerKind("dummy_empty_detector"), "builtin");
  assert.equal(networkRunnerKind("fake_reference_detector"), "builtin");
  assert.equal(networkRunnerKind("unregistered_detector"), null);
});

test("network inference parses JSON base64 and preserves remote identifiers", () => {
  const bytes = Buffer.from("image");
  const parsed = parseImage(Buffer.from(JSON.stringify({
    imageBase64: bytes.toString("base64"),
    filename: "frame.jpg",
    sessionId: "remote-session",
    projectImageId: "remote-image",
  })), "application/json", {});

  assert.deepEqual(parsed.bytes, bytes);
  assert.equal(parsed.filename, "frame.jpg");
  assert.equal(parsed.sessionId, "remote-session");
  assert.equal(parsed.remoteProjectImageId, "remote-image");
});
