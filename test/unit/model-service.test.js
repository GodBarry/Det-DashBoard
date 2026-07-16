const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createModelService } = require("../../server/ml-assets/model-service");

function createFixture(query, overrides = {}) {
  const calls = {
    access: [],
    mkdir: [],
    putFile: [],
    putJson: [],
    writeObjectToFile: [],
  };
  const fs = {
    existsSync: () => false,
    statSync: () => ({ size: 0, isFile: () => true }),
    mkdirSync(target, options) {
      calls.mkdir.push({ target, options });
    },
    createReadStream: overrides.createReadStream || (() => { throw new Error("unexpected local stream"); }),
    ...overrides.fs,
  };
  const store = {
    async putFile(key, sourcePath) {
      calls.putFile.push({ key, sourcePath });
    },
    async putJson(key, value) {
      calls.putJson.push({ key, value });
    },
    async getStream() {
      throw new Error("unexpected object stream");
    },
    localFallbackPath: (key) => `fallback:${key}`,
    ...overrides.store,
  };
  const resourceAccess = {
    scopeSql(input) {
      calls.access.push({ method: "scopeSql", input });
      return { sql: `m.owner_user_id=$${input.params.length + 1}`, params: [...input.params, input.actor.id] };
    },
    async assertIndependentAccess(...args) {
      calls.access.push({ method: "assertIndependentAccess", args });
    },
    async assignOwner(...args) {
      calls.access.push({ method: "assignOwner", args });
      return args[0] === "model_clusters" ? { id: args[1], owner_user_id: args[2].id } : undefined;
    },
    ...overrides.resourceAccess,
  };
  const service = createModelService({
    query,
    resourceAccess,
    fs,
    path,
    storageRoot: "C:\\storage",
    store,
    cleanName: (value, fallback) => String(value || fallback).replace(/\s+/g, "_"),
    dateCode: () => "20260716",
    hashFile: overrides.hashFile || (async () => "sha-256"),
    modelWeightManifestKey: (modelId, versionId) => `ml/artifacts/models/${modelId}/${versionId}/manifest.json`,
    async writeObjectToFile(key, target) {
      calls.writeObjectToFile.push({ key, target });
    },
    sendError: overrides.sendError || ((res, statusCode, message) => ({ res, statusCode, message })),
  });
  return { calls, service };
}

test("model lists preserve scope parameters, fallback SQL, and version result shape", async () => {
  const actor = { id: "user-1" };
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (queries.length === 1) {
      const error = new Error("model revisions unavailable");
      error.code = "42P01";
      throw error;
    }
    if (sql.includes("FROM model_clusters m") && !sql.includes("FROM model_revisions mv\n")) return { rows: [{ id: "model-1", version_count: 0 }] };
    return { rows: [{ id: "version-1", artifacts: [] }] };
  };
  const { calls, service } = createFixture(query);

  assert.deepEqual(await service.listMlModels(actor, "shared"), [{ id: "model-1", version_count: 0 }]);
  assert.deepEqual(await service.listModelVersions("model-1", actor, "shared"), [{ id: "version-1", artifacts: [] }]);

  assert.deepEqual(queries.map((entry) => entry.params), [["user-1"], ["user-1"], ["model-1", "user-1"]]);
  assert.match(queries[0].sql, /count\(\*\)::int FROM model_revisions/);
  assert.match(queries[1].sql, /0::int AS version_count/);
  assert.match(queries[2].sql, /jsonb_agg/);
  assert.match(queries[2].sql, /WHERE mv\.model_id=\$1 AND m\.owner_user_id=\$2/);
  assert.equal(calls.access[0].input.params.length, 0);
  assert.deepEqual(calls.access[1].input.params, ["model-1", "user-1"]);
});

test("model creation, naming, and rename preserve SQL and owner contracts", async () => {
  const actor = { id: "user-2" };
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith("INSERT INTO model_clusters")) return { rows: [{ id: "model-2" }] };
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: 8 }] };
    if (sql.startsWith("UPDATE model_revisions")) return { rows: [{ id: "version-2", version_name: params[0] }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const { calls, service } = createFixture(query);

  assert.deepEqual(await service.createMlModel({ name: " detector ", task_type: "segment", visibility: "public" }, actor), { id: "model-2", owner_user_id: "user-2" });
  assert.equal(await service.nextModelVersionName("release candidate", "model-2"), "release_candidate_009");
  assert.deepEqual(await service.renameModelVersion("version-2", { version_name: " v2 " }), { id: "version-2", version_name: "v2" });

  assert.deepEqual(queries.map((entry) => entry.params), [
    ["detector", "segment", "ultralytics", ""],
    ["model-2", "release_candidate_%"],
    ["v2", "version-2"],
  ]);
  assert.deepEqual(calls.access.at(-1).args, ["model_clusters", "model-2", actor, { visibility: "public" }]);
});

test("createModelVersion preserves MinIO key, manifest, metadata, and permission order", async () => {
  const actor = { id: "user-3" };
  const sourcePath = "C:\\weights\\best.PT";
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith("SELECT * FROM model_clusters")) return { rows: [{ id: "model-3", name: "YOLO", framework: "ultralytics", task_type: "detect" }] };
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: 0 }] };
    if (sql.startsWith("INSERT INTO model_revisions")) return { rows: [{ id: "version-3", version_name: params[1] }] };
    if (sql.startsWith("INSERT INTO model_files")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const { calls, service } = createFixture(query, {
    fs: {
      existsSync: (target) => target === sourcePath,
      statSync: () => ({ size: 17, isFile: () => true }),
    },
  });

  const version = await service.createModelVersion({ modelId: "model-3", sourcePath, params: { epochs: 10 } }, actor);

  assert.equal(version.id, "version-3");
  assert.deepEqual(calls.access[0], { method: "assertIndependentAccess", args: ["model_clusters", "model-3", actor, "write"] });
  assert.deepEqual(calls.access[1].args, ["model_revisions", "version-3", actor]);
  assert.equal(calls.putFile[0].key, "ml/artifacts/models/model-3/version-3/weights.pt");
  assert.equal(calls.putJson[0].key, "ml/artifacts/models/model-3/version-3/manifest.json");
  assert.deepEqual({ ...calls.putJson[0].value, createdAt: "<dynamic>" }, {
    format: "det-dashboard.model-weight.v1",
    assetType: "model_weight",
    modelId: "model-3",
    modelName: "YOLO",
    modelVersionId: "version-3",
    versionName: "pretrain_YOLO_20260716_001",
    framework: "ultralytics",
    taskType: "detect",
    weightKey: "ml/artifacts/models/model-3/version-3/weights.pt",
    weightName: "weights.pt",
    size: 17,
    sha256: "sha-256",
    extension: ".pt",
    importSourcePath: sourcePath,
    createdAt: "<dynamic>",
  });
  const metadata = JSON.parse(queries.at(-1).params[4]);
  assert.deepEqual(metadata, {
    assetPolicy: "platform_minio_asset",
    weightKey: "ml/artifacts/models/model-3/version-3/weights.pt",
    manifestKey: "ml/artifacts/models/model-3/version-3/manifest.json",
    importSourcePath: sourcePath,
    weightRole: "pretrained",
  });
});

test("artifact lookup and streaming preserve cache paths, selection, and response headers", async () => {
  const queries = [];
  const remoteStream = { pipeTarget: null, pipe(target) { this.pipeTarget = target; } };
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes("SELECT ma.*\n       FROM model_files")) return { rows: [{ path: "ml/artifacts/models/m/v/weights/best.pt" }] };
    return { rows: [{
      id: "artifact-1",
      path: "ml/artifacts/models/m/v/weights/best.pt",
      model_name: "Model One",
      version_name: "Version One",
      metadata_json: {},
    }] };
  };
  const { calls, service } = createFixture(query, {
    store: { async getStream() { return remoteStream; } },
  });
  const res = { statusCode: null, headers: null, writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; } };

  const cached = await service.findWeightArtifact("version-4");
  await service.streamModelArtifact(res, "version-4", "artifact-1");

  assert.equal(cached, path.join("C:\\storage", "runtime", "model-cache", "version-4", "weights.pt"));
  assert.deepEqual(calls.writeObjectToFile, [{ key: "ml/artifacts/models/m/v/weights/best.pt", target: cached }]);
  assert.deepEqual(queries.map((entry) => entry.params), [["version-4"], ["version-4", "artifact-1"]]);
  assert.match(queries[0].sql, /artifact_type='weights'/);
  assert.match(queries[1].sql, /ma\.id=\$2/);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/octet-stream");
  assert.equal(res.headers["content-disposition"], 'attachment; filename="Model_One_Version_One_best.pt"');
  assert.equal(remoteStream.pipeTarget, res);
});
