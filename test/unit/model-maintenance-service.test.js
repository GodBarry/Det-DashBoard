const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createModelMaintenanceService } = require("../../server/ml-assets/model-maintenance-service");

function createFixture({ confirm, existingRoots = [], insideRoot = () => true } = {}) {
  const calls = [];
  const files = new Set(existingRoots);
  const rowsBySql = new Map([
    ["SELECT id, path, metadata_json FROM model_files ORDER BY created_at DESC", [
      {
        id: "file-1",
        path: "ml/artifacts/models/model-1/weights.pt",
        metadata_json: {
          manifestKey: "ml/artifacts/models/model-1/manifest.json",
          weightKey: "ml/artifacts/models/model-1/weights.pt",
        },
      },
      {
        id: "file-2",
        path: "datasets/project-1/image.jpg",
        metadata_json: {
          manifestKey: "other/manifest.json",
          weightKey: "ml/artifacts/models/model-2/weights.pt",
        },
      },
    ]],
    ["SELECT id, artifact_root FROM model_revisions ORDER BY created_at DESC", [{ id: "version-1" }]],
    ["SELECT id FROM model_clusters WHERE deleted_at IS NULL", [{ id: "model-1" }, { id: "model-2" }]],
  ]);
  const query = async (sql) => {
    calls.push(["query", sql]);
    return { rows: rowsBySql.get(sql) || [] };
  };
  const fs = {
    existsSync(target) {
      calls.push(["existsSync", target]);
      return files.has(target);
    },
    rmSync(target, options) {
      calls.push(["rmSync", target, options]);
      files.delete(target);
    },
  };
  const store = {
    async listObjectKeys(prefix) {
      calls.push(["listObjectKeys", prefix]);
      return [
        "ml/artifacts/models/model-1/weights.pt",
        "ml/artifacts/models/model-3/weights.pt",
      ];
    },
    async removeObject(key) {
      calls.push(["removeObject", key]);
    },
  };
  const isInsideRoot = (root, target) => {
    calls.push(["isInsideRoot", root, target]);
    return insideRoot(root, target);
  };
  const service = createModelMaintenanceService({
    query,
    store,
    fs,
    path,
    storageRoot: "C:\\storage",
    isInsideRoot,
  });
  return { calls, files, result: service.clearModelAssets(confirm === undefined ? undefined : { confirm }) };
}

test("clearModelAssets preserves dry-run discovery order, confirmation token, counts, and scope", async () => {
  const modelsRoot = path.join("C:\\storage", "runtime", "models");
  const cacheRoot = path.join("C:\\storage", "runtime", "model-cache");
  const { calls, result } = createFixture({ existingRoots: [modelsRoot] });

  assert.deepEqual(await result, {
    dryRun: true,
    requiresConfirm: "CLEAR_MODEL_ASSETS",
    counts: {
      modelClusters: 2,
      modelVersions: 1,
      modelFiles: 2,
      minioObjects: 4,
      localRoots: 1,
    },
    scope: {
      tables: ["model_files", "model_revisions", "model_clusters"],
      minioPrefix: "ml/artifacts/models/",
      localRoots: [modelsRoot, cacheRoot],
      excludes: ["projects", "project_images", "project_videos", "image_assets", "image_annotations", "dataset_snapshots"],
    },
  });
  assert.deepEqual(calls, [
    ["query", "SELECT id, path, metadata_json FROM model_files ORDER BY created_at DESC"],
    ["query", "SELECT id, artifact_root FROM model_revisions ORDER BY created_at DESC"],
    ["query", "SELECT id FROM model_clusters WHERE deleted_at IS NULL"],
    ["listObjectKeys", "ml/artifacts/models/"],
    ["existsSync", modelsRoot],
    ["existsSync", cacheRoot],
  ]);
});

test("clearModelAssets executes only for the exact token and preserves destructive operation order", async () => {
  const modelsRoot = path.join("C:\\storage", "runtime", "models");
  const cacheRoot = path.join("C:\\storage", "runtime", "model-cache");
  const resolvedModelsRoot = path.resolve(modelsRoot);
  const resolvedCacheRoot = path.resolve(cacheRoot);
  const { calls, result } = createFixture({
    confirm: "CLEAR_MODEL_ASSETS",
    existingRoots: [resolvedModelsRoot, resolvedCacheRoot],
    insideRoot: (_root, target) => target !== resolvedCacheRoot,
  });

  assert.deepEqual(await result, {
    dryRun: false,
    deleted: {
      modelClusters: 2,
      modelVersions: 1,
      modelFiles: 2,
      minioObjects: 4,
      localRoots: 1,
    },
  });
  assert.deepEqual(calls, [
    ["query", "SELECT id, path, metadata_json FROM model_files ORDER BY created_at DESC"],
    ["query", "SELECT id, artifact_root FROM model_revisions ORDER BY created_at DESC"],
    ["query", "SELECT id FROM model_clusters WHERE deleted_at IS NULL"],
    ["listObjectKeys", "ml/artifacts/models/"],
    ["removeObject", "ml/artifacts/models/model-1/weights.pt"],
    ["removeObject", "ml/artifacts/models/model-1/manifest.json"],
    ["removeObject", "ml/artifacts/models/model-2/weights.pt"],
    ["removeObject", "ml/artifacts/models/model-3/weights.pt"],
    ["isInsideRoot", "C:\\storage", resolvedModelsRoot],
    ["existsSync", resolvedModelsRoot],
    ["rmSync", resolvedModelsRoot, { recursive: true, force: true }],
    ["isInsideRoot", "C:\\storage", resolvedCacheRoot],
    ["query", "DELETE FROM model_files"],
    ["query", "DELETE FROM model_revisions"],
    ["query", "UPDATE model_clusters SET deleted_at=now(), updated_at=now() WHERE deleted_at IS NULL"],
    ["existsSync", modelsRoot],
    ["existsSync", cacheRoot],
  ]);
});

test("clearModelAssets does not accept near-match confirmation tokens", async () => {
  const { calls, result } = createFixture({ confirm: "clear_model_assets" });

  assert.equal((await result).dryRun, true);
  assert.equal(calls.some(([operation]) => operation === "removeObject" || operation === "rmSync"), false);
  assert.equal(calls.filter(([operation]) => operation === "query").length, 3);
});

test("clearModelAssets preserves dependency error text and stops at the failing operation", async () => {
  const failure = new Error("object storage listing failed");
  const calls = [];
  const service = createModelMaintenanceService({
    async query(sql) {
      calls.push(["query", sql]);
      if (sql.startsWith("SELECT id, path")) return { rows: [] };
      if (sql.startsWith("SELECT id, artifact_root")) return { rows: [] };
      return { rows: [] };
    },
    store: {
      async listObjectKeys(prefix) {
        calls.push(["listObjectKeys", prefix]);
        throw failure;
      },
      async removeObject() {
        calls.push(["removeObject"]);
      },
    },
    fs: {
      existsSync() {
        calls.push(["existsSync"]);
        return false;
      },
      rmSync() {
        calls.push(["rmSync"]);
      },
    },
    path,
    storageRoot: "C:\\storage",
    isInsideRoot() {
      calls.push(["isInsideRoot"]);
      return true;
    },
  });

  await assert.rejects(() => service.clearModelAssets({ confirm: "CLEAR_MODEL_ASSETS" }), failure);
  assert.deepEqual(calls, [
    ["query", "SELECT id, path, metadata_json FROM model_files ORDER BY created_at DESC"],
    ["query", "SELECT id, artifact_root FROM model_revisions ORDER BY created_at DESC"],
    ["query", "SELECT id FROM model_clusters WHERE deleted_at IS NULL"],
    ["listObjectKeys", "ml/artifacts/models/"],
  ]);
});
