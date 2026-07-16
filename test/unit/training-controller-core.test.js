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
  "training",
  "training-controller-core.js",
);

const coreModulePromise = import(
  `data:text/javascript;base64,${fs.readFileSync(coreModulePath).toString("base64")}`
);

test("createDefaultTrainingForm returns the current defaults and applies restored values", async () => {
  const { createDefaultTrainingForm } = await coreModulePromise;
  const form = createDefaultTrainingForm({ name: "恢复任务", epochs: 12 });

  assert.equal(form.name, "恢复任务");
  assert.equal(form.epochs, 12);
  assert.equal(form.python, "D:\\ProgramData\\miniforge3\\python.exe");
  assert.equal(form.initializationMode, "random");
  assert.equal(form.taskType, "detect");
  assert.deepEqual(form.trainProjectIds, []);
  assert.deepEqual(form.datasetFilters, {
    train: { scenes: [], views: [], modalities: [], labels: [], keywords: [] },
    val: { scenes: [], views: [], modalities: [], labels: [], keywords: [] },
    test: { scenes: [], views: [], modalities: [], labels: [], keywords: [] },
  });
});

test("createDefaultTrainingForm creates independent nested defaults", async () => {
  const { createDefaultTrainingForm } = await coreModulePromise;
  const first = createDefaultTrainingForm();
  const second = createDefaultTrainingForm();

  first.datasetFilters.train.scenes.push("outdoor");
  first.trainProjectIds.push("project-a");

  assert.deepEqual(second.datasetFilters.train.scenes, []);
  assert.deepEqual(second.trainProjectIds, []);
});

test("buildTrainingPayload preserves split fallbacks, conversions, and algorithm overrides", async () => {
  const { buildTrainingPayload, createDefaultTrainingForm } = await coreModulePromise;
  const datasetFilters = {
    train: { scenes: ["indoor"] },
    val: {},
    test: {},
  };
  const payload = buildTrainingPayload(createDefaultTrainingForm({
    name: "训练一",
    datasetProjectId: "legacy-project",
    trainProjectId: "train-primary",
    trainProjectIds: ["train-a", "train-b"],
    valProjectId: "val-primary",
    testProjectId: "test-primary",
    datasetFilters,
    modelId: "",
    templateId: "template-a",
    initializationMode: "pretrained",
    initialModelVersionId: "version-a",
    resume: 1,
    pythonEnvId: "",
    yoloVersion: "v11",
    epochs: "20",
    imgsz: "512",
    batch: "8",
    learningRate: "0.01",
    savePeriod: "5",
    earlyStop: 1,
    amp: 0,
    freezeBackbone: "yes",
    algorithmParams: { epochs: 999, customFlag: "kept" },
  }));

  const expectedSplits = {
    trainProjectId: "train-primary",
    trainProjectIds: ["train-a", "train-b"],
    valProjectId: "val-primary",
    valProjectIds: ["val-primary"],
    testProjectId: "test-primary",
    testProjectIds: ["test-primary"],
  };

  assert.equal(payload.datasetProjectId, "train-primary");
  assert.deepEqual(payload.datasetSplits, expectedSplits);
  assert.deepEqual(payload.params.datasetSplits, expectedSplits);
  assert.strictEqual(payload.datasetFilters, datasetFilters);
  assert.strictEqual(payload.params.datasetFilters, datasetFilters);
  assert.equal(payload.modelId, null);
  assert.equal(payload.templateId, "template-a");
  assert.equal(payload.initialModelVersionId, "version-a");
  assert.equal(payload.resume, true);
  assert.equal(payload.savePeriod, 5);
  assert.equal(payload.pythonEnvId, null);
  assert.equal(payload.params.customFlag, "kept");
  assert.equal(payload.params.epochs, 20);
  assert.equal(payload.params.imgsz, 512);
  assert.equal(payload.params.batch, 8);
  assert.equal(payload.params.learningRate, 0.01);
  assert.equal(payload.params.lr0, 0.01);
  assert.equal(payload.params.savePeriod, 5);
  assert.equal(payload.params.save_period, 5);
  assert.equal(payload.params.yolo_version, "yolo11");
  assert.equal(payload.params.earlyStop, true);
  assert.equal(payload.params.amp, false);
  assert.equal(payload.params.freezeBackbone, true);
});

test("buildTrainingPayload keeps legacy empty and initialization behavior", async () => {
  const { buildTrainingPayload, createDefaultTrainingForm } = await coreModulePromise;
  const payload = buildTrainingPayload(createDefaultTrainingForm({
    datasetProjectId: "legacy-project",
    initializationMode: "random",
    initialModelVersionId: "ignored-version",
    yoloVersion: "v9",
  }));

  assert.equal(payload.datasetProjectId, "legacy-project");
  assert.deepEqual(payload.datasetSplits, {
    trainProjectId: "legacy-project",
    trainProjectIds: [],
    valProjectId: null,
    valProjectIds: [],
    testProjectId: null,
    testProjectIds: [],
  });
  assert.equal(payload.initialModelVersionId, null);
  assert.equal(payload.params.yolo_version, "yolov9");
});

test("buildTrainingRequeuePayload omits an empty model version when serialized", async () => {
  const { buildTrainingRequeuePayload } = await coreModulePromise;

  assert.deepEqual(buildTrainingRequeuePayload({
    python: "C:\\Python\\python.exe",
    initialModelVersionId: "version-a",
  }), {
    params: {
      python: "C:\\Python\\python.exe",
      initialModelVersionId: "version-a",
    },
  });

  assert.equal(
    JSON.stringify(buildTrainingRequeuePayload({ python: "python", initialModelVersionId: "" })),
    JSON.stringify({ params: { python: "python" } }),
  );
});
