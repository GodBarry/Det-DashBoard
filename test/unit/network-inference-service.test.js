"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createNetworkInferenceService,
  createRunId,
  describePredictions,
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

test("network inference creates artifact-compatible run ids and descriptions", () => {
  assert.match(createRunId(new Date("2026-07-23T14:12:19Z")), /^run_20260723221219_[a-f0-9]{8}$/);
  assert.equal(
    describePredictions([
      { label: "tank" },
      { label: "tank" },
      { label: "hanma" },
    ]),
    "图像中共检测到 3 个目标，包括2 辆坦克、1 辆悍马。",
  );
  assert.equal(describePredictions([]), "本次图像中未检测到符合当前置信度阈值的目标。");
});

test("network inference reconciles stale listener jobs after service restart", async () => {
  const calls = [];
  const service = createNetworkInferenceService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 2, rows: [] };
    },
  });

  const count = await service.reconcileStaleJobs();

  assert.equal(count, 2);
  assert.match(calls[0].sql, /status IN \('preparing','listening','running','stopping'\)/);
  assert.match(calls[0].sql, /networkInference/);
  assert.match(calls[0].params[1], /已中断/);
});
