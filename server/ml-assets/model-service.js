function createModelService({
  query,
  resourceAccess,
  fs,
  path,
  storageRoot,
  store,
  cleanName,
  dateCode,
  hashFile,
  modelWeightManifestKey,
  writeObjectToFile,
  sendError,
}) {
  if (typeof query !== "function") throw new TypeError("createModelService requires query");
  if (!resourceAccess || typeof resourceAccess.scopeSql !== "function") throw new TypeError("createModelService requires resourceAccess");
  if (!fs || typeof fs.existsSync !== "function") throw new TypeError("createModelService requires fs");
  if (!path || typeof path.join !== "function") throw new TypeError("createModelService requires path");
  if (!store || typeof store.putFile !== "function" || typeof store.getStream !== "function") throw new TypeError("createModelService requires store");
  if (typeof cleanName !== "function") throw new TypeError("createModelService requires cleanName");
  if (typeof dateCode !== "function") throw new TypeError("createModelService requires dateCode");
  if (typeof hashFile !== "function") throw new TypeError("createModelService requires hashFile");
  if (typeof modelWeightManifestKey !== "function") throw new TypeError("createModelService requires modelWeightManifestKey");
  if (typeof writeObjectToFile !== "function") throw new TypeError("createModelService requires writeObjectToFile");
  if (typeof sendError !== "function") throw new TypeError("createModelService requires sendError");

  async function listMlModels(actor, scope = "mine") {
    const scoped = resourceAccess.scopeSql({ table: "model_clusters", alias: "m", actor, scope, params: [] });
    try {
      const rows = await query(
        `SELECT m.*,
          (SELECT count(*)::int FROM model_revisions mv WHERE mv.model_id=m.id) AS version_count,
          (SELECT max(mv.created_at) FROM model_revisions mv WHERE mv.model_id=m.id) AS last_version_at
         FROM model_clusters m
         WHERE m.deleted_at IS NULL AND ${scoped.sql}
         ORDER BY m.created_at DESC`,
        scoped.params,
      );
      return rows.rows;
    } catch (error) {
      if (error.code !== "42P01") throw error;
      const rows = await query(
        `SELECT m.*, 0::int AS version_count, NULL::timestamptz AS last_version_at
         FROM model_clusters m
         WHERE m.deleted_at IS NULL AND ${scoped.sql}
         ORDER BY m.created_at DESC`,
        scoped.params,
      );
      return rows.rows;
    }
  }

  async function createMlModel(body = {}, actor) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("模型名称不能为空");
    const taskType = String(body.taskType || body.task_type || "detect").trim() || "detect";
    const framework = String(body.framework || "ultralytics").trim() || "ultralytics";
    const description = String(body.description || "").trim();
    const rows = await query(
      `INSERT INTO model_clusters (name, task_type, framework, description)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, taskType, framework, description],
    );
    return resourceAccess.assignOwner("model_clusters", rows.rows[0].id, actor, { visibility: body.visibility || "private" });
  }

  async function nextModelVersionName(prefix, modelId) {
    const base = cleanName(prefix, "version");
    const like = `${base}_%`;
    const rows = await query("SELECT count(*)::int AS count FROM model_revisions WHERE model_id=$1 AND version_name LIKE $2", [modelId, like]);
    return `${base}_${String((rows.rows[0]?.count || 0) + 1).padStart(3, "0")}`;
  }

  async function createModelVersion(body = {}, actor) {
    const modelId = body.modelId || body.model_id;
    if (!modelId) throw new Error("Select a model cluster.");
    await resourceAccess.assertIndependentAccess?.("model_clusters", modelId, actor, "write");
    const model = (await query("SELECT * FROM model_clusters WHERE id=$1 AND deleted_at IS NULL", [modelId])).rows[0];
    if (!model) throw new Error("模型簇不存在");
    const requestedStage = String(body.stage || "pretrained").trim().toLowerCase();
    const stage = ["pretrained", "training", "candidate", "production"].includes(requestedStage) ? requestedStage : "pretrained";
    const sourcePath = String(body.sourcePath || body.source_path || "").trim();
    const params = body.params || {};
    const defaultPrefix = `${stage === "pretrained" ? "pretrain" : stage}_${model.name}_${dateCode()}`;
    const versionName = String(body.versionName || body.version_name || await nextModelVersionName(defaultPrefix, model.id)).trim();
    const artifactRoot = path.join(storageRoot, "runtime", "models", model.id, versionName);
    fs.mkdirSync(artifactRoot, { recursive: true });
    const version = (await query(
      `INSERT INTO model_revisions (model_id, version_name, stage, params_json, artifact_root)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [model.id, versionName, stage, JSON.stringify(params), artifactRoot],
    )).rows[0];
    await resourceAccess.assignOwner("model_revisions", version.id, actor);
    if (sourcePath) {
      if (!fs.existsSync(sourcePath)) throw new Error("Weight file does not exist.");
      const ext = path.extname(sourcePath).toLowerCase() || ".pt";
      const objectKey = `ml/artifacts/models/${model.id}/${version.id}/weights${ext}`;
      await store.putFile(objectKey, sourcePath);
      const stat = fs.statSync(sourcePath);
      const sha = await hashFile(sourcePath).catch(() => null);
      const manifestKey = modelWeightManifestKey(model.id, version.id);
      const manifest = {
        format: "det-dashboard.model-weight.v1",
        assetType: "model_weight",
        modelId: model.id,
        modelName: model.name,
        modelVersionId: version.id,
        versionName,
        framework: model.framework,
        taskType: model.task_type,
        weightKey: objectKey,
        weightName: path.basename(objectKey),
        size: stat.size,
        sha256: sha,
        extension: ext,
        importSourcePath: sourcePath,
        createdAt: new Date().toISOString(),
      };
      await store.putJson(manifestKey, manifest);
      await query(
        `INSERT INTO model_files (model_version_id, artifact_type, path, size, sha256, metadata_json)
         VALUES ($1,'weights',$2,$3,$4,$5)`,
        [version.id, objectKey, stat.size, sha, JSON.stringify({ assetPolicy: "platform_minio_asset", weightKey: objectKey, manifestKey, importSourcePath: sourcePath, weightRole: stage === "pretrained" ? "pretrained" : "other" })],
      );
    }
    return version;
  }

  async function renameModelVersion(versionId, body = {}) {
    const name = String(body.versionName || body.version_name || "").trim();
    if (!name) throw new Error("Version name cannot be empty.");
    const rows = await query("UPDATE model_revisions SET version_name=$1 WHERE id=$2 RETURNING *", [name, versionId]);
    if (!rows.rows[0]) throw new Error("模型版本不存在");
    return rows.rows[0];
  }

  async function listModelVersions(modelId, actor, scope = "mine") {
    const params = [];
    const where = [];
    if (modelId) {
      params.push(modelId);
      where.push(`mv.model_id=$${params.length}`);
    }
    const scoped = resourceAccess.scopeSql({ table: "model_clusters", alias: "m", actor, scope, params });
    params.splice(0, params.length, ...scoped.params);
    where.push(scoped.sql);
    const rows = await query(
      `SELECT mv.*, m.name AS model_name, p.name AS dataset_project_name,
         tj.name AS training_job_name, tj.current_epoch AS training_current_epoch,
         tj.total_epochs AS training_total_epochs, tj.finished_at AS training_finished_at,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', mf.id,
               'artifact_type', mf.artifact_type,
               'path', mf.path,
               'size', mf.size,
               'sha256', mf.sha256,
               'metadata_json', mf.metadata_json,
               'created_at', mf.created_at
             ) ORDER BY mf.created_at, mf.id
           )
           FROM model_files mf
           WHERE mf.model_version_id=mv.id
         ), '[]'::jsonb) AS artifacts
       FROM model_revisions mv
       JOIN model_clusters m ON m.id=mv.model_id
       LEFT JOIN projects p ON p.id=mv.dataset_project_id
       LEFT JOIN runtime_training_jobs tj ON tj.id=mv.training_job_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY mv.created_at DESC
       LIMIT 200`,
      params,
    );
    return rows.rows;
  }

  async function findWeightArtifact(modelVersionId) {
    if (!modelVersionId) return null;
    const rows = await query(
      `SELECT ma.*
       FROM model_files ma
       WHERE ma.model_version_id=$1 AND ma.artifact_type='weights'
       ORDER BY
         CASE WHEN ma.path ILIKE '%/weights/best.pt' OR ma.path ILIKE '%\\weights\\best.pt' THEN 0 ELSE 1 END,
         ma.created_at DESC
       LIMIT 1`,
      [modelVersionId],
    );
    const artifact = rows.rows[0];
    if (!artifact) return null;
    const ext = path.extname(artifact.path || "") || ".pt";
    const cached = path.join(storageRoot, "runtime", "model-cache", modelVersionId, `weights${ext}`);
    if (fs.existsSync(cached) && fs.statSync(cached).isFile()) return cached;
    await writeObjectToFile(artifact.path, cached);
    return cached;
  }

  async function streamModelArtifact(res, modelVersionId, artifactId) {
    const params = [modelVersionId];
    let where = "ma.model_version_id=$1";
    if (artifactId) {
      params.push(artifactId);
      where += ` AND ma.id=$${params.length}`;
    } else {
      where += " AND ma.artifact_type='weights'";
    }
    const rows = await query(
      `SELECT ma.*, mv.version_name, m.name AS model_name
       FROM model_files ma
       JOIN model_revisions mv ON mv.id=ma.model_version_id
       JOIN model_clusters m ON m.id=mv.model_id
       WHERE ${where}
       ORDER BY
         CASE WHEN ma.path ILIKE '%/weights/best.pt' OR ma.path ILIKE '%\\\\weights\\\\best.pt' THEN 0 ELSE 1 END,
         ma.created_at DESC
       LIMIT 1`,
      params,
    );
    const artifact = rows.rows[0];
    if (!artifact) return sendError(res, 404, "model artifact not found");
    const ext = path.extname(artifact.path || "") || ".bin";
    const fileName = `${cleanName(artifact.model_name, "model")}_${cleanName(artifact.version_name, "version")}_${path.basename(artifact.path || `artifact${ext}`)}`;
    const meta = artifact.metadata_json || {};
    const localPath = meta.localPath && fs.existsSync(meta.localPath) ? meta.localPath : store.localFallbackPath(artifact.path);
    if (fs.existsSync(localPath)) {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      });
      fs.createReadStream(localPath).pipe(res);
      return;
    }
    const stream = await store.getStream(artifact.path);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
    stream.pipe(res);
  }

  return {
    listMlModels,
    createMlModel,
    nextModelVersionName,
    createModelVersion,
    renameModelVersion,
    listModelVersions,
    findWeightArtifact,
    streamModelArtifact,
  };
}

module.exports = { createModelService };
