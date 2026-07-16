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
  assert.equal(jobs[1].prediction_count, null);
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
