"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createInferenceSubmissionService,
  inferenceJobName,
  minuteCode,
} = require("../../server/runtime-jobs/inference-submission-service");

test("inference job naming normalizes task and dataset names to the minute", () => {
  const now = new Date(2026, 6, 16, 9, 7);
  assert.equal(minuteCode(now), "202607160907");
  assert.equal(
    inferenceJobName("hanma detect", "train/test", "fallback", now),
    "hanma_detect_train_test_202607160907",
  );
  assert.equal(inferenceJobName("", "", "YOLO v8", now), "YOLO_v8_dataset_202607160907");
});

function createHarness({ cacheFailure } = {}) {
  const calls = [];
  const scheduled = [];
  const project = { id: "project-1", name: "hanma" };
  const algorithm = {
    id: "algorithm-1",
    name: "DINOv3 Faster R-CNN",
    algorithm_key: "dinov3_faster_rcnn",
    framework: "dinov3",
    manifest_key: "manifest.json",
    adapter_key: "adapter.py",
    minio_prefix: "code-assets/algorithms/dino",
  };
  let insertParams;
  const query = async (sql, params) => {
    calls.push(["query", sql, params]);
    if (sql.includes("FROM projects")) return { rows: [project] };
    if (sql.includes("FROM model_revisions")) return { rows: [{ id: "version-1", framework: "dinov3" }] };
    if (sql.includes("INSERT INTO runtime_inference_jobs")) {
      insertParams = params;
      return { rows: [{ id: "job-1", name: params[0], params_json: params[3] }] };
    }
    if (sql.includes("SET output_root")) return { rows: [{ id: "job-1", output_root: params[0] }] };
    if (sql.includes("status='failed'")) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  };
  const service = createInferenceSubmissionService({
    query,
    resourceAccess: {
      assertProjectRead: async (...args) => calls.push(["projectRead", ...args]),
      assertIndependentAccess: async (...args) => calls.push(["independent", ...args]),
      assignOwner: async (...args) => calls.push(["owner", ...args]),
    },
    algorithmAssetService: {
      listAlgorithmAssets: async (_actor, scope) => scope === "public" ? [algorithm] : [],
    },
    prepareInferenceInputCache: async (...args) => {
      calls.push(["cache", ...args]);
      if (cacheFailure) throw cacheFailure;
    },
    fs: { mkdirSync: (...args) => calls.push(["mkdir", ...args]) },
    path: require("node:path").win32,
    storageRoot: "E:\\runtime",
    schedule: (callback) => scheduled.push(callback),
    now: () => new Date(2026, 6, 16, 9, 7),
    logger: { error: (...args) => calls.push(["error", ...args]) },
  });
  return { service, calls, scheduled, algorithm, getInsertParams: () => insertParams };
}

test("submission validates access, selects a framework algorithm, owns the job, and schedules cache preparation", async () => {
  const { service, calls, scheduled, algorithm, getInsertParams } = createHarness();
  const actor = { id: "user-1" };
  const result = await service.createInferenceJob({
    name: "inspect",
    datasetProjectId: "project-1",
    modelVersionId: "version-1",
    params: { device: "cuda:0" },
  }, actor);

  assert.equal(result.id, "job-1");
  assert.equal(result.output_root, "E:\\runtime\\runtime\\inference\\job-1");
  assert.deepEqual(calls.slice(0, 2).map((entry) => entry[0]), ["projectRead", "query"]);
  assert.ok(calls.some((entry) => entry[0] === "independent"));
  assert.ok(calls.some((entry) => entry[0] === "owner"));
  assert.ok(calls.some((entry) => entry[0] === "mkdir"));
  assert.equal(scheduled.length, 1);

  const insertParams = getInsertParams();
  assert.equal(insertParams[0], "inspect_hanma_202607160907");
  const persisted = JSON.parse(insertParams[3]);
  assert.equal(persisted.device, "cuda:0");
  assert.equal(persisted.algorithmAssetId, algorithm.id);
  assert.equal(persisted.algorithmKey, algorithm.algorithm_key);

  await scheduled[0]();
  assert.ok(calls.some((entry) => entry[0] === "cache"));
});

test("cache preparation failures are logged and persisted asynchronously", async () => {
  const failure = new Error("cache unavailable");
  const { service, calls, scheduled } = createHarness({ cacheFailure: failure });
  await service.createInferenceJob({ dataset_project_id: "project-1" }, { id: "user-1" });
  await scheduled[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some((entry) => entry[0] === "error" && entry[2] === failure));
  const failedUpdate = calls.find((entry) => entry[0] === "query" && entry[1].includes("status='failed'"));
  assert.deepEqual(failedUpdate[2], ["cache unavailable", "job-1"]);
});

test("submission rejects missing projects and explicitly requested unknown algorithms", async () => {
  const { service } = createHarness();
  await assert.rejects(service.createInferenceJob({}, { id: "user-1" }), /请选择推理数据集项目/);
  await assert.rejects(
    service.createInferenceJob({ datasetProjectId: "project-1", algorithmAssetId: "missing" }, { id: "user-1" }),
    /算法资产不存在/,
  );
});
