const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAlgorithmRuntimeSource } = require("../../server/ml-assets/algorithm-runtime-source");
const { walk, cleanName } = require("../../server/utils");

function createFixture(overrides = {}) {
  const root = overrides.root || fs.mkdtempSync(path.join(os.tmpdir(), "algorithm-runtime-source-"));
  const calls = { queries: [], prefixes: [], writes: [], spawns: [], children: [], warnings: [] };
  const algorithm = overrides.algorithm || {
    id: "algorithm-1",
    algorithm_key: "dinov3_faster_rcnn",
    version: "v1.0. ",
    source_prefix: "custom\\source",
    minio_prefix: "code-assets/algorithms/dinov3_faster_rcnn/v1",
    default_params_json: {},
  };
  const query = overrides.query || (async (sql, params) => {
    calls.queries.push({ sql, params });
    return { rows: [algorithm] };
  });
  const store = {
    async listObjectKeys(prefix) {
      calls.prefixes.push(prefix);
      return overrides.keysByPrefix?.[prefix] || [];
    },
    async objectSize(key) {
      if (overrides.objectSizeError) throw overrides.objectSizeError;
      return overrides.objectSizes?.[key] ?? 7;
    },
  };
  const spawnSync = overrides.spawnSync || ((command, args, options) => {
    calls.spawns.push({ command, args, options });
    return { status: 0, stdout: "dinov3-faster-rcnn/configs/\n", stderr: "" };
  });
  const runChildProcess = overrides.runChildProcess || (async (...args) => { calls.children.push(args); });
  const service = createAlgorithmRuntimeSource({
    query,
    store,
    storageRoot: root,
    fs,
    path,
    spawnSync,
    walk,
    cleanName,
    async writeObjectToFile(key, target) {
      calls.writes.push({ key, target });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "1234567");
    },
    runChildProcess,
    processRef: { env: { PYTHONPATH: "existing-python-path", KEEP: "yes" } },
    logger: { warn(message) { calls.warnings.push(message); } },
  });
  return { root, calls, algorithm, service };
}

test("resolveTrainingAlgorithmSource preserves SQL, source priority, and cache layout", async (t) => {
  const prefix = "custom/source/";
  const objectKey = `${prefix}configs/model.py`;
  const fixture = createFixture({ keysByPrefix: { [prefix]: [objectKey, `${prefix}../skip.py`] } });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const result = await fixture.service.resolveTrainingAlgorithmSource({ algorithmAssetId: "algorithm-1", algorithmKey: "ignored" });

  assert.deepEqual(fixture.calls.queries, [{
    sql: "SELECT * FROM algorithm_assets WHERE id=$1 AND deleted_at IS NULL",
    params: ["algorithm-1"],
  }]);
  assert.deepEqual(fixture.calls.prefixes, [
    "custom/source/",
    "code-assets/algorithms/dinov3_faster_rcnn/v1/source/",
    "code-assets/algorithms/dinov3_faster_rcnn/source/",
  ]);
  assert.equal(result.cacheRoot, path.join(fixture.root, "runtime", "algorithm-cache", "algorithm-1", "v10"));
  assert.deepEqual(fixture.calls.writes, [{ key: objectKey, target: path.join(result.cacheRoot, "configs", "model.py") }]);
});

test("resolveTrainingAlgorithmSource falls back to algorithm key SQL and returns null when absent", async (t) => {
  const calls = [];
  const fixture = createFixture({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  assert.equal(await fixture.service.resolveTrainingAlgorithmSource({ algorithmKey: "dinov3_faster_rcnn" }), null);
  assert.deepEqual(calls, [{
    sql: "SELECT * FROM algorithm_assets WHERE algorithm_key=$1 AND deleted_at IS NULL ORDER BY source_type='builtin' DESC, updated_at DESC LIMIT 1",
    params: ["dinov3_faster_rcnn"],
  }]);
});

test("cache segments and recursive file lookup preserve existing behavior", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const nested = path.join(fixture.root, "nested", "target.py");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, "target");

  assert.equal(fixture.service.assetPathSegmentForCache("release 1.0. "), "release10");
  assert.equal(fixture.service.assetPathSegmentForCache("..."), "asset");
  assert.equal(fixture.service.findFileUnder(fixture.root, (file) => path.basename(file) === "target.py"), nested);
  assert.equal(fixture.service.findFileUnder(path.join(fixture.root, "missing"), () => true), "");
});

test("ensureAlgorithmSourceArchiveExtracted inspects and extracts only the existing DINO paths", (t) => {
  let fixture;
  fixture = createFixture({
    spawnSync(command, args, options) {
      fixture.calls.spawns.push({ command, args, options });
      if (args[0] === "-xf") fs.mkdirSync(path.join(args[3], "dinov3-faster-rcnn"), { recursive: true });
      return { status: 0, stdout: "dinov3-faster-rcnn/configs/\n", stderr: "" };
    },
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const archive = path.join(fixture.root, "ZBH2FWQ", "archives", "dinov3-faster-rcnn-code.tar.zst");
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, "archive");

  const sourceRoot = fixture.service.ensureAlgorithmSourceArchiveExtracted(fixture.root);

  const extractRoot = path.join(path.dirname(archive), "dinov3-faster-rcnn-code");
  assert.equal(sourceRoot, path.join(extractRoot, "dinov3-faster-rcnn"));
  assert.deepEqual(fixture.calls.spawns.map((call) => call.args), [
    ["-tf", archive],
    ["-xf", archive, "-C", extractRoot, "dinov3-faster-rcnn/configs", "dinov3-faster-rcnn/dino_detector", "dinov3-faster-rcnn/tools"],
  ]);
  assert.ok(fs.existsSync(path.join(extractRoot, ".det-dashboard-extracted")));
  fixture.service.ensureAlgorithmSourceArchiveExtracted(fixture.root);
  assert.equal(fixture.calls.spawns.length, 2);
});

test("ensureAlgorithmSourceArchiveExtracted rejects unsafe archive paths with the same message", (t) => {
  const fixture = createFixture({ spawnSync: () => ({ status: 0, stdout: "../escape.py\n", stderr: "" }) });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const archive = path.join(fixture.root, "ZBH2FWQ", "archives", "dinov3-faster-rcnn-code.tar.zst");
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, "archive");

  assert.throws(
    () => fixture.service.ensureAlgorithmSourceArchiveExtracted(fixture.root),
    { message: "DINO source archive contains an unsafe path: ../escape.py" },
  );
});

test("resolveDinoConfigPath prefers checkpoint config and preserves sanitization and child environment", async (t) => {
  let fixture;
  fixture = createFixture({
    runChildProcess: async (...args) => {
      fixture.calls.children.push(args);
      fs.writeFileSync(args[1][2], "pretrained=checkpoint_file\npretrained='remote.pth'\n");
    },
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const outputRoot = path.join(fixture.root, "output");
  fs.mkdirSync(outputRoot, { recursive: true });

  const result = await fixture.service.resolveDinoConfigPath({
    env: { python_path: "python-env" }, cacheRoot: fixture.root, algorithm: fixture.algorithm,
    params: {}, weightPath: "weights.pth", outputRoot,
  });

  assert.equal(result.configPath, path.join(outputRoot, "checkpoint_config.py"));
  assert.equal(fs.readFileSync(result.configPath, "utf8"), "pretrained=None\npretrained=None\n");
  assert.deepEqual(fixture.calls.children[0][0], "python-env");
  assert.deepEqual(fixture.calls.children[0][1], [path.join(outputRoot, "extract_checkpoint_config.py"), "weights.pth", result.configPath]);
  assert.deepEqual(fixture.calls.children[0][2].env, {
    PYTHONPATH: `${fixture.root}${path.delimiter}existing-python-path`, KEEP: "yes", PYTHONIOENCODING: "utf-8",
  });
});

test("resolveDinoConfigPath preserves requested suffix search and unavailable warning text", async (t) => {
  const extractionError = new Error("checkpoint failed");
  const fixture = createFixture({ runChildProcess: async () => { throw extractionError; } });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const outputRoot = path.join(fixture.root, "output");
  const nestedConfig = path.join(fixture.root, "package", "configs", "custom.py");
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(path.dirname(nestedConfig), { recursive: true });
  fs.writeFileSync(nestedConfig, "config");

  const result = await fixture.service.resolveDinoConfigPath({
    env: { python_path: "python-env" }, cacheRoot: fixture.root, algorithm: fixture.algorithm,
    params: { config_path: "configs/custom.py" }, weightPath: "weights.pth", outputRoot,
  });
  assert.equal(result.configPath, nestedConfig);
  assert.deepEqual(fixture.calls.warnings, ["Checkpoint config extraction failed for weights.pth: checkpoint failed"]);

  await assert.rejects(
    fixture.service.resolveDinoConfigPath({
      env: { python_path: "python-env" }, cacheRoot: path.join(fixture.root, "missing"), algorithm: fixture.algorithm,
      params: { config_path: "configs/missing.py" }, weightPath: "missing.pth", outputRoot,
    }),
    { message: "DINO config is unavailable in source and checkpoint meta.cfg: missing.pth" },
  );
});
