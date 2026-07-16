const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { createAlgorithmAssetService } = require("../../server/ml-assets/algorithm-asset-service");

function createFixture(overrides = {}) {
  const calls = {
    queries: [],
    objectExists: [],
    putJson: [],
    putText: [],
    listObjectKeys: [],
    getStream: [],
    scopes: [],
    errors: [],
  };
  const query = overrides.query || (async (sql, params) => {
    calls.queries.push({ sql, params });
    return { rows: [] };
  });
  const store = {
    async objectExists(key) { calls.objectExists.push(key); return overrides.objectsExist ?? true; },
    async putJson(key, value) { calls.putJson.push({ key, value }); },
    async putText(key, value, contentType) { calls.putText.push({ key, value, contentType }); },
    async listObjectKeys(prefix) { calls.listObjectKeys.push(prefix); return overrides.objectKeys || []; },
    async getStream(key) {
      calls.getStream.push(key);
      const value = overrides.objectBodies?.[key] ?? "{}";
      return Readable.from(Array.isArray(value) ? value : [value]);
    },
  };
  const resourceAccess = {
    async getAdminId() { return overrides.adminId || "admin-1"; },
    scopeSql(input) {
      calls.scopes.push(input);
      return overrides.scoped || { sql: "a.owner_user_id=$1", params: [input.actor.id] };
    },
  };
  const service = createAlgorithmAssetService({
    query,
    resourceAccess,
    store,
    cleanName: (value, fallback) => String(value || fallback).replace(/[^a-zA-Z0-9_-]+/g, "_") ,
    algorithmAssetPrefix: (key, version = "builtin") => `code-assets/algorithms/${key}/${version || "builtin"}`,
    algorithmManifestKey: (key, version = "builtin") => `code-assets/algorithms/${key}/${version || "builtin"}/manifest.json`,
    algorithmAdapterKey: (key, version = "builtin") => `code-assets/algorithms/${key}/${version || "builtin"}/adapter.py`,
    logger: { error(...args) { calls.errors.push(args); } },
  });
  return { calls, service };
}

test("builtin fallbacks expose only the supported training and inference assets", () => {
  const { service } = createFixture();

  const templates = service.getBuiltinTrainingTemplateFallbacks();

  assert.deepEqual(templates.map((item) => item.template_key), ["ultralytics_yolo", "dinov3_faster_rcnn"]);
  assert.deepEqual(templates[0].capabilities_json.tasks, ["detect", "segment", "classify"]);
  assert.equal(templates[0].capabilities_json.builtin, true);
});

test("ensureBuiltinAlgorithmAssets preserves manifests, adapters, SQL, and retirement cleanup", async () => {
  const { calls, service } = createFixture({ objectsExist: false });

  await service.ensureBuiltinAlgorithmAssets();

  assert.equal(calls.putJson.length, 2);
  assert.equal(calls.putText.length, 2);
  assert.equal(calls.putJson[0].key, "code-assets/algorithms/ultralytics_yolo/builtin/manifest.json");
  assert.deepEqual(calls.putJson[0].value.entry, { type: "python", adapter: "adapter.py", function: "run_inference" });
  assert.equal(calls.putText[0].contentType, "text/x-python");
  const inserts = calls.queries.filter((entry) => /INSERT INTO algorithm_assets/.test(entry.sql));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map((entry) => entry.params[1]), ["ultralytics_yolo", "dinov3_faster_rcnn"]);
  assert.deepEqual(inserts[0].params.slice(5, 10), [
    "builtin",
    "code-assets/algorithms/ultralytics_yolo/builtin",
    "code-assets/algorithms/ultralytics_yolo/builtin/manifest.json",
    "code-assets/algorithms/ultralytics_yolo/builtin/adapter.py",
    "code-assets/algorithms/ultralytics_yolo/builtin/source/",
  ]);
  assert.deepEqual(calls.queries.find((entry) => /algorithm_key <> ALL/.test(entry.sql)).params, [["ultralytics_yolo", "dinov3_faster_rcnn"]]);
  assert.match(calls.queries.at(-1).sql, /DELETE FROM training_templates/);
});

test("syncMinioAlgorithmAssets parses BOM streams, derives path keys, and skips invalid manifests", async () => {
  const validKey = "code-assets/algorithms/Custom Algo/V2/manifest.json";
  const invalidKey = "code-assets/algorithms/broken/v1/manifest.json";
  const manifest = {
    name: "Custom Detector",
    framework: "custom-framework",
    tasks: ["detect", "segment"],
    entry: { adapter: "run.py" },
    capabilities: { gpu: true },
    default_params: { threshold: 0.4 },
  };
  const { calls, service } = createFixture({
    objectKeys: [validKey, invalidKey, "code-assets/algorithms/readme.txt"],
    objectBodies: {
      [validKey]: [Buffer.from("\uFEFF"), Buffer.from(JSON.stringify(manifest))],
      [invalidKey]: "{bad json",
    },
  });

  await service.syncMinioAlgorithmAssets();

  assert.deepEqual(calls.listObjectKeys, ["code-assets/algorithms/"]);
  assert.deepEqual(calls.getStream, [validKey, invalidKey]);
  assert.equal(calls.queries.length, 1);
  const params = calls.queries[0].params;
  assert.deepEqual(params.slice(0, 9), [
    "Custom Detector",
    "custom_algo",
    "custom-framework",
    "detect",
    "v2",
    "code-assets/algorithms/Custom Algo/V2",
    validKey,
    "code-assets/algorithms/Custom Algo/V2/run.py",
    "code-assets/algorithms/Custom Algo/V2/source/",
  ]);
  assert.deepEqual(JSON.parse(params[9]), { gpu: true, tasks: ["detect", "segment"], parameterSchema: { groups: [] }, minioSynced: true });
  assert.deepEqual(JSON.parse(params[10]), { threshold: 0.4 });
  assert.equal(params[11], "从 MinIO 算法资产 manifest 自动登记");
  assert.match(calls.errors[0][0], /Invalid algorithm manifest/);
});

test("listAlgorithmAssets normalizes owner and visibility before applying the requested scope", async () => {
  const actor = { id: "user-7" };
  const rows = [{ id: "algorithm-1", algorithm_key: "ultralytics_yolo" }];
  const { calls, service } = createFixture({
    query: async (sql, params) => {
      calls.queries.push({ sql, params });
      return /SELECT a\.\*/.test(sql) ? { rows } : { rows: [] };
    },
    adminId: "admin-7",
  });

  assert.deepEqual(await service.listAlgorithmAssets(actor, "public"), rows);

  assert.deepEqual(calls.scopes, [{ table: "algorithm_assets", alias: "a", actor, scope: "public", params: [] }]);
  assert.deepEqual(calls.queries.find((entry) => /owner_user_id=\$1/.test(entry.sql)).params, ["admin-7"]);
  assert.match(calls.queries.find((entry) => /visibility='public'/.test(entry.sql)).sql, /source_type='builtin' OR version='builtin'/);
  const select = calls.queries.find((entry) => /SELECT a\.\*/.test(entry.sql));
  assert.match(select.sql, /a\.deleted_at IS NULL AND a\.owner_user_id=\$1/);
  assert.deepEqual(select.params, ["user-7"]);
});

test("listAlgorithmAssets preserves recoverable fallback errors and rethrows other failures", async () => {
  const recoverable = new Error("schema unavailable");
  recoverable.code = "57014";
  const recoverableFixture = createFixture({ query: async () => { throw recoverable; } });

  const fallback = await recoverableFixture.service.listAlgorithmAssets({ id: "user-1" }, "mine");
  assert.deepEqual(fallback.map((item) => item.algorithm_key), ["ultralytics_yolo", "dinov3_faster_rcnn"]);
  assert.equal(fallback[0].source_type, "builtin");
  assert.equal(fallback[0].status, "ready");

  const fatal = new Error("database disconnected");
  fatal.code = "08006";
  const fatalFixture = createFixture({ query: async () => { throw fatal; } });
  await assert.rejects(() => fatalFixture.service.listAlgorithmAssets({ id: "user-1" }), fatal);
});
