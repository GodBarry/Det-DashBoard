"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMlRoutes } = require("../../server/routes/ml-routes");

function createHarness(overrides = {}) {
  const calls = [];
  const runtimeJobService = {
    listTrainingJobs: async (...args) => ({ type: "training", args }),
    createTrainingJob: async () => ({ id: "train-1" }),
    requeueTrainingJob: async () => ({ id: "train-1", status: "queued" }),
    pauseTrainingJob: async () => ({ id: "train-1", status: "paused" }),
    resumeTrainingJob: async () => ({ id: "train-1", status: "queued" }),
    deleteTrainingJob: async () => ({ deleted: "train-1" }),
    listInferenceJobs: async (...args) => ({ type: "inference", args }),
    listInferenceLogs: async () => [{ id: 1, stream: "stdout", line: "running" }],
    requeueInferenceJob: async () => ({ id: "infer-1", status: "queued" }),
    deleteInferenceJob: async () => ({ deleted: "infer-1" }),
    getInferenceEvaluation: async () => ({ precision: 0.8 }),
    listInferenceResults: async () => [{ id: "result-1" }],
  };
  const deps = {
    query: async () => ({ rows: [] }),
    readBody: async () => ({ direction: "up", name: "asset" }),
    sendJson: (_res, body) => calls.push(["sendJson", body]),
    requestedScope: () => "mine",
    accessControl: { requireAdmin: (actor) => calls.push(["admin", actor.id]) },
    resourceAccess: {
      assertIndependentAccess: async (...args) => calls.push(["independent", ...args]),
      assertTrainingJobWrite: async (...args) => calls.push(["trainingWrite", ...args]),
      assertTrainingJobRead: async (...args) => calls.push(["trainingRead", ...args]),
      assertInferenceJobWrite: async (...args) => calls.push(["inferenceWrite", ...args]),
      assertInferenceJobRead: async (...args) => calls.push(["inferenceRead", ...args]),
    },
    modelService: {
      listMlModels: async (...args) => ({ args }),
      createMlModel: async () => ({ id: "model-1" }),
      listModelVersions: async (...args) => ({ args }),
      createModelVersion: async () => ({ id: "version-1" }),
      renameModelVersion: async () => ({ id: "version-1", name: "renamed" }),
      streamModelArtifact: async (...args) => calls.push(["modelStream", ...args.slice(1)]),
    },
    modelMaintenanceService: { clearModelAssets: async () => ({ cleared: 2 }) },
    algorithmAssetService: { listAlgorithmAssets: async () => [] },
    runtimeAssetLinkService: { listLinks: async () => [] },
    trainingCatalogService: {
      listTrainingTemplates: async () => [],
      createTrainingTemplate: async () => ({ id: "template-1" }),
      listDatasetSnapshots: async () => [],
    },
    pythonEnvService: {
      listPythonEnvs: async () => [],
      createPythonEnv: async () => ({ id: "env-1" }),
      streamPythonEnvArtifact: async (...args) => calls.push(["envStream", ...args.slice(1)]),
    },
    runtimeQueueService: {
      moveRuntimeJobPriority: async (...args) => {
        calls.push(["priority", ...args]);
        return { id: args[1], direction: args[2] };
      },
    },
    runtimeJobService,
    createInferenceJob: async () => ({ id: "infer-1" }),
    ...overrides,
  };
  return { routes: createMlRoutes(deps), calls };
}

const request = (method) => ({ method });
const parsed = (pathname, query = {}) => ({ pathname, query });

test("ML routes ignore non-ML paths", async () => {
  const { routes, calls } = createHarness();
  assert.equal(await routes.handle(request("GET"), {}, parsed("/api/projects"), { id: "user-1" }), false);
  assert.deepEqual(calls, []);
});

test("model version listing preserves model id, actor, scope, and response", async () => {
  const { routes, calls } = createHarness();
  const actor = { id: "user-1" };
  await routes.handle(request("GET"), {}, parsed("/api/ml/model-versions", { model_id: "model-4" }), actor);
  assert.deepEqual(calls, [["sendJson", { versions: { args: ["model-4", actor, "mine"] } }]]);
});

test("training priority checks ownership and targets the training queue", async () => {
  const { routes, calls } = createHarness();
  const actor = { id: "user-1" };
  await routes.handle(request("PATCH"), {}, parsed("/api/ml/training-jobs/train-7/priority"), actor);
  assert.deepEqual(calls, [
    ["trainingWrite", actor, "train-7"],
    ["priority", "runtime_training_jobs", "train-7", "up", actor],
    ["sendJson", { job: { id: "train-7", direction: "up" } }],
  ]);
});

test("training logs keep reverse chronological query and chronological response", async () => {
  const { routes, calls } = createHarness({
    query: async (sql, params) => {
      assert.match(sql, /ORDER BY id DESC LIMIT 300/);
      assert.deepEqual(params, ["train-3"]);
      return { rows: [{ id: 2 }, { id: 1 }] };
    },
  });
  const actor = { id: "user-1" };
  await routes.handle(request("GET"), {}, parsed("/api/ml/training-jobs/train-3/logs"), actor);
  assert.deepEqual(calls, [
    ["trainingRead", actor, "train-3"],
    ["sendJson", { logs: [{ id: 1 }, { id: 2 }] }],
  ]);
});

test("inference evaluation checks read access before returning metrics", async () => {
  const { routes, calls } = createHarness();
  const actor = { id: "user-1" };
  await routes.handle(request("GET"), {}, parsed("/api/ml/inference-jobs/infer-8/evaluation"), actor);
  assert.deepEqual(calls, [
    ["inferenceRead", actor, "infer-8"],
    ["sendJson", { evaluation: { precision: 0.8 } }],
  ]);
});

test("inference logs check read access and preserve chronological rows", async () => {
  const { routes, calls } = createHarness();
  const actor = { id: "user-1" };

  await routes.handle(request("GET"), {}, parsed("/api/ml/inference-jobs/infer-1/logs"), actor);

  assert.deepEqual(calls, [
    ["inferenceRead", actor, "infer-1"],
    ["sendJson", { logs: [{ id: 1, stream: "stdout", line: "running" }] }],
  ]);
});

test("model downloads preserve access, artifact selection, and stream order", async () => {
  const { routes, calls } = createHarness();
  const actor = { id: "user-1" };
  await routes.handle(
    request("GET"),
    { id: "response" },
    parsed("/api/ml/model-versions/version-2/download", { artifact_id: "artifact-9" }),
    actor,
  );
  assert.deepEqual(calls, [
    ["independent", "model_revisions", "version-2", actor, "read"],
    ["modelStream", "version-2", "artifact-9"],
  ]);
});
