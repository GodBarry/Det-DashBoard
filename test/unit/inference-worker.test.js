const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createInferenceWorker } = require("../../server/runtime-jobs/inference-worker");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function createFixture(overrides = {}) {
  const calls = {
    queries: [],
    claims: [],
    intervals: [],
    timeouts: [],
    clearedIntervals: [],
    clearedTimeouts: [],
    errors: [],
  };
  const query = overrides.query || (async (sql, params) => {
    calls.queries.push({ sql, params });
    return { rows: [] };
  });
  const clock = overrides.clock || {
    now: () => Date.parse("2026-07-16T01:02:03.000Z"),
    setInterval(callback, delay) {
      const handle = { type: "interval", callback, delay };
      calls.intervals.push(handle);
      return handle;
    },
    setTimeout(callback, delay) {
      const handle = { type: "timeout", callback, delay };
      calls.timeouts.push(handle);
      return handle;
    },
    clearInterval(handle) { calls.clearedIntervals.push(handle); },
    clearTimeout(handle) { calls.clearedTimeouts.push(handle); },
  };
  const runtimeQueueService = overrides.runtimeQueueService || {
    async claimInferenceJob(workerId) {
      calls.claims.push(workerId);
      return null;
    },
  };
  const service = createInferenceWorker({
    query,
    transaction: overrides.transaction || (async (callback) => callback({ query })),
    fs: overrides.fs || {
      existsSync: () => false,
      readFileSync: () => "{}",
      writeFileSync: () => {},
      mkdirSync: () => {},
    },
    path,
    storageRoot: "/storage",
    processRef: overrides.processRef || { env: {}, pid: 4242 },
    runtimeQueueService,
    pythonEnvService: overrides.pythonEnvService || { resolveRuntimePythonEnv: async (env) => env },
    modelService: overrides.modelService || { findWeightArtifact: async () => null },
    runtimeAssetLinkService: overrides.runtimeAssetLinkService || { recordSuccess: async () => {} },
    runChildProcess: overrides.runChildProcess || (async () => ({ stdout: "", stderr: "", combined: "" })),
    algorithmRuntimeSource: overrides.algorithmRuntimeSource || {
      resolveTrainingAlgorithmSource: async () => null,
      resolveDinoConfigPath: async () => null,
    },
    uniqueExistingPaths: overrides.uniqueExistingPaths || ((items) => items.filter(Boolean)),
    logger: overrides.logger || { error: (...args) => calls.errors.push(args) },
    clock,
  });
  return { calls, service };
}

test("runInferenceJob dispatches registered algorithms and builtin inference jobs", async () => {
  const cases = [
    { params: { algorithmKey: "ultralytics_yolo", pythonEnvId: "env-yolo" }, expected: "SELECT * FROM runtime_envs WHERE id=$1" },
    { params: { algorithmKey: "dinov3_faster_rcnn", pythonEnvId: "env-dino" }, expected: "SELECT * FROM runtime_envs WHERE id=$1" },
    { params: { algorithmKey: "fake_reference_detector" }, expected: "Running Fake GT reference inference" },
    { params: { algorithmKey: "dummy_empty_detector" }, expected: "正在执行空模型推理" },
  ];

  for (const [index, item] of cases.entries()) {
    const fixture = createFixture();
    await fixture.service.runInferenceJob({
      id: `job-${index}`,
      output_root: `/jobs/${index}`,
      params_json: item.params,
    }, "worker-test");

    assert.ok(fixture.calls.queries.some(({ sql, params }) => sql.includes(item.expected) || params?.includes(item.expected)), item.expected);
    assert.match(fixture.calls.queries.at(-1).sql, /status='failed'/);
  }
});

test("normalizeTorchDevice preserves CUDA, CPU, MPS, and passthrough normalization", () => {
  const { service } = createFixture();

  assert.equal(service.normalizeTorchDevice(undefined, false), "cpu");
  assert.equal(service.normalizeTorchDevice("", true), "cuda:0");
  assert.equal(service.normalizeTorchDevice(" 2 ", false), "cuda:2");
  assert.equal(service.normalizeTorchDevice(-1, false), "cpu");
  assert.equal(service.normalizeTorchDevice("-1", true), "cuda:0");
  assert.equal(service.normalizeTorchDevice(" CUDA:3 ", false), "cuda:3");
  assert.equal(service.normalizeTorchDevice("MPS", false), "mps");
  assert.equal(service.normalizeTorchDevice("xpu", true), "xpu");
});

test("runInferenceJob records command failure output and the injected failure time", async () => {
  const failure = new Error("python failed");
  failure.stdout = "before failure\n";
  failure.stderr = "traceback\n";
  failure.combined = "before failure\ntraceback\n";
  const fixture = createFixture({
    query: async (sql, params) => {
      fixture.calls.queries.push({ sql, params });
      if (sql === "SELECT * FROM runtime_envs WHERE id=$1") throw failure;
      return { rows: [] };
    },
  });

  await fixture.service.runInferenceJob({
    id: "job-failure",
    params_json: { algorithmKey: "ultralytics_yolo", pythonEnvId: "env-1", output: { retained: true } },
  }, "worker-9");

  const failed = fixture.calls.queries.at(-1);
  assert.equal(failed.sql, "UPDATE runtime_inference_jobs SET status='failed', message=$1, params_json=$2, finished_at=now() WHERE id=$3");
  assert.equal(failed.params[0], "python failed");
  assert.equal(failed.params[2], "job-failure");
  assert.deepEqual(JSON.parse(failed.params[1]).output, {
    retained: true,
    stdout: "before failure\n",
    stderr: "traceback\n",
    executionLog: "before failure\ntraceback\n",
    failedAt: "2026-07-16T01:02:03.000Z",
  });
});

test("startInferenceWorker prevents reentry and stop clears timers after the active tick", async () => {
  const claim = deferred();
  let claimCount = 0;
  const fixture = createFixture({
    processRef: { env: { INFERENCE_WORKER_INTERVAL_MS: "17" }, pid: 99 },
    runtimeQueueService: {
      claimInferenceJob(workerId) {
        fixture.calls.claims.push(workerId);
        claimCount += 1;
        return claim.promise;
      },
    },
  });
  const worker = fixture.service.startInferenceWorker();

  assert.equal(fixture.calls.intervals[0].delay, 17);
  assert.equal(fixture.calls.timeouts[0].delay, 250);
  const firstTick = fixture.calls.intervals[0].callback();
  const overlappingTick = fixture.calls.timeouts[0].callback();
  await Promise.resolve();
  assert.equal(claimCount, 1);
  assert.deepEqual(fixture.calls.claims, ["local-infer-99"]);

  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  assert.deepEqual(fixture.calls.clearedIntervals, [fixture.calls.intervals[0]]);
  assert.deepEqual(fixture.calls.clearedTimeouts, [fixture.calls.timeouts[0]]);

  claim.resolve(null);
  await Promise.all([firstTick, overlappingTick, stopping]);
  assert.equal(stopped, true);
  await fixture.calls.intervals[0].callback();
  assert.equal(claimCount, 1);
});

test("startInferenceWorker stays disabled without scheduling timers", () => {
  const fixture = createFixture({ processRef: { env: { INFERENCE_WORKER_ENABLED: "FALSE" }, pid: 1 } });

  assert.equal(fixture.service.startInferenceWorker(), undefined);
  assert.equal(fixture.calls.intervals.length, 0);
  assert.equal(fixture.calls.timeouts.length, 0);
});
