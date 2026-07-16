const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const coreModulePath = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "features",
  "inference",
  "inference-controller-core.js",
);

const coreModulePromise = import(
  `data:text/javascript;base64,${fs.readFileSync(coreModulePath).toString("base64")}`
);

test("createDefaultInferenceForm returns current defaults and applies restored values", async () => {
  const { createDefaultInferenceForm } = await coreModulePromise;
  const form = createDefaultInferenceForm({ name: "恢复任务", conf: 0.5 });

  assert.equal(form.name, "恢复任务");
  assert.equal(form.conf, 0.5);
  assert.equal(form.taskType, "detect");
  assert.equal(form.inputScope, "project");
  assert.equal(form.cachePolicy, "reuse_asset_cache");
  assert.equal(form.saveJson, true);
  assert.equal(form.saveVisualization, true);
  assert.equal(form.createLabelVersion, false);
  assert.equal(form.fakeReferenceMode, false);
});

test("resolveInferenceAlgorithm follows normal and fake-reference selection", async () => {
  const { resolveInferenceAlgorithm } = await coreModulePromise;
  const assets = [
    { id: "real", algorithm_key: "ultralytics_detect" },
    { id: "dummy", template_key: "dummy_empty_detector" },
    { id: "fake", template_key: "fake_reference_detector" },
  ];

  const real = resolveInferenceAlgorithm({ templateId: "real", fakeReferenceMode: false }, assets);
  assert.strictEqual(real.selectedAlgorithm, assets[0]);
  assert.equal(real.algorithmKey, "ultralytics_detect");
  assert.equal(real.isBuiltInNoEnvAlgorithm, false);

  const dummy = resolveInferenceAlgorithm({ templateId: "dummy", fakeReferenceMode: false }, assets);
  assert.strictEqual(dummy.selectedAlgorithm, assets[1]);
  assert.equal(dummy.isBuiltInNoEnvAlgorithm, true);

  const fake = resolveInferenceAlgorithm({ templateId: "real", fakeReferenceMode: true }, assets);
  assert.strictEqual(fake.selectedAlgorithm, assets[2]);
  assert.equal(fake.algorithmKey, "fake_reference_detector");
  assert.equal(fake.isBuiltInNoEnvAlgorithm, true);
});

test("validateInferenceSubmission preserves validation order and built-in exemptions", async () => {
  const { validateInferenceSubmission } = await coreModulePromise;
  const missingAlgorithm = { selectedAlgorithm: undefined, isBuiltInNoEnvAlgorithm: false };
  const realAlgorithm = { selectedAlgorithm: { id: "real" }, isBuiltInNoEnvAlgorithm: false };
  const builtInAlgorithm = { selectedAlgorithm: { id: "dummy" }, isBuiltInNoEnvAlgorithm: true };

  assert.equal(
    validateInferenceSubmission({}, missingAlgorithm),
    "请选择数据集项目",
  );
  assert.equal(
    validateInferenceSubmission({ datasetProjectId: "project" }, missingAlgorithm),
    "请选择算法名称",
  );
  assert.equal(
    validateInferenceSubmission({ datasetProjectId: "project" }, realAlgorithm),
    "真实算法推理需要先选择运行环境资产",
  );
  assert.equal(
    validateInferenceSubmission({ datasetProjectId: "project", pythonEnvId: "env" }, realAlgorithm),
    "真实算法推理需要先选择模型权重版本",
  );
  assert.equal(
    validateInferenceSubmission({ datasetProjectId: "project" }, builtInAlgorithm),
    null,
  );
});

test("buildInferencePayload preserves conversions, filters, and fixed request values", async () => {
  const { buildInferencePayload, createDefaultInferenceForm } = await coreModulePromise;
  const form = createDefaultInferenceForm({
    name: "推理一",
    datasetProjectId: "project-a",
    modelVersionId: "version-a",
    templateId: "template-fallback",
    pythonEnvId: "env-a",
    conf: "0.4",
    iou: "0.6",
    imgsz: "512",
    batch: "8",
    inputScope: "filtered",
    inputScenes: " indoor, outdoor, ",
    inputViews: "front,, rear",
    inputModalities: "rgb",
    inputImportBatchIds: "batch-a, batch-b",
    inputLabels: "car, person",
    inputQuery: "night",
    inputLimit: 99,
    cachePolicy: "ignore-cache",
    saveJson: 0,
    saveVisualization: 1,
    createLabelVersion: "yes",
  });
  const payload = buildInferencePayload(form, { id: "algorithm-a" });

  assert.equal(payload.name, "推理一");
  assert.equal(payload.modelVersionId, "version-a");
  assert.equal(payload.params.modelId, null);
  assert.equal(payload.params.algorithmAssetId, "algorithm-a");
  assert.equal(payload.params.templateId, "algorithm-a");
  assert.equal(payload.params.conf, 0.4);
  assert.equal(payload.params.iou, 0.6);
  assert.equal(payload.params.imgsz, 512);
  assert.equal(payload.params.batch, 8);
  assert.deepEqual(payload.params.input.filters, {
    scenes: ["indoor", "outdoor"],
    views: ["front", "rear"],
    modalities: ["rgb"],
    importBatchIds: ["batch-a", "batch-b"],
    labels: ["car", "person"],
    q: "night",
  });
  assert.equal(payload.params.input.limit, 0);
  assert.equal(payload.params.input.cachePolicy, "reuse_asset_cache");
  assert.deepEqual(payload.params.output, {
    saveJson: false,
    saveVisualization: true,
    createLabelVersion: true,
  });
});

test("buildInferencePayload keeps project filters empty and fake model version null", async () => {
  const { buildInferencePayload, createDefaultInferenceForm } = await coreModulePromise;
  const form = createDefaultInferenceForm({
    datasetProjectId: "project-a",
    modelVersionId: "ignored-version",
    templateId: "fake-template",
    fakeReferenceMode: true,
    inputScenes: "ignored",
  });
  const payload = buildInferencePayload(form, {});

  assert.equal(payload.modelVersionId, null);
  assert.equal(payload.params.algorithmAssetId, "fake-template");
  assert.equal(payload.params.templateId, "fake-template");
  assert.equal(payload.params.fakeReferenceMode, true);
  assert.equal(payload.params.pythonEnvId, null);
  assert.deepEqual(payload.params.input.filters, {});
});

test("normalizeInferenceJobIds removes empty and duplicate ids without reordering", async () => {
  const { normalizeInferenceJobIds } = await coreModulePromise;

  assert.deepEqual(normalizeInferenceJobIds(), []);
  assert.deepEqual(
    normalizeInferenceJobIds(["job-b", "", null, "job-a", "job-b", undefined]),
    ["job-b", "job-a"],
  );
});
