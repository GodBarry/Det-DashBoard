const childProcess = require("node:child_process");

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

  function inferWeightFramework(sourcePath, model = {}) {
    const fileName = path.basename(sourcePath).toLowerCase();
    const ext = path.extname(fileName);
    if (ext === ".onnx") return "ONNX";
    if (/dino|faster[-_]?r?cnn|mmdet/.test(fileName)) return "PyTorch / MMDetection";
    if (/yolo|ultralytics/.test(fileName) || ext === ".pt") return "Ultralytics";
    if (ext === ".pth") return "PyTorch";
    return model.framework || "Unknown";
  }

  function validateWeightPath(sourcePath) {
    if (!sourcePath) throw new Error("请选择权重文件路径");
    if (/^[a-z]:[^\\/]/i.test(sourcePath)) throw new Error("Windows 盘符路径需写为 E:\\文件名，而不是 E:文件名");
    if (!fs.existsSync(sourcePath)) throw new Error("权重文件不存在，请确认这是服务器上的绝对路径");
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error("权重文件路径必须指向文件，不能是文件夹");
    return stat;
  }

  function isRemoteWeightPath(value) {
    return /^(?:scp|ssh):\/\//i.test(value) || /^[^@\s]+@[^:\s]+:.+/.test(value);
  }

  function downloadRemoteWeight(remotePath) {
    let source = remotePath;
    const args = ["-q"];
    if (/^(?:scp|ssh):\/\//i.test(remotePath)) {
      const parsed = new URL(remotePath.replace(/^ssh:/i, "scp:"));
      if (!parsed.username || !parsed.hostname || !parsed.pathname) throw new Error("网络路径格式应为 scp://用户@主机/文件路径");
      if (parsed.port) args.push("-P", parsed.port);
      source = `${decodeURIComponent(parsed.username)}@${parsed.hostname}:${decodeURIComponent(parsed.pathname)}`;
    }
    const remoteName = path.basename(source.split(":").at(-1) || "weights.pth");
    const targetDir = path.join(storageRoot, "runtime", "remote-model-imports", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, remoteName);
    args.push(source, targetPath);
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn("scp", args, { windowsHide: true, shell: false });
      let stderr = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("SCP 下载超时")); }, 30 * 60 * 1000);
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => { clearTimeout(timer); reject(new Error(`无法启动 SCP：${error.message}`)); });
      child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(targetPath); else reject(new Error(stderr.trim() || `SCP 下载失败，退出码 ${code}`)); });
    });
  }

  async function inspectModelWeight(body = {}) {
    const modelId = body.modelId || body.model_id;
    const sourcePath = String(body.sourcePath || body.source_path || "").trim();
    const model = modelId ? (await query("SELECT * FROM model_clusters WHERE id=$1 AND deleted_at IS NULL", [modelId])).rows[0] : null;
    if (!model) throw new Error("请先选择模型簇");
    if (isRemoteWeightPath(sourcePath)) return {
      fileName: path.basename(sourcePath.split(":").at(-1) || sourcePath),
      size: null,
      sizeLabel: "登记时下载",
      sha256: null,
      sha256Pending: true,
      framework: inferWeightFramework(sourcePath, model),
      taskType: model.task_type,
      epoch: Number(path.basename(sourcePath).match(/epoch[_-]?(\d+)/i)?.[1] || 0) || null,
      remote: true,
    };
    const stat = validateWeightPath(sourcePath);
    const epoch = path.basename(sourcePath).match(/epoch[_-]?(\d+)/i)?.[1] || null;
    return {
      fileName: path.basename(sourcePath),
      size: stat.size,
      sizeLabel: stat.size >= 1024 ** 2 ? `${(stat.size / 1024 ** 2).toFixed(2)} MB` : `${(stat.size / 1024).toFixed(2)} KB`,
      // Preflight must stay constant-time for multi-GB model files. The full
      // checksum is computed once, while the model is archived to MinIO.
      sha256: null,
      sha256Pending: true,
      framework: inferWeightFramework(sourcePath, model),
      taskType: model.task_type,
      epoch: epoch ? Number(epoch) : null,
    };
  }

  async function createModelVersion(body = {}, actor) {
    const modelId = body.modelId || body.model_id;
    if (!modelId) throw new Error("Select a model cluster.");
    await resourceAccess.assertIndependentAccess?.("model_clusters", modelId, actor, "write");
    const model = (await query("SELECT * FROM model_clusters WHERE id=$1 AND deleted_at IS NULL", [modelId])).rows[0];
    if (!model) throw new Error("模型簇不存在");
    const requestedStage = String(body.stage || "pretrained").trim().toLowerCase();
    const stage = ["pretrained", "training", "candidate", "production"].includes(requestedStage) ? requestedStage : "pretrained";
    const importSourcePath = String(body.sourcePath || body.source_path || "").trim();
    const sourcePath = isRemoteWeightPath(importSourcePath) ? await downloadRemoteWeight(importSourcePath) : importSourcePath;
    const stat = validateWeightPath(sourcePath);
    const datasetProjectId = ["", "unknown", "__unknown__"].includes(String(body.datasetProjectId || body.dataset_project_id || ""))
      ? null
      : (body.datasetProjectId || body.dataset_project_id);
    let datasetName = "unknown";
    if (datasetProjectId) {
      const dataset = (await query("SELECT id, name FROM projects WHERE id=$1 AND deleted_at IS NULL", [datasetProjectId])).rows[0];
      if (!dataset) throw new Error("训练数据不存在或已被删除");
      datasetName = dataset.name;
    }
    const params = { ...(body.params || {}), description: String(body.description || "").trim() };
    const epoch = path.basename(sourcePath).match(/epoch[_-]?(\d+)/i)?.[1];
    const defaultPrefix = `${model.name}_${datasetName}${epoch ? `_epoch${epoch}` : ""}`;
    const versionName = String(body.versionName || body.version_name || await nextModelVersionName(defaultPrefix, model.id)).trim();
    const artifactRoot = path.join(storageRoot, "runtime", "models", model.id, versionName);
    fs.mkdirSync(artifactRoot, { recursive: true });
    const version = (await query(
      `INSERT INTO model_revisions (model_id, version_name, stage, params_json, artifact_root, dataset_project_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [model.id, versionName, stage, JSON.stringify(params), artifactRoot, datasetProjectId],
    )).rows[0];
    await resourceAccess.assignOwner("model_revisions", version.id, actor);
    if (sourcePath) {
      const ext = path.extname(sourcePath).toLowerCase() || ".pt";
      const objectKey = `ml/artifacts/models/${model.id}/${version.id}/weights${ext}`;
      const manifestKey = modelWeightManifestKey(model.id, version.id);
      try {
      await store.putFile(objectKey, sourcePath);
      const sha = await hashFile(sourcePath).catch(() => null);
      const manifest = {
        format: "det-dashboard.model-weight.v1",
        assetType: "model_weight",
        modelId: model.id,
        modelName: model.name,
        modelVersionId: version.id,
        versionName,
        framework: inferWeightFramework(sourcePath, model),
        taskType: model.task_type,
        weightKey: objectKey,
        weightName: path.basename(objectKey),
        size: stat.size,
        sha256: sha,
        extension: ext,
        importSourcePath,
        createdAt: new Date().toISOString(),
      };
      await store.putJson(manifestKey, manifest);
      await query(
        `INSERT INTO model_files (model_version_id, artifact_type, path, size, sha256, metadata_json)
         VALUES ($1,'weights',$2,$3,$4,$5)`,
        [version.id, objectKey, stat.size, sha, JSON.stringify({ assetPolicy: "platform_minio_asset", weightKey: objectKey, manifestKey, importSourcePath, weightRole: stage === "pretrained" ? "pretrained" : "other" })],
      );
      } catch (error) {
        await store.removeObject?.(objectKey).catch(() => {});
        await store.removeObject?.(manifestKey).catch(() => {});
        await query("DELETE FROM model_revisions WHERE id=$1", [version.id]).catch(() => {});
        throw error;
      }
    }
    return version;
  }

  async function deleteModelVersion(versionId) {
    const files = await query("SELECT path, metadata_json FROM model_files WHERE model_version_id=$1", [versionId]);
    const removed = await query("DELETE FROM model_revisions WHERE id=$1 RETURNING id, model_id, version_name", [versionId]);
    if (!removed.rows[0]) throw new Error("模型版本不存在");
    for (const file of files.rows) {
      await store.removeObject?.(file.path).catch(() => {});
      if (file.metadata_json?.manifestKey) await store.removeObject?.(file.metadata_json.manifestKey).catch(() => {});
    }
    return { deleted: true, version: removed.rows[0] };
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
      `SELECT mv.*, m.name AS model_name, m.framework AS model_framework,
         m.task_type AS model_task_type, p.name AS dataset_project_name,
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

  async function streamModelArtifact(res, modelVersionId, artifactId, format = "original") {
    const params = [modelVersionId];
    let where = "ma.model_version_id=$1";
    if (artifactId) {
      params.push(artifactId);
      where += ` AND ma.id=$${params.length}`;
    } else {
      where += " AND ma.artifact_type='weights'";
    }
    const rows = await query(
      `SELECT ma.*, mv.version_name, mv.stage, mv.created_at AS model_created_at,
              m.name AS model_name, p.name AS dataset_project_name,
              tj.name AS training_job_name, tj.current_epoch AS training_current_epoch,
              tj.total_epochs AS training_total_epochs
       FROM model_files ma
       JOIN model_revisions mv ON mv.id=ma.model_version_id
       JOIN model_clusters m ON m.id=mv.model_id
       LEFT JOIN projects p ON p.id=mv.dataset_project_id
       LEFT JOIN runtime_training_jobs tj ON tj.id=mv.training_job_id
       WHERE ${where}
       ORDER BY
         CASE WHEN ma.path ILIKE '%/weights/best.pt' OR ma.path ILIKE '%\\\\weights\\\\best.pt' THEN 0 ELSE 1 END,
         ma.created_at DESC
       LIMIT 1`,
      params,
    );
    const artifact = rows.rows[0];
    if (!artifact) return sendError(res, 404, "model artifact not found");
    const meta = artifact.metadata_json || {};
    const sourceExt = path.extname(artifact.path || "").toLowerCase() || ".bin";
    const requestedFormat = String(format || "original").toLowerCase();
    const requestedExt = requestedFormat === "original" ? sourceExt : (requestedFormat.startsWith(".") ? requestedFormat : `.${requestedFormat}`);
    if (![".pt", ".pth", ".onnx", ".bin"].includes(requestedExt)) return sendError(res, 400, "unsupported model export format");
    if (requestedExt !== sourceExt) return sendError(res, 409, `当前算法适配器未提供 ${sourceExt} 到 ${requestedExt} 的转换器，请导出原始文件`);
    const ext = sourceExt;
    const sourceStem = path.basename(artifact.path || `artifact${ext}`, ext);
    const epochValue = Number(meta.epoch ?? meta.checkpointEpoch ?? artifact.training_current_epoch ?? 0) || 0;
    const weightRole = meta.weightRole || (/best/i.test(sourceStem) ? "best" : /last/i.test(sourceStem) ? "last" : sourceStem);
    const created = new Date(artifact.model_created_at || artifact.created_at || Date.now());
    const createdCode = Number.isNaN(created.getTime())
      ? dateCode()
      : created.toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const downloadPart = (value, fallback) => String(value || fallback)
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_\.]+|[_\.]+$/g, "") || fallback;
    const modelLabel = path.basename(String(artifact.model_name || "model"), path.extname(String(artifact.model_name || "")));
    const stageLabel = artifact.stage && String(artifact.stage).toLowerCase() !== String(weightRole).toLowerCase()
      ? downloadPart(artifact.stage, "model")
      : null;
    const nameParts = [
      downloadPart(modelLabel, "model"),
      artifact.dataset_project_name ? downloadPart(artifact.dataset_project_name, "dataset") : null,
      artifact.training_job_name ? downloadPart(artifact.training_job_name, "task") : null,
      epochValue > 0 ? `epoch${epochValue}` : null,
      downloadPart(weightRole, "weights"),
      stageLabel,
      createdCode,
    ].filter(Boolean);
    const fileName = `${nameParts.join("_").slice(0, 180)}${ext}`;
    const asciiFileName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const disposition = `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    const localPath = meta.localPath && fs.existsSync(meta.localPath) ? meta.localPath : store.localFallbackPath(artifact.path);
    if (fs.existsSync(localPath)) {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": disposition,
      });
      fs.createReadStream(localPath).pipe(res);
      return;
    }
    const stream = await store.getStream(artifact.path);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": disposition,
    });
    stream.pipe(res);
  }

  return {
    listMlModels,
    createMlModel,
    nextModelVersionName,
    inspectModelWeight,
    createModelVersion,
    deleteModelVersion,
    renameModelVersion,
    listModelVersions,
    findWeightArtifact,
    streamModelArtifact,
  };
}

module.exports = { createModelService };
