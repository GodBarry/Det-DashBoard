"use strict";

function minuteCode(date = new Date()) {
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
  return parts.map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0")).join("");
}

function inferenceJobName(taskName, datasetName, fallbackName = "inference", now = new Date()) {
  const normalize = (value) => String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return [
    normalize(taskName) || normalize(fallbackName),
    normalize(datasetName) || "dataset",
    minuteCode(now),
  ].join("_");
}

function createInferenceSubmissionService(deps) {
  const {
    query,
    resourceAccess,
    algorithmAssetService,
    prepareInferenceInputCache,
    fs,
    path,
    storageRoot,
    schedule = setImmediate,
    now = () => new Date(),
    logger = console,
  } = deps;

  async function createInferenceJob(body = {}, actor) {
    const datasetProjectId = body.datasetProjectId || body.dataset_project_id || null;
    if (datasetProjectId) await resourceAccess.assertProjectRead(actor, datasetProjectId);
    if (!datasetProjectId) throw new Error("请选择推理数据集项目");

    const project = (await query(
      "SELECT id, name FROM projects WHERE id=$1 AND deleted_at IS NULL",
      [datasetProjectId],
    )).rows[0];
    if (!project) throw new Error("推理数据集项目不存在");

    const modelVersionId = body.modelVersionId || body.model_version_id || null;
    let modelFramework = "";
    if (modelVersionId) {
      await resourceAccess.assertIndependentAccess("model_revisions", modelVersionId, actor, "read");
      const version = (await query(
        `SELECT mv.id, mc.framework
         FROM model_revisions mv
         LEFT JOIN model_clusters mc ON mc.id=mv.model_id
         WHERE mv.id=$1`,
        [modelVersionId],
      )).rows[0];
      if (!version) throw new Error("模型版本不存在");
      modelFramework = String(version.framework || "").toLowerCase();
    }

    const params = { ...(body.params || {}) };
    const requestedAlgorithmAssetId = body.algorithmAssetId
      || body.algorithm_asset_id
      || params.algorithmAssetId
      || params.templateId
      || null;
    const algorithmScopes = await Promise.all(
      ["mine", "shared", "public"].map((scope) => algorithmAssetService.listAlgorithmAssets(actor, scope)),
    );
    const algorithms = [...new Map(
      algorithmScopes.flat().map((item) => [String(item.id), item]),
    ).values()];
    const algorithm = requestedAlgorithmAssetId
      ? algorithms.find((item) => String(item.id) === String(requestedAlgorithmAssetId)
        || item.algorithm_key === requestedAlgorithmAssetId
        || item.template_key === requestedAlgorithmAssetId)
      : algorithms.find((item) => modelFramework && String(item.framework || "").toLowerCase() === modelFramework)
        || algorithms.find((item) => item.algorithm_key === "dummy_empty_detector")
        || algorithms[0];
    if (!algorithm) {
      throw new Error(requestedAlgorithmAssetId
        ? "算法资产不存在"
        : "请选择算法名称：推理任务必须绑定一个算法资产");
    }

    params.algorithmAssetId = algorithm.id;
    params.templateId = algorithm.id;
    params.algorithmKey = algorithm.algorithm_key || algorithm.template_key;
    params.templateKey = algorithm.algorithm_key || algorithm.template_key;
    params.templateName = algorithm.name;
    params.manifestKey = algorithm.manifest_key;
    params.adapterKey = algorithm.adapter_key;
    params.algorithmMinioPrefix = algorithm.minio_prefix;

    const name = inferenceJobName(body.name, project.name, algorithm.name || algorithm.algorithm_key, now());
    const inserted = await query(
      `INSERT INTO runtime_inference_jobs (name, model_version_id, dataset_project_id, status, params_json, message, priority)
       VALUES ($1,$2,$3,'preparing',$4,$5,(SELECT COALESCE(MAX(priority), 0) + 1 FROM runtime_inference_jobs)) RETURNING *`,
      [name, modelVersionId, datasetProjectId, JSON.stringify(params), "正在准备推理输入缓存"],
    );
    const job = inserted.rows[0];
    await resourceAccess.assignOwner("runtime_inference_jobs", job.id, actor);

    const outputRoot = path.join(storageRoot, "runtime", "inference", job.id);
    fs.mkdirSync(outputRoot, { recursive: true });
    const updated = await query(
      "UPDATE runtime_inference_jobs SET output_root=$1 WHERE id=$2 RETURNING *",
      [outputRoot, job.id],
    );
    schedule(() => {
      prepareInferenceInputCache(updated.rows[0]).catch(async (error) => {
        logger.error("prepare inference input failed", error);
        await query(
          "UPDATE runtime_inference_jobs SET status='failed', message=$1, finished_at=now() WHERE id=$2",
          [error.message || "推理输入缓存准备失败", job.id],
        ).catch(() => {});
      });
    });
    return updated.rows[0];
  }

  return { createInferenceJob };
}

module.exports = {
  createInferenceSubmissionService,
  inferenceJobName,
  minuteCode,
};
