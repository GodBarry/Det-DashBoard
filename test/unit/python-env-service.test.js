const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");

const { createPythonEnvService } = require("../../server/ml-assets/python-env-service");

function createFixture(query, overrides = {}) {
  const calls = {
    scope: [],
    owners: [],
    putFile: [],
    putJson: [],
    downloads: [],
  };
  const files = new Set(overrides.files || []);
  const fs = {
    existsSync: (target) => files.has(target),
    statSync: (target) => ({ size: target.endsWith("env.tar.gz") ? 123 : 0, isFile: () => true }),
    mkdirSync: () => {},
    createReadStream: () => { throw new Error("unexpected local stream"); },
    ...overrides.fs,
  };
  const remoteStream = overrides.remoteStream || { pipe(target) { this.target = target; } };
  const store = {
    async putFile(...args) { calls.putFile.push(args); },
    async putJson(...args) { calls.putJson.push(args); },
    async getStream(key) { calls.downloads.push(key); return remoteStream; },
    localFallbackPath: (key) => path.join("C:\\fallback", key),
    ...overrides.store,
  };
  const service = createPythonEnvService({
    query,
    scopeSql(input) {
      calls.scope.push(input);
      return { sql: "e.owner_user_id=$1", params: [input.actor.id] };
    },
    async assignOwner(...args) {
      calls.owners.push(args);
      return { id: args[1], owner_user_id: args[2].id };
    },
    fs,
    path,
    process: { platform: "win32", arch: "x64" },
    spawnSync: overrides.spawnSync || (() => ({ status: 0, stdout: "" })),
    crypto,
    store,
    cleanName: (value, fallback) => String(value || fallback).replace(/\s+/g, "_"),
    hashFile: overrides.hashFile || (async () => "a".repeat(64)),
    pythonEnvObjectKey: (sha, name) => `envs/python/conda-pack/${sha}/${name}`,
    pythonEnvManifestKey: (sha) => `envs/python/conda-pack/${sha}/manifest.json`,
    serverPythonEnvObjectKey: (sha) => `envs/python/server-managed/${sha}/metadata.json`,
    dataRoot: "C:\\data",
    storageRoot: "C:\\storage",
    minio: { dataDir: "C:\\minio", bucket: "assets" },
    isInsideRoot: overrides.isInsideRoot || (() => true),
    async writeObjectToFile(key, target) {
      calls.downloads.push({ key, target });
      files.add(target);
    },
    sendError: (res, statusCode, message) => ({ res, statusCode, message }),
  });
  return { calls, files, remoteStream, service };
}

test("listPythonEnvs preserves scoped SQL, ordering, and row shape", async () => {
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [{ id: "env-1", status: "ready" }] };
  };
  const { calls, service } = createFixture(query);
  const actor = { id: "user-1" };

  assert.deepEqual(await service.listPythonEnvs(actor, "shared"), [{ id: "env-1", status: "ready" }]);
  assert.deepEqual(calls.scope[0], { table: "runtime_envs", alias: "e", actor, scope: "shared", params: [] });
  assert.deepEqual(queries[0].params, ["user-1"]);
  assert.match(queries[0].sql, /ORDER BY os_type, arch, accelerator DESC, status='ready' DESC, created_at DESC/);
});

test("conda-pack import preserves keys, manifest, database fields, and owner result", async () => {
  const sourcePath = path.resolve("C:\\data\\env.tar.gz");
  const unpackPath = path.join("C:\\storage", "runtime", "python-envs", "aaaaaaaaaaaa");
  const pythonPath = path.join(unpackPath, "python.exe");
  const files = new Set([sourcePath]);
  const queries = [];
  const spawnSync = (command, args) => {
    if (command === "tar" && args[0] === "-tf") {
      return { status: 0, stdout: "python.exe\nLib/\nScripts/\nconda-meta/\n" };
    }
    if (command === "tar" && args[0] === "-xf") {
      files.add(pythonPath);
      return { status: 0, stdout: "" };
    }
    if (args[0] === "--version") return { status: 0, stdout: "Python 3.11.9\n" };
    return { status: 0, stdout: JSON.stringify({ ultralytics: true, mmdet: false, mmcv: false, detectron2: false, torch: true, torch_version: "2.5.1", cuda_available: true, cuda_version: "12.4" }) };
  };
  const query = async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [{ id: "env-2" }] };
  };
  const { calls, service } = createFixture(query, {
    files,
    fs: {
      existsSync: (target) => files.has(target),
      statSync: () => ({ size: 123, isFile: () => true }),
    },
    spawnSync,
  });
  const actor = { id: "user-2" };

  assert.deepEqual(await service.createPythonEnv({ sourceType: "conda_pack", sourcePath, visibility: "public" }, actor), { id: "env-2", owner_user_id: "user-2" });

  const sha = "a".repeat(64);
  const artifactKey = `envs/python/conda-pack/${sha}/env.tar.gz`;
  const manifestKey = `envs/python/conda-pack/${sha}/manifest.json`;
  assert.deepEqual(calls.putFile, [[artifactKey, sourcePath, { "x-amz-meta-source": "conda-pack" }]]);
  assert.equal(calls.putJson[0][0], manifestKey);
  assert.deepEqual({ ...calls.putJson[0][1], createdAt: "<dynamic>" }, {
    format: "det-dashboard.python-env.v1",
    assetType: "python_env",
    sourceType: "conda_pack",
    artifactKey,
    manifestKey,
    artifactName: "env.tar.gz",
    artifactSize: 123,
    artifactSha256: sha,
    unpackPath,
    pythonPath,
    osType: "windows",
    arch: "x86_64",
    accelerator: "cuda",
    pythonVersion: "Python 3.11.9",
    torchVersion: "2.5.1",
    cudaAvailable: true,
    cudaVersion: "12.4",
    packages: { ultralytics: true, mmdet: false, mmcv: false, detectron2: false, torch: true, torch_version: "2.5.1", cuda_available: true, cuda_version: "12.4" },
    tasks: ["detect", "segment", "classify"],
    importSourcePath: sourcePath,
    createdAt: "<dynamic>",
  });
  assert.equal(queries[0].params[0], "py3.11-torch2.5.1-cuda");
  assert.equal(queries[0].params[13], "conda_pack");
  assert.equal(queries[0].params[14], artifactKey);
  assert.deepEqual(calls.owners[0], ["runtime_envs", "env-2", actor, { visibility: "public" }]);
});

test("download streams the MinIO artifact with the existing response contract", async () => {
  const query = async () => ({ rows: [{
    id: "env-3",
    name: "CUDA Env",
    source_type: "conda_pack",
    artifact_key: "envs/python/conda-pack/sha/env.tar.gz",
    artifact_size: 456,
  }] });
  const { calls, remoteStream, service } = createFixture(query);
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; } };

  await service.streamPythonEnvArtifact(res, "env-3");

  assert.equal(res.status, 200);
  assert.deepEqual(res.headers, {
    "content-type": "application/gzip",
    "content-disposition": 'attachment; filename="CUDA_Env.tar.gz"',
    "cache-control": "no-store",
    "content-length": "456",
  });
  assert.deepEqual(calls.downloads, ["envs/python/conda-pack/sha/env.tar.gz"]);
  assert.equal(remoteStream.target, res);
});

test("resolveRuntimePythonEnv restores archive cache, unpacks, and updates a recovered path", async () => {
  const env = {
    id: "env-4",
    python_path: "C:\\missing\\python.exe",
    source_type: "conda_pack",
    artifact_key: "envs/python/conda-pack/sha/env.tar.gz",
    artifact_name: "env.tar.gz",
    unpack_path: "C:\\runtime\\env-4",
  };
  const recoveredPython = path.join(env.unpack_path, "python.exe");
  const files = new Set();
  const queries = [];
  const query = async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; };
  const spawnSync = (command, args) => {
    assert.equal(command, "tar");
    assert.equal(args[0], "-xf");
    files.add(recoveredPython);
    return { status: 0, stdout: "" };
  };
  const { calls, service } = createFixture(query, {
    files,
    fs: {
      existsSync: (target) => files.has(target),
      statSync: () => ({ size: 1, isFile: () => true }),
    },
    spawnSync,
  });

  const result = await service.resolveRuntimePythonEnv(env);
  const archivePath = path.join("C:\\storage", "runtime", "python-env-cache", "env-4", "env.tar.gz");
  assert.deepEqual(calls.downloads, [{ key: env.artifact_key, target: archivePath }]);
  assert.equal(result.python_path, recoveredPython);
  assert.deepEqual(queries, [{ sql: "UPDATE runtime_envs SET python_path=$1 WHERE id=$2", params: [recoveredPython, "env-4"] }]);
});
