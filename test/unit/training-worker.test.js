const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createTrainingWorker } = require("../../server/runtime-jobs/training-worker");
const { walk, hashFile } = require("../../server/utils");

function createClock() {
  const intervals = [];
  const timeouts = [];
  const clearedIntervals = [];
  const clearedTimeouts = [];
  return {
    intervals,
    timeouts,
    clearedIntervals,
    clearedTimeouts,
    now: () => Date.parse("2026-07-16T00:00:00.000Z"),
    setInterval(fn, ms) {
      const timer = { fn, ms };
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) { clearedIntervals.push(timer); },
    setTimeout(fn, ms) {
      const timer = { fn, ms };
      timeouts.push(timer);
      return timer;
    },
    clearTimeout(timer) { clearedTimeouts.push(timer); },
  };
}

function createFixture(overrides = {}) {
  const root = overrides.root || fs.mkdtempSync(path.join(os.tmpdir(), "training-worker-"));
  const calls = { queries: [], logs: [], puts: [], links: [], warnings: [], errors: [], claims: 0 };
  const clock = overrides.clock || createClock();
  const deps = {
    query: overrides.query || (async (sql, params) => {
      calls.queries.push({ sql, params });
      return { rows: [] };
    }),
    fs,
    path,
    storageRoot: root,
    store: { async putFile(...args) { calls.puts.push(args); } },
    resourceAccess: { async assignOwner() {} },
    modelService: {
      async createMlModel() { return { id: "model-1" }; },
      async nextModelVersionName() { return "version-1"; },
      async findWeightArtifact() { return null; },
    },
    pythonEnvService: { async resolveRuntimePythonEnv(value) { return value; } },
    runtimeAssetLinkService: { async recordSuccess(...args) { calls.links.push(args); } },
    runtimeQueueService: {
      async claimTrainingJob() {
        calls.claims += 1;
        return null;
      },
    },
    algorithmRuntimeSource: {
      async resolveTrainingAlgorithmSource() { return null; },
      ensureAlgorithmSourceArchiveExtracted(value) { return value; },
      findFileUnder() { return ""; },
    },
    walk,
    hashFile,
    async writeObjectToFile() {},
    async appendTrainingLog(...args) { calls.logs.push(args); },
    spawn: overrides.spawn || (() => { throw new Error("unexpected spawn"); }),
    processRef: { pid: 321, env: { ...(overrides.env || {}) } },
    logger: {
      warn(...args) { calls.warnings.push(args); },
      error(...args) { calls.errors.push(args); },
    },
    clock,
    dateCode: () => "20260716",
    ...overrides.deps,
  };
  return { root, calls, clock, deps, worker: createTrainingWorker(deps) };
}

test("buildTrainingCommand dispatches custom, DINO, YOLO, and zero initialization commands", async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const snapshot = { path: path.join(fixture.root, "snapshot") };

  assert.deepEqual(
    await fixture.worker.buildTrainingCommand({ params_json: { command: ["runner", "--flag"] } }, snapshot),
    { command: "runner", args: ["--flag"] },
  );

  const sourceRoot = path.join(fixture.root, "source");
  const trainScript = path.join(sourceRoot, "tools", "train.py");
  const configPath = path.join(sourceRoot, "configs", "alashan_full_multiclass_200e.py");
  fs.mkdirSync(path.dirname(trainScript), { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(trainScript, "train");
  fs.writeFileSync(configPath, "config");
  fixture.deps.algorithmRuntimeSource.resolveTrainingAlgorithmSource = async () => ({
    algorithm: { default_params_json: {} },
    cacheRoot: sourceRoot,
  });
  const dino = await fixture.worker.buildTrainingCommand({
    output_root: fixture.root,
    total_epochs: 12,
    params_json: { algorithmKey: "dinov3_faster_rcnn", python: "dino-python", amp: true },
  }, snapshot);
  assert.equal(dino.command, "dino-python");
  assert.equal(dino.cwd, sourceRoot);
  assert.deepEqual(dino.args.slice(0, 4), [trainScript, configPath, "--work-dir", path.join(fixture.root, "run")]);
  assert.ok(dino.args.includes("train_cfg.max_epochs=12"));
  assert.ok(dino.args.includes("optim_wrapper.type=AmpOptimWrapper"));

  const yolo = await fixture.worker.buildTrainingCommand({
    output_root: fixture.root,
    total_epochs: 3,
    params_json: { taskType: "segment", model: "model.pt", batch: 4 },
  }, snapshot);
  assert.equal(yolo.command, "python");
  assert.deepEqual(yolo.args.slice(2, 4), ["segment", "train"]);
  assert.ok(yolo.args.includes("model=model.pt"));

  const zero = await fixture.worker.buildTrainingCommand({
    output_root: fixture.root,
    params_json: { initializationStrategy: "zero", model: "zero.yaml", epochs: 2 },
  }, snapshot);
  assert.equal(zero.args[0], "-c");
  assert.equal(JSON.parse(zero.args[2]).model, "zero.yaml");
});

test("syncTrainingWeightArtifacts preserves best, last, epoch, and other artifact roles", async (t) => {
  let fixture;
  const inserted = [];
  fixture = createFixture({
    query: async (sql, params) => {
      fixture.calls.queries.push({ sql, params });
      if (sql.includes("FROM model_revisions mv")) return { rows: [{ id: "version-1" }] };
      if (sql.includes("SELECT * FROM model_files")) return { rows: [] };
      if (sql.includes("INSERT INTO model_files")) {
        const metadata = JSON.parse(params[5]);
        const row = { id: `file-${inserted.length + 1}`, metadata_json: metadata };
        inserted.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    },
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const weights = path.join(fixture.root, "weights");
  fs.mkdirSync(weights);
  for (const name of ["best.pt", "last.pth", "epoch_12.onnx", "checkpoint.pt"]) fs.writeFileSync(path.join(weights, name), name);
  fs.writeFileSync(path.join(fixture.root, "ignored.pt"), "ignored");

  const result = await fixture.worker.syncTrainingWeightArtifacts({ id: "job-1", output_root: fixture.root }, "version-1");

  assert.deepEqual(result.map((row) => row.metadata_json.weightRole).sort(), ["best", "epoch", "last", "other"]);
  assert.equal(result.find((row) => row.metadata_json.weightRole === "epoch").metadata_json.epoch, 12);
  assert.equal(fixture.calls.puts.length, 4);
  assert.ok(fixture.calls.puts.every(([key]) => key.startsWith("ml/artifacts/training/job-1/weights/")));
});

function createChild(exitCode) {
  const child = new EventEmitter();
  child.pid = 99;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => child.emit("close", exitCode));
  return child;
}

function createRunFixture(exitCode, finalStatus = "running") {
  let fixture;
  let jobReads = 0;
  const baseJob = {
    id: "job-1",
    name: "training",
    output_root: null,
    dataset_snapshot_id: "snapshot-1",
    generated_model_version_id: "version-1",
    dataset_project_id: "project-1",
    params_json: { command: ["runner", "--train"] },
  };
  fixture = createFixture({
    spawn: () => createChild(exitCode),
    query: async (sql, params) => {
      fixture.calls.queries.push({ sql, params });
      if (sql.includes("FROM dataset_snapshots")) return { rows: [{ id: "snapshot-1", path: fixture.root }] };
      if (sql === "SELECT * FROM model_revisions WHERE id=$1") return { rows: [{ id: "version-1", model_id: "model-1", version_name: "v1" }] };
      if (sql === "SELECT * FROM runtime_training_jobs WHERE id=$1") {
        jobReads += 1;
        return { rows: [{ ...baseJob, output_root: fixture.root, status: jobReads >= 3 ? finalStatus : "running" }] };
      }
      if (sql.includes("FROM model_revisions mv")) return { rows: [{ id: "version-1" }] };
      if (sql.includes("runtime_training_metrics")) return { rows: [] };
      return { rows: [] };
    },
  });
  baseJob.output_root = fixture.root;
  return { ...fixture, job: baseJob };
}

test("runTrainingJob preserves success, failure, and paused terminal semantics", async (t) => {
  const success = createRunFixture(0);
  const failure = createRunFixture(7);
  const paused = createRunFixture(7, "paused");
  t.after(() => {
    for (const fixture of [success, failure, paused]) fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  await success.worker.runTrainingJob(success.job, "worker-1");
  assert.ok(success.calls.queries.some(({ sql }) => sql.includes("status='done'")));
  assert.equal(success.calls.links.length, 1);

  await failure.worker.runTrainingJob(failure.job, "worker-1");
  const failedUpdate = failure.calls.queries.find(({ sql }) => sql.includes("status='failed'"));
  assert.equal(failedUpdate.params[0], "训练命令退出码 7");
  assert.ok(failure.calls.logs.some(([, stream, line]) => stream === "error" && line.includes("训练命令退出码 7")));

  await paused.worker.runTrainingJob(paused.job, "worker-1");
  assert.equal(paused.calls.queries.some(({ sql }) => sql.includes("status='done'")), false);
  assert.equal(paused.calls.queries.some(({ sql }) => sql.includes("status='failed'")), false);
});

test("startTrainingWorker prevents reentry and stop awaits the active tick", async () => {
  let resolveClaim;
  const claim = new Promise((resolve) => { resolveClaim = resolve; });
  const fixture = createFixture({
    deps: {
      runtimeQueueService: {
        async claimTrainingJob() {
          fixture.calls.claims += 1;
          return claim;
        },
      },
    },
  });
  const handle = fixture.worker.startTrainingWorker();
  assert.equal(fixture.clock.intervals[0].ms, 3000);
  assert.equal(fixture.clock.timeouts[0].ms, 250);

  const first = fixture.clock.intervals[0].fn();
  const second = fixture.clock.timeouts[0].fn();
  assert.equal(fixture.calls.claims, 1);
  resolveClaim(null);
  await Promise.all([first, second]);
  await handle.stop();

  assert.deepEqual(fixture.clock.clearedIntervals, [fixture.clock.intervals[0]]);
  assert.deepEqual(fixture.clock.clearedTimeouts, [fixture.clock.timeouts[0]]);
  assert.equal(fixture.calls.claims, 1);
});

test("startTrainingWorker remains disabled without scheduling timers", () => {
  const fixture = createFixture({ env: { TRAINING_WORKER_ENABLED: "false" } });
  assert.equal(fixture.worker.startTrainingWorker(), undefined);
  assert.equal(fixture.clock.intervals.length, 0);
  assert.equal(fixture.clock.timeouts.length, 0);
});
