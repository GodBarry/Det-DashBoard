function createRuntimeJobService({
  query,
  scopedSql,
  httpError,
  evaluateDetections,
  normalizeTrainingDatasetSplits,
}) {
  async function presentTrainingJobs(jobs) {
    const selections = jobs.map((job) => normalizeTrainingDatasetSplits({}, job.params_json || {}, job.dataset_project_id));
    const ids = [...new Set(selections.flatMap((item) => [...item.trainProjectIds, ...item.valProjectIds, ...item.testProjectIds]))];
    const projects = ids.length ? (await query("SELECT id, name FROM projects WHERE id=ANY($1::uuid[])", [ids])).rows : [];
    const names = new Map(projects.map((project) => [String(project.id), project.name]));
    return jobs.map((job, index) => {
      const splits = selections[index];
      const params = job.params_json || {};
      const projectNames = (projectIds) => projectIds.map((id) => names.get(String(id)) || id);
      return {
        ...job,
        ...splits,
        trainProjectNames: projectNames(splits.trainProjectIds),
        valProjectNames: projectNames(splits.valProjectIds),
        testProjectNames: projectNames(splits.testProjectIds),
        dataset_project_name: projectNames(splits.trainProjectIds).join(", ") || job.dataset_project_name,
        initializationStrategy: params.initializationStrategy || job.initialization_strategy || "random",
        initialModelVersionId: params.initialModelVersionId || job.initial_model_version_id || null,
        resume: Boolean(params.resume ?? job.resume_from_checkpoint),
      };
    });
  }

  async function listTrainingJobs(actor, scope = "mine") {
    try {
      const scoped = scopedSql("runtime_training_jobs", "tj", actor, scope);
      const rows = await query(
        `SELECT tj.*, p.name AS dataset_project_name, m.name AS model_name, ds.name AS dataset_snapshot_name
         FROM runtime_training_jobs tj
         LEFT JOIN projects p ON p.id=tj.dataset_project_id
         LEFT JOIN model_clusters m ON m.id=tj.model_id
         LEFT JOIN dataset_snapshots ds ON ds.id=tj.dataset_snapshot_id
         WHERE ${scoped.sql}
         ORDER BY tj.priority DESC, tj.created_at DESC, tj.id DESC
         LIMIT 200`,
        scoped.params,
      );
      return presentTrainingJobs(rows.rows);
    } catch (error) {
      if (!["42P01", "XX002"].includes(error.code)) throw error;
      return [];
    }
  }

  async function listInferenceJobs(actor, scope = "mine") {
    try {
      const scoped = scopedSql("runtime_inference_jobs", "ij", actor, scope);
      const rows = await query(
        `SELECT ij.*, mv.version_name, m.name AS model_name, p.name AS dataset_project_name
         FROM runtime_inference_jobs ij
         LEFT JOIN model_revisions mv ON mv.id=ij.model_version_id
         LEFT JOIN model_clusters m ON m.id=mv.model_id
         LEFT JOIN projects p ON p.id=ij.dataset_project_id
         WHERE ${scoped.sql}
         ORDER BY ij.priority DESC, ij.created_at DESC, ij.id DESC
         LIMIT 200`,
        scoped.params,
      );
      return rows.rows.map((row) => {
        const params = typeof row.params_json === "string" ? JSON.parse(row.params_json || "{}") : (row.params_json || {});
        const storedMetrics = typeof row.metrics_json === "string" ? JSON.parse(row.metrics_json || "{}") : (row.metrics_json || {});
        const outputMetrics = params?.output?.metrics || {};
        const metrics = Object.keys(storedMetrics || {}).length ? storedMetrics : outputMetrics;
        return {
          ...row,
          metrics_json: metrics,
          image_count: Number(metrics.images || params?.output?.resultCount || 0) || null,
          prediction_count: Number(metrics.predictions || params?.output?.predictionCount || 0) || null,
          algorithm_asset_id: params.algorithmAssetId || params.templateId || null,
          algorithm_name: params.templateName || params.algorithmKey || "",
          python_env_id: params.pythonEnvId || null,
        };
      });
    } catch (error) {
      if (!["42P01", "XX002"].includes(error.code)) throw error;
      return [];
    }
  }

  async function listInferenceResults(jobId) {
    const rows = await query(
      `SELECT ir.*, pi.id AS project_image_id, pi.display_name, pi.scene, pi.view, pi.modality,
              ia.width AS image_width, ia.height AS image_height
       FROM runtime_inference_results ir
       LEFT JOIN project_images pi ON pi.id=ir.project_image_id
       LEFT JOIN image_assets ia ON ia.id=pi.image_asset_id
       WHERE ir.inference_job_id=$1
       ORDER BY ir.created_at, ir.id
       LIMIT 500`,
      [jobId],
    );
    return rows.rows.map((row) => ({
      ...row,
      thumb_url: row.project_image_id ? `/api/project-images/${row.project_image_id}/thumb` : "",
      image_url: row.project_image_id ? `/api/project-images/${row.project_image_id}` : "",
    }));
  }

  async function getInferenceEvaluation(jobId) {
    const job = (await query("SELECT * FROM runtime_inference_jobs WHERE id=$1", [jobId])).rows[0];
    if (!job) throw httpError(404, "inference job not found");
    const resultRows = await listInferenceResults(jobId);
    const predictionRows = resultRows.map((row) => ({
      projectImageId: row.project_image_id,
      predictions: Array.isArray(row.predictions_json) ? row.predictions_json : [],
    }));
    const imageIds = predictionRows.map((row) => row.projectImageId).filter(Boolean);
    const project = job.dataset_project_id
      ? (await query("SELECT id, active_label_version_id FROM projects WHERE id=$1", [job.dataset_project_id])).rows[0]
      : null;
    let groundTruthRows = [];
    if (project?.active_label_version_id && imageIds.length) {
      groundTruthRows = (await query(
        "SELECT project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h FROM image_annotations WHERE label_version_id=$1 AND project_image_id = ANY($2::uuid[])",
        [project.active_label_version_id, imageIds],
      )).rows;
    }
    const labeledImageIds = new Set(groundTruthRows.map((row) => String(row.project_image_id)));
    const evaluationRows = predictionRows.filter((row) => labeledImageIds.has(String(row.projectImageId)));
    const evaluation = evaluateDetections({ predictionRows: evaluationRows, groundTruthRows, iouThreshold: 0.5 });
    evaluation.summary = {
      ...(evaluation.summary || {}),
      inferenceImages: predictionRows.length,
      evaluatedImages: evaluationRows.length,
      skippedUnlabeledImages: predictionRows.length - evaluationRows.length,
    };
    const resultByImage = new Map(resultRows.map((row) => [row.project_image_id, row]));
    return {
      ...evaluation,
      jobId,
      labelVersionId: project?.active_label_version_id || null,
      reason: groundTruthRows.length
        ? "仅对存在真值标注的图片进行评估；未标注图片的推理结果仍已保存"
        : "推理结果已保存，但当前数据集没有可用于评估的活动标签版本或标注",
      errors: evaluation.errors.map((row) => {
        const source = resultByImage.get(row.projectImageId) || {};
        return {
          ...row,
          display_name: source.display_name || source.project_image_id || "图片结果",
          thumb_url: source.thumb_url || "",
          image_url: source.image_url || "",
          predictions_json: source.predictions_json || [],
          image_width: source.image_width || 0,
          image_height: source.image_height || 0,
        };
      }),
    };
  }

  async function deleteInferenceJob(jobId) {
    const deleted = await query("DELETE FROM runtime_inference_jobs WHERE id=$1 RETURNING id", [jobId]);
    if (!deleted.rows[0]) throw new Error("推理任务不存在");
    return { deleted: true, id: deleted.rows[0].id };
  }

  async function requeueInferenceJob(jobId) {
    const job = (await query("SELECT * FROM runtime_inference_jobs WHERE id=$1", [jobId])).rows[0];
    if (!job) throw new Error("推理任务不存在");
    const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
    const updated = (await query(
      `UPDATE runtime_inference_jobs
       SET status='pending', progress=0, metrics_json='{}'::jsonb, message=$1,
           started_at=NULL, finished_at=NULL,
           created_at=now(), priority=(SELECT COALESCE(MAX(priority), 0) + 1 FROM runtime_inference_jobs)
       WHERE id=$2 RETURNING *`,
      ["推理任务已重新排队，等待 worker 接管", jobId],
    )).rows[0];
    return { ...updated, params_json: params };
  }

  return {
    presentTrainingJobs,
    listTrainingJobs,
    listInferenceJobs,
    listInferenceResults,
    getInferenceEvaluation,
    deleteInferenceJob,
    requeueInferenceJob,
  };
}

module.exports = { createRuntimeJobService };
