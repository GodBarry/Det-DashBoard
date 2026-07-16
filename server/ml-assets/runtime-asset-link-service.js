function createRuntimeAssetLinkService({ query, scopeSql }) {
  async function recordSuccess(job, metrics = {}) {
    const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
    const algorithmAssetId = params.algorithmAssetId || params.templateId || null;
    const pythonEnvId = params.pythonEnvId || params.python_env_id || null;
    const modelVersionId = job.model_version_id || null;
    const datasetProjectId = job.dataset_project_id || null;
    let modelId = params.modelId || null;
    if (!modelId && modelVersionId) {
      modelId = (await query("SELECT model_id FROM model_revisions WHERE id=$1", [modelVersionId])).rows[0]?.model_id || null;
    }
    const existing = (await query(
      `SELECT id FROM runtime_asset_links
       WHERE algorithm_asset_id IS NOT DISTINCT FROM $1
         AND model_version_id IS NOT DISTINCT FROM $2
         AND python_env_id IS NOT DISTINCT FROM $3
         AND dataset_project_id IS NOT DISTINCT FROM $4
       LIMIT 1`,
      [algorithmAssetId, modelVersionId, pythonEnvId, datasetProjectId],
    )).rows[0];
    if (existing) {
      await query(
        `UPDATE runtime_asset_links
         SET model_id=$1, last_success_job_id=$2, success_count=success_count+1,
             last_metrics_json=$3, last_success_at=now()
         WHERE id=$4`,
        [modelId, job.id, JSON.stringify(metrics || {}), existing.id],
      );
      return;
    }
    await query(
      `INSERT INTO runtime_asset_links
       (algorithm_asset_id, model_id, model_version_id, python_env_id, dataset_project_id, last_success_job_id, success_count, last_metrics_json, last_success_at)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7,now())`,
      [algorithmAssetId, modelId, modelVersionId, pythonEnvId, datasetProjectId, job.id, JSON.stringify(metrics || {})],
    );
  }

  async function backfillInferenceSuccesses() {
    const rows = (await query(
      `SELECT * FROM runtime_inference_jobs
       WHERE status IN ('done','completed','succeeded','success')
       ORDER BY finished_at DESC NULLS LAST
       LIMIT 100`,
    )).rows;
    for (const job of rows) {
      const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
      if (!(params.algorithmAssetId || params.templateId) || !params.pythonEnvId || !job.model_version_id) continue;
      const existing = (await query(
        `SELECT id FROM runtime_asset_links
         WHERE algorithm_asset_id IS NOT DISTINCT FROM $1
           AND model_version_id IS NOT DISTINCT FROM $2
           AND python_env_id IS NOT DISTINCT FROM $3
           AND dataset_project_id IS NOT DISTINCT FROM $4
         LIMIT 1`,
        [params.algorithmAssetId || params.templateId || null, job.model_version_id || null, params.pythonEnvId || null, job.dataset_project_id || null],
      )).rows[0];
      if (existing) continue;
      const metrics = params?.output?.metrics || {};
      await recordSuccess(job, metrics).catch(() => {});
    }
  }

  async function listLinks(actor, scope = "mine") {
    try {
      await backfillInferenceSuccesses();
      let scopedParams = [];
      const scopeConditions = [];
      for (const [table, alias] of [["algorithm_assets", "aa"], ["model_clusters", "mc"], ["runtime_envs", "re"], ["projects", "p"]]) {
        const scoped = scopeSql({ table, alias, actor, scope, params: scopedParams });
        scopedParams = scoped.params;
        scopeConditions.push(`(${alias}.id IS NOT NULL AND ${scoped.sql})`);
      }
      const rows = await query(
        `SELECT ral.*,
          aa.name AS algorithm_name, aa.algorithm_key, aa.version AS algorithm_version,
          mc.name AS model_name, mc.framework AS model_algorithm_name,
          mv.version_name, mv.stage AS model_stage, mv.created_at AS model_created_at,
          re.name AS python_env_name, re.python_version, re.torch_version, re.cuda_version, re.cuda_available, re.accelerator, re.created_at AS python_env_created_at,
          p.name AS dataset_project_name,
          ij.name AS last_success_job_name
         FROM runtime_asset_links ral
         LEFT JOIN algorithm_assets aa ON aa.id=ral.algorithm_asset_id
         LEFT JOIN model_clusters mc ON mc.id=ral.model_id
         LEFT JOIN model_revisions mv ON mv.id=ral.model_version_id
         LEFT JOIN runtime_envs re ON re.id=ral.python_env_id
         LEFT JOIN projects p ON p.id=ral.dataset_project_id
         LEFT JOIN runtime_inference_jobs ij ON ij.id=ral.last_success_job_id
         WHERE ${scopeConditions.join(" OR ")}
         ORDER BY ral.last_success_at DESC NULLS LAST, ral.success_count DESC
         LIMIT 200`,
        scopedParams,
      );
      return rows.rows;
    } catch (error) {
      if (!["42P01", "XX002"].includes(error.code)) throw error;
      return [];
    }
  }

  return { recordSuccess, backfillInferenceSuccesses, listLinks };
}

module.exports = { createRuntimeAssetLinkService };
