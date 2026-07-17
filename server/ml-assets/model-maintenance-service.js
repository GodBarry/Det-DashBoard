function createModelMaintenanceService({ query, store, fs, path, storageRoot, isInsideRoot }) {
  if (typeof query !== "function") throw new TypeError("createModelMaintenanceService requires query");
  if (!store || typeof store.listObjectKeys !== "function" || typeof store.removeObject !== "function") {
    throw new TypeError("createModelMaintenanceService requires store");
  }
  if (!fs || typeof fs.existsSync !== "function" || typeof fs.rmSync !== "function") {
    throw new TypeError("createModelMaintenanceService requires fs");
  }
  if (!path || typeof path.join !== "function" || typeof path.resolve !== "function") {
    throw new TypeError("createModelMaintenanceService requires path");
  }
  if (typeof isInsideRoot !== "function") throw new TypeError("createModelMaintenanceService requires isInsideRoot");

  async function clearModelAssets(body = {}) {
    const confirm = String(body.confirm || "");
    const execute = confirm === "CLEAR_MODEL_ASSETS";
    const modelFiles = (await query("SELECT id, path, metadata_json FROM model_files ORDER BY created_at DESC")).rows;
    const modelVersions = (await query("SELECT id, artifact_root FROM model_revisions ORDER BY created_at DESC")).rows;
    const modelClusters = (await query("SELECT id FROM model_clusters WHERE deleted_at IS NULL")).rows;
    const objectKeys = new Set();
    for (const row of modelFiles) {
      if (row.path && String(row.path).startsWith("ml/artifacts/models/")) objectKeys.add(row.path);
      const meta = row.metadata_json || {};
      if (meta.manifestKey && String(meta.manifestKey).startsWith("ml/artifacts/models/")) objectKeys.add(meta.manifestKey);
      if (meta.weightKey && String(meta.weightKey).startsWith("ml/artifacts/models/")) objectKeys.add(meta.weightKey);
    }
    for (const key of await store.listObjectKeys("ml/artifacts/models/")) objectKeys.add(key);

    const localRoots = [
      path.join(storageRoot, "runtime", "models"),
      path.join(storageRoot, "runtime", "model-cache"),
    ];

    if (!execute) {
      return {
        dryRun: true,
        requiresConfirm: "CLEAR_MODEL_ASSETS",
        counts: {
          modelClusters: modelClusters.length,
          modelVersions: modelVersions.length,
          modelFiles: modelFiles.length,
          minioObjects: objectKeys.size,
          localRoots: localRoots.filter((root) => fs.existsSync(root)).length,
        },
        scope: {
          tables: ["model_files", "model_revisions", "model_clusters"],
          minioPrefix: "ml/artifacts/models/",
          localRoots,
          excludes: ["projects", "project_images", "project_videos", "image_assets", "image_annotations", "dataset_snapshots"],
        },
      };
    }

    for (const key of objectKeys) await store.removeObject(key);
    for (const root of localRoots) {
      const resolved = path.resolve(root);
      if (isInsideRoot(storageRoot, resolved) && fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
    }
    await query("DELETE FROM model_files");
    await query("DELETE FROM model_revisions");
    await query("UPDATE model_clusters SET deleted_at=now(), updated_at=now() WHERE deleted_at IS NULL");
    return {
      dryRun: false,
      deleted: {
        modelClusters: modelClusters.length,
        modelVersions: modelVersions.length,
        modelFiles: modelFiles.length,
        minioObjects: objectKeys.size,
        localRoots: localRoots.filter((root) => !fs.existsSync(root)).length,
      },
    };
  }

  return { clearModelAssets };
}

module.exports = { createModelMaintenanceService };
