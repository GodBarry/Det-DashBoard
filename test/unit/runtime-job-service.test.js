const test = require("node:test");
const assert = require("node:assert/strict");

const { createRuntimeJobService } = require("../../server/runtime-jobs/job-service");

function createService(query, overrides = {}) {
  return createRuntimeJobService({
    query,
    scopedSql: () => ({ sql: "TRUE", params: [] }),
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    evaluateDetections: () => ({ summary: {}, errors: [] }),
    normalizeTrainingDatasetSplits: () => ({
      trainProjectIds: [],
      valProjectIds: [],
      testProjectIds: [],
    }),
    normalizeTrainingDatasetFilters: () => ({}),
    resourceAccess: {
      assertIndependentAccess: async () => {},
      assertProjectRead: async () => {},
      assignOwner: async () => {},
    },
    pythonEnvService: { resolveRuntimePythonEnv: async (env) => env },
    storageRoot: "storage",
    fs: { mkdirSync: () => {} },
    path: { join: (...parts) => parts.join("/") },
    stopProcess: () => false,
    appendTrainingLog: async () => {},
    ...overrides,
  });
}

test("listTrainingJobs applies the requested scope and formats dataset selections", async () => {
  const calls = [];
  const scopedCalls = [];
  const normalizationCalls = [];
  const actor = { id: "user-1", role: "member" };
  const params = {
    trainProjectIds: ["project-train"],
    valProjectIds: ["project-val"],
    initializationStrategy: "pretrained",
    initialModelVersionId: "revision-1",
    resume: true,
  };
  const service = createService(async (sql, queryParams) => {
    calls.push({ sql, params: queryParams });
    if (sql.includes("FROM runtime_training_jobs")) {
      return {
        rows: [{
          id: "training-1",
          params_json: params,
          dataset_project_id: "legacy-project",
          dataset_project_name: "Legacy dataset",
          initialization_strategy: "random",
          initial_model_version_id: null,
          resume_from_checkpoint: false,
        }],
      };
    }
    return {
      rows: [
        { id: "project-train", name: "Training set" },
        { id: "project-val", name: "Validation set" },
      ],
    };
  }, {
    scopedSql: (table, alias, receivedActor, scope) => {
      scopedCalls.push({ table, alias, actor: receivedActor, scope });
      return { sql: "tj.created_by_user_id=$1", params: [receivedActor.id] };
    },
    normalizeTrainingDatasetSplits: (body, receivedParams, fallbackId) => {
      normalizationCalls.push({ body, params: receivedParams, fallbackId });
      return {
        trainProjectIds: ["project-train"],
        valProjectIds: ["project-val"],
        testProjectIds: ["project-missing"],
      };
    },
  });

  const jobs = await service.listTrainingJobs(actor, "shared");

  assert.deepEqual(scopedCalls, [{
    table: "runtime_training_jobs",
    alias: "tj",
    actor,
    scope: "shared",
  }]);
  assert.match(calls[0].sql, /WHERE tj\.created_by_user_id=\$1/);
  assert.match(calls[0].sql, /ORDER BY tj\.priority DESC, tj\.created_at DESC, tj\.id DESC/);
  assert.deepEqual(calls[0].params, [actor.id]);
  assert.deepEqual(calls[1].params, [["project-train", "project-val", "project-missing"]]);
  assert.deepEqual(normalizationCalls, [{ body: {}, params, fallbackId: "legacy-project" }]);
  assert.deepEqual(jobs[0].trainProjectNames, ["Training set"]);
  assert.deepEqual(jobs[0].valProjectNames, ["Validation set"]);
  assert.deepEqual(jobs[0].testProjectNames, ["project-missing"]);
  assert.equal(jobs[0].dataset_project_name, "Training set");
  assert.equal(jobs[0].initializationStrategy, "pretrained");
  assert.equal(jobs[0].initialModelVersionId, "revision-1");
  assert.equal(jobs[0].resume, true);
});

test("normalizeTrainingInitialization checks access and selects the requested checkpoint", async () => {
  const accessCalls = [];
  const queryCalls = [];
  const actor = { id: "user-1" };
  const service = createService(async (sql, params) => {
    queryCalls.push({ sql, params });
    return {
      rows: [{
        id: "revision-1",
        version_name: "epoch-20",
        model_name: "Detector",
        stage: "training",
        framework: "ultralytics",
        checkpoint: { id: "file-last", path: "weights/last.pt" },
      }],
    };
  }, {
    resourceAccess: {
      assertIndependentAccess: async (...args) => accessCalls.push(args),
    },
  });

  const result = await service.normalizeTrainingInitialization({
    initialModelVersionId: "revision-1",
    initializationStrategy: "training",
    resume: true,
  }, {}, actor);

  assert.deepEqual(accessCalls, [["model_revisions", "revision-1", actor, "read"]]);
  assert.deepEqual(queryCalls[0].params, ["revision-1", "training"]);
  assert.match(queryCalls[0].sql, /metadata_json->>'weightRole'='last'/);
  assert.deepEqual(result, {
    strategy: "training",
    versionId: "revision-1",
    resume: true,
    checkpoint: {
      id: "file-last",
      path: "weights/last.pt",
      versionId: "revision-1",
      versionName: "epoch-20",
      modelName: "Detector",
      stage: "training",
      framework: "ultralytics",
    },
  });
});

test("createTrainingJob persists normalized parameters, ownership, output path, and queue log", async () => {
  const calls = [];
  const accessCalls = [];
  const mkdirCalls = [];
  const ownerCalls = [];
  const filterCalls = [];
  const actor = { id: "user-1" };
  let insertedParams;
  const projects = [
    { id: "project-train", name: "Train Set" },
    { id: "project-val", name: "Validation Set" },
  ];
  const service = createService(async (sql, params) => {
    calls.push({ sql, params });
    if (sql === "SELECT id, name FROM projects WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL") return { rows: projects };
    if (sql === "SELECT * FROM runtime_envs WHERE id=$1") return { rows: [{ id: "env-1", python_path: "old-python" }] };
    if (sql.includes("FROM model_revisions mv JOIN model_clusters")) {
      return {
        rows: [{
          id: "revision-1",
          version_name: "epoch-20",
          model_name: "Detector",
          stage: "training",
          framework: "ultralytics",
          checkpoint: { id: "file-last", path: "weights/last.pt" },
        }],
      };
    }
    if (sql.includes("INSERT INTO runtime_training_jobs")) {
      insertedParams = JSON.parse(params[4]);
      return { rows: [{ id: "job-1", dataset_project_id: "project-train", params_json: insertedParams }] };
    }
    if (sql.startsWith("UPDATE runtime_training_jobs SET output_root")) {
      return { rows: [{ id: "job-1", dataset_project_id: "project-train", params_json: insertedParams }] };
    }
    if (sql === "SELECT id, name FROM projects WHERE id=ANY($1::uuid[])") return { rows: projects };
    return { rows: [] };
  }, {
    normalizeTrainingDatasetSplits: () => ({
      trainProjectIds: ["project-train"],
      valProjectIds: ["project-val"],
      testProjectIds: [],
    }),
    normalizeTrainingDatasetFilters: (body, params) => {
      filterCalls.push({ body, params: { ...params } });
      return { train: { scene: ["day"] } };
    },
    resourceAccess: {
      assertProjectRead: async (...args) => accessCalls.push(["project", ...args]),
      assertIndependentAccess: async (...args) => accessCalls.push(["independent", ...args]),
      assignOwner: async (...args) => ownerCalls.push(args),
    },
    pythonEnvService: {
      resolveRuntimePythonEnv: async (env) => ({ ...env, python_path: "resolved-python" }),
    },
    storageRoot: "data-root",
    fs: { mkdirSync: (...args) => mkdirCalls.push(args) },
  });
  const body = {
    name: "Training job",
    pythonEnvId: "env-1",
    initialModelVersionId: "revision-1",
    initializationStrategy: "training",
    resume: true,
    savePeriod: 3,
    params: { epochs: 12 },
  };

  const result = await service.createTrainingJob(body, actor);

  assert.deepEqual(accessCalls, [
    ["project", actor, "project-train"],
    ["project", actor, "project-val"],
    ["independent", "runtime_envs", "env-1", actor, "read"],
    ["independent", "model_revisions", "revision-1", actor, "read"],
  ]);
  assert.deepEqual(ownerCalls, [["runtime_training_jobs", "job-1", actor]]);
  assert.deepEqual(mkdirCalls, [["data-root/runtime/training/job-1", { recursive: true }]]);
  assert.equal(filterCalls.length, 1);
  assert.equal(insertedParams.python, "resolved-python");
  assert.equal(insertedParams.initializationStrategy, "training");
  assert.equal(insertedParams.resume, true);
  assert.equal(insertedParams.save_period, 3);
  assert.deepEqual(insertedParams.datasetFilters, { train: { scene: ["day"] } });
  const insertCall = calls.find((call) => call.sql.includes("INSERT INTO runtime_training_jobs"));
  assert.equal(insertCall.params[5], 12);
  assert.equal(insertCall.params[6], "已进入训练队列，等待训练 worker 接管");
  const initializationUpdate = calls.find((call) => call.sql.includes("SET initial_model_version_id"));
  assert.deepEqual(initializationUpdate.params, ["revision-1", "training", true, 3, "job-1"]);
  const logCall = calls.find((call) => call.sql.startsWith("INSERT INTO runtime_training_logs"));
  assert.deepEqual(logCall.params, ["job-1", "system", "queued: ultralytics_yolo_detect; datasets=Train Set"]);
  assert.equal(result.trainProjectNames[0], "Train Set");
});

test("requeueTrainingJob resets queue state and records the requeue", async () => {
  const calls = [];
  const mkdirCalls = [];
  const logCalls = [];
  const service = createService(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT *")) return { rows: [{ id: "job-1", params_json: { epochs: 4, batch: 8 }, total_epochs: 3 }] };
    return { rows: [{ id: "job-1", status: "pending" }] };
  }, {
    storageRoot: "data-root",
    fs: { mkdirSync: (...args) => mkdirCalls.push(args) },
    appendTrainingLog: async (...args) => logCalls.push(args),
  });

  const result = await service.requeueTrainingJob("job-1", { params: { epochs: 9 } });

  assert.deepEqual(mkdirCalls, [["data-root/runtime/training/job-1", { recursive: true }]]);
  assert.match(calls[1].sql, /process_pid=NULL, heartbeat_at=NULL, started_at=NULL, finished_at=NULL/);
  assert.deepEqual(JSON.parse(calls[1].params[0]), { epochs: 9, batch: 8 });
  assert.deepEqual(calls[1].params.slice(1), [9, "data-root/runtime/training/job-1", "已重新进入训练队列", "job-1"]);
  assert.deepEqual(logCalls, [["job-1", "system", "job requeued"]]);
  assert.equal(result.status, "pending");
});

test("pauseTrainingJob preserves process-stop-dependent message and log semantics", async () => {
  const calls = [];
  const stopCalls = [];
  const logCalls = [];
  const service = createService(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT *")) return { rows: [{ id: "job-1", status: "running", process_pid: 4321 }] };
    return { rows: [{ id: "job-1", status: "paused" }] };
  }, {
    stopProcess: (pid) => { stopCalls.push(pid); return true; },
    appendTrainingLog: async (...args) => logCalls.push(args),
  });

  const result = await service.pauseTrainingJob("job-1");

  assert.deepEqual(stopCalls, [4321]);
  assert.deepEqual(calls[1].params, ["训练任务已暂停，运行进程已停止", "job-1"]);
  assert.deepEqual(logCalls, [["job-1", "system", "job paused; process stopped"]]);
  assert.equal(result.status, "paused");
});

test("resumeTrainingJob only resumes paused jobs and records the transition", async () => {
  const calls = [];
  const logCalls = [];
  const service = createService(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT *")) return { rows: [{ id: "job-1", status: "paused" }] };
    return { rows: [{ id: "job-1", status: "pending" }] };
  }, {
    appendTrainingLog: async (...args) => logCalls.push(args),
  });

  const result = await service.resumeTrainingJob("job-1");

  assert.match(calls[1].sql, /status='pending', process_pid=NULL, worker_id='', heartbeat_at=NULL/);
  assert.deepEqual(calls[1].params, ["训练任务已继续，等待 worker 接管", "job-1"]);
  assert.deepEqual(logCalls, [["job-1", "system", "job resumed"]]);
  assert.equal(result.status, "pending");
});

test("deleteTrainingJob stops the process before logging and deleting", async () => {
  const events = [];
  const service = createService(async (sql, params) => {
    events.push(["query", sql, params]);
    if (sql.startsWith("SELECT *")) return { rows: [{ id: "job-1", process_pid: 9876 }] };
    return { rows: [{ id: "job-1" }] };
  }, {
    stopProcess: (pid) => { events.push(["stop", pid]); return true; },
    appendTrainingLog: async (...args) => events.push(["log", ...args]),
  });

  const result = await service.deleteTrainingJob("job-1");

  assert.deepEqual(events.slice(1), [
    ["stop", 9876],
    ["log", "job-1", "system", "job deleted; process stopped"],
    ["query", "DELETE FROM runtime_training_jobs WHERE id=$1 RETURNING id", ["job-1"]],
  ]);
  assert.deepEqual(result, { deleted: true, id: "job-1" });
});

test("listInferenceJobs normalizes stored and output metrics", async () => {
  const service = createService(async () => ({
    rows: [
      {
        id: "inference-output-metrics",
        params_json: JSON.stringify({
          output: { metrics: { images: "5", predictions: "7" } },
          algorithmAssetId: "algorithm-1",
          templateName: "Detector",
          pythonEnvId: "env-1",
        }),
        metrics_json: "{}",
      },
      {
        id: "inference-stored-metrics",
        params_json: {
          output: { metrics: { images: 99, predictions: 99 } },
          templateId: "template-2",
          algorithmKey: "fallback-detector",
        },
        metrics_json: { images: 2, predictions: 0, map50: 0.81 },
      },
    ],
  }));

  const jobs = await service.listInferenceJobs({ id: "user-1" });

  assert.deepEqual(jobs[0].metrics_json, { images: "5", predictions: "7" });
  assert.equal(jobs[0].image_count, 5);
  assert.equal(jobs[0].prediction_count, 7);
  assert.equal(jobs[0].algorithm_asset_id, "algorithm-1");
  assert.equal(jobs[0].algorithm_name, "Detector");
  assert.equal(jobs[0].python_env_id, "env-1");
  assert.deepEqual(jobs[1].metrics_json, { images: 2, predictions: 0, map50: 0.81 });
  assert.equal(jobs[1].image_count, 2);
  assert.equal(jobs[1].prediction_count, 0);
  assert.equal(jobs[1].algorithm_asset_id, "template-2");
  assert.equal(jobs[1].algorithm_name, "fallback-detector");
  assert.equal(jobs[1].python_env_id, null);
});

test("getInferenceEvaluation evaluates only images with ground-truth annotations", async () => {
  const calls = [];
  let evaluationInput;
  const service = createService(async (sql, params) => {
    calls.push({ sql, params });
    if (sql === "SELECT * FROM runtime_inference_jobs WHERE id=$1") {
      return { rows: [{ id: "job-1", dataset_project_id: "project-1" }] };
    }
    if (sql.includes("FROM runtime_inference_results")) {
      return {
        rows: [
          { project_image_id: "image-labeled", display_name: "Labeled", predictions_json: [{ label: "car" }] },
          { project_image_id: "image-unlabeled", display_name: "Unlabeled", predictions_json: [{ label: "bus" }] },
          { project_image_id: null, display_name: "Detached", predictions_json: [{ label: "truck" }] },
        ],
      };
    }
    if (sql === "SELECT id, active_label_version_id FROM projects WHERE id=$1") {
      return { rows: [{ id: "project-1", active_label_version_id: "labels-1" }] };
    }
    if (sql.includes("FROM image_annotations")) {
      return {
        rows: [{
          project_image_id: "image-labeled",
          label: "car",
          bbox_x: 1,
          bbox_y: 2,
          bbox_w: 3,
          bbox_h: 4,
        }],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }, {
    evaluateDetections: (input) => {
      evaluationInput = input;
      return {
        summary: { precision: 1 },
        errors: [{ projectImageId: "image-labeled", type: "false_positive" }],
      };
    },
  });

  const evaluation = await service.getInferenceEvaluation("job-1");

  assert.deepEqual(calls[3].params, ["labels-1", ["image-labeled", "image-unlabeled"]]);
  assert.deepEqual(evaluationInput.predictionRows, [{
    projectImageId: "image-labeled",
    predictions: [{ label: "car" }],
  }]);
  assert.equal(evaluationInput.groundTruthRows.length, 1);
  assert.equal(evaluationInput.iouThreshold, 0.5);
  assert.deepEqual(evaluation.summary, {
    precision: 1,
    inferenceImages: 3,
    evaluatedImages: 1,
    skippedUnlabeledImages: 2,
  });
  assert.equal(evaluation.labelVersionId, "labels-1");
  assert.equal(evaluation.errors[0].display_name, "Labeled");
  assert.equal(evaluation.errors[0].thumb_url, "/api/project-images/image-labeled/thumb");
});

test("requeueInferenceJob preserves params and resets the persisted queue state", async () => {
  const calls = [];
  const originalParams = { confidence: 0.4 };
  const service = createService(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT *")) {
      return { rows: [{ id: "job-1", params_json: JSON.stringify(originalParams) }] };
    }
    return { rows: [{ id: "job-1", status: "pending", params_json: { stale: true } }] };
  });

  const result = await service.requeueInferenceJob("job-1");

  assert.match(calls[1].sql, /SET status='pending', progress=0, metrics_json='\{\}'::jsonb, message=\$1/);
  assert.match(calls[1].sql, /started_at=NULL, finished_at=NULL/);
  assert.match(calls[1].sql, /created_at=now\(\), priority=\(SELECT COALESCE\(MAX\(priority\), 0\) \+ 1 FROM runtime_inference_jobs\)/);
  assert.match(calls[1].sql, /WHERE id=\$2 RETURNING \*/);
  assert.equal(typeof calls[1].params[0], "string");
  assert.equal(calls[1].params[1], "job-1");
  assert.deepEqual(result.params_json, originalParams);
});

test("deleteInferenceJob uses a returning delete and reports the deleted id", async () => {
  const calls = [];
  const service = createService(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: "job-1" }] };
  });

  const result = await service.deleteInferenceJob("job-1");

  assert.deepEqual(calls, [{
    sql: "DELETE FROM runtime_inference_jobs WHERE id=$1 RETURNING id",
    params: ["job-1"],
  }]);
  assert.deepEqual(result, { deleted: true, id: "job-1" });
});
