function createRuntimeJobService({
  query,
  scopedSql,
  httpError,
  evaluateDetections,
  normalizeTrainingDatasetSplits,
  normalizeTrainingDatasetFilters,
  resourceAccess,
  pythonEnvService,
  storageRoot,
  fs,
  path,
  stopProcess,
  appendTrainingLog,
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

  async function normalizeTrainingInitialization(body, params, actor) {
    const versionId = body.initialModelVersionId || body.initial_model_version_id || params.initialModelVersionId || null;
    const strategy = String(body.initializationStrategy || body.initialization_strategy || params.initializationStrategy || (versionId ? "pretrained" : "random")).toLowerCase();
    if (!["random", "zero", "pretrained", "training"].includes(strategy)) throw new Error(`Unsupported initialization strategy: ${strategy}`);
    const resume = Boolean(body.resume ?? params.resume ?? false);
    if (["pretrained", "training"].includes(strategy) && !versionId) throw new Error(`${strategy} initialization requires a model version`);
    if (["random", "zero"].includes(strategy) && versionId) throw new Error(`${strategy} initialization cannot reference a model version`);
    if (resume && strategy !== "training") throw new Error("Resume is only supported for a previous training checkpoint");
    let checkpoint = null;
    if (versionId) {
      await resourceAccess.assertIndependentAccess("model_revisions", versionId, actor, "read");
      const row = (await query(
        `SELECT mv.*, mc.name AS model_name, mc.framework,
           (SELECT jsonb_build_object('id', mf.id, 'path', mf.path, 'sha256', mf.sha256, 'size', mf.size, 'metadata', mf.metadata_json)
            FROM model_files mf WHERE mf.model_version_id=mv.id
            ORDER BY CASE WHEN $2::text='training' AND mf.metadata_json->>'weightRole'='last' THEN 0 WHEN mf.metadata_json->>'weightRole'='best' THEN 1 WHEN mf.metadata_json->>'weightRole'='pretrained' THEN 2 ELSE 3 END, mf.created_at DESC LIMIT 1) AS checkpoint
         FROM model_revisions mv JOIN model_clusters mc ON mc.id=mv.model_id
         WHERE mv.id=$1 AND mc.deleted_at IS NULL`,
        [versionId, strategy],
      )).rows[0];
      if (!row || !row.checkpoint) throw new Error("Selected initialization model has no available checkpoint");
      checkpoint = { ...row.checkpoint, versionId: row.id, versionName: row.version_name, modelName: row.model_name, stage: row.stage, framework: row.framework };
    }
    return { strategy, versionId, resume, checkpoint };
  }

  async function createTrainingJob(body = {}, actor) {
    const params = { ...(body.params || {}) };
    const datasetSplits = normalizeTrainingDatasetSplits(body, params, body.datasetProjectId || body.dataset_project_id || null);
    const datasetProjectId = datasetSplits.trainProjectIds[0] || null;
    if (!datasetProjectId) throw new Error("请选择训练数据集项目");
    const selectedProjectIds = [...new Set([...datasetSplits.trainProjectIds, ...datasetSplits.valProjectIds, ...datasetSplits.testProjectIds])];
    await Promise.all(selectedProjectIds.map((projectId) => resourceAccess.assertProjectRead(actor, projectId)));
    const projects = (await query("SELECT id, name FROM projects WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL", [selectedProjectIds])).rows;
    if (projects.length !== selectedProjectIds.length) throw new Error("One or more selected dataset projects do not exist");
    const projectById = new Map(projects.map((item) => [String(item.id), item]));
    const project = projectById.get(String(datasetProjectId));
    if (!project) throw new Error("训练数据集项目不存在");
    const modelId = body.modelId || body.model_id || null;
    if (modelId) {
      await resourceAccess.assertIndependentAccess("model_clusters", modelId, actor, "read");
      const model = (await query("SELECT id FROM model_clusters WHERE id=$1 AND deleted_at IS NULL", [modelId])).rows[0];
      if (!model) throw new Error("模型不存在");
    }
    if (body.templateId || body.template_id) {
      const templateId = body.templateId || body.template_id;
      const template = (await query("SELECT * FROM training_templates WHERE id=$1", [templateId])).rows[0];
      const algorithm = template ? null : (await query("SELECT * FROM algorithm_assets WHERE id=$1 AND deleted_at IS NULL", [templateId])).rows[0];
      const selected = template || algorithm;
      if (selected) await resourceAccess.assertIndependentAccess(template ? "training_templates" : "algorithm_assets", templateId, actor, "read");
      if (!selected) throw new Error("训练算法适配器不存在");
      Object.assign(params, selected.default_params_json || {}, params);
      const requestedTask = String(body.taskType || body.task_type || params.taskType || selected.task_type || "detect");
      const supportedTasks = selected.capabilities_json?.tasks || [selected.task_type || "detect"];
      if (!supportedTasks.includes(requestedTask)) throw new Error(`训练算法适配器不支持 ${requestedTask} 任务`);
      params.templateId = template?.id || null;
      params.algorithmAssetId = algorithm?.id || null;
      params.templateKey = template?.template_key || algorithm?.algorithm_key;
      params.algorithmKey = template?.template_key || algorithm?.algorithm_key;
      params.taskType = requestedTask;
    }
    if (body.pythonEnvId || body.python_env_id) {
      await resourceAccess.assertIndependentAccess("runtime_envs", body.pythonEnvId || body.python_env_id, actor, "read");
      let env = (await query("SELECT * FROM runtime_envs WHERE id=$1", [body.pythonEnvId || body.python_env_id])).rows[0];
      if (!env) throw new Error("Python 环境不存在");
      env = await pythonEnvService.resolveRuntimePythonEnv(env);
      params.pythonEnvId = env.id;
      params.python = env.python_path;
    }
    const initialization = await normalizeTrainingInitialization(body, params, actor);
    params.initializationStrategy = initialization.strategy;
    params.initialModelVersionId = initialization.versionId;
    params.resume = initialization.resume;
    params.checkpointMetadata = initialization.checkpoint;
    params.datasetSplits = datasetSplits;
    params.datasetFilters = normalizeTrainingDatasetFilters(body, params);
    params.trainProjectIds = datasetSplits.trainProjectIds;
    params.valProjectIds = datasetSplits.valProjectIds;
    params.testProjectIds = datasetSplits.testProjectIds;
    params.save_period = Number(body.savePeriod ?? body.save_period ?? params.save_period ?? -1);
    const totalEpochs = Number(params.max_epochs || params.epochs || body.totalEpochs || 0) || 0;
    const name = String(body.name || `${project.name}_train_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`).trim();
    const template = String(body.template || "ultralytics_yolo_detect");
    const inserted = await query(
      `INSERT INTO runtime_training_jobs (name, template, dataset_project_id, model_id, params_json, total_epochs, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, template, datasetProjectId, modelId, JSON.stringify(params), totalEpochs, "已进入训练队列，等待训练 worker 接管"],
    );
    const job = inserted.rows[0];
    await resourceAccess.assignOwner("runtime_training_jobs", job.id, actor);
    await query(
      `UPDATE runtime_training_jobs
       SET initial_model_version_id=$1, initialization_strategy=$2, resume_from_checkpoint=$3, save_period=$4
       WHERE id=$5`,
      [initialization.versionId, initialization.strategy, initialization.resume, params.save_period, job.id],
    );
    const outputRoot = path.join(storageRoot, "runtime", "training", job.id);
    fs.mkdirSync(outputRoot, { recursive: true });
    const updated = await query("UPDATE runtime_training_jobs SET output_root=$1 WHERE id=$2 RETURNING *", [outputRoot, job.id]);
    const datasetNames = datasetSplits.trainProjectIds.map((id) => projectById.get(String(id))?.name || id);
    await query("INSERT INTO runtime_training_logs (job_id, stream, line) VALUES ($1,$2,$3)", [job.id, "system", `queued: ${template}; datasets=${datasetNames.join(", ")}`]);
    return (await presentTrainingJobs(updated.rows))[0];
  }

  async function requeueTrainingJob(jobId, body = {}) {
    const job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [jobId])).rows[0];
    if (!job) throw new Error("训练任务不存在");
    const params = { ...(job.params_json || {}), ...(body.params || {}) };
    const totalEpochs = Number(params.epochs || job.total_epochs || 0) || 0;
    const outputRoot = path.join(storageRoot, "runtime", "training", job.id);
    fs.mkdirSync(outputRoot, { recursive: true });
    const updated = await query(
      `UPDATE runtime_training_jobs
       SET status='pending', params_json=$1, progress=0, current_epoch=0, total_epochs=$2,
           worker_id='', process_pid=NULL, heartbeat_at=NULL, started_at=NULL, finished_at=NULL,
           output_root=$3, message=$4
       WHERE id=$5 RETURNING *`,
      [JSON.stringify(params), totalEpochs, outputRoot, "已重新进入训练队列", jobId],
    );
    await appendTrainingLog(jobId, "system", "job requeued");
    return updated.rows[0];
  }

  async function pauseTrainingJob(jobId) {
    const job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [jobId])).rows[0];
    if (!job) throw new Error("训练任务不存在");
    if (["done", "failed", "cancelled"].includes(job.status)) throw new Error("已结束的训练任务不能暂停");
    if (job.status === "paused") return job;
    const stopped = stopProcess(job.process_pid);
    const updated = (await query(
      `UPDATE runtime_training_jobs
       SET status='paused', process_pid=NULL, worker_id='', heartbeat_at=now(), message=$1
       WHERE id=$2 RETURNING *`,
      [stopped ? "训练任务已暂停，运行进程已停止" : "训练任务已暂停", jobId],
    )).rows[0];
    await appendTrainingLog(jobId, "system", stopped ? "job paused; process stopped" : "job paused");
    return updated;
  }

  async function resumeTrainingJob(jobId) {
    const job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [jobId])).rows[0];
    if (!job) throw new Error("训练任务不存在");
    if (job.status !== "paused") throw new Error("只有已暂停的训练任务可以继续");
    const updated = (await query(
      `UPDATE runtime_training_jobs
       SET status='pending', process_pid=NULL, worker_id='', heartbeat_at=NULL, message=$1
       WHERE id=$2 RETURNING *`,
      ["训练任务已继续，等待 worker 接管", jobId],
    )).rows[0];
    await appendTrainingLog(jobId, "system", "job resumed");
    return updated;
  }

  async function deleteTrainingJob(jobId) {
    const job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [jobId])).rows[0];
    if (!job) throw new Error("训练任务不存在");
    const stopped = stopProcess(job.process_pid);
    await appendTrainingLog(jobId, "system", stopped ? "job deleted; process stopped" : "job deleted");
    const deleted = await query("DELETE FROM runtime_training_jobs WHERE id=$1 RETURNING id", [jobId]);
    return { deleted: true, id: deleted.rows[0].id };
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
    normalizeTrainingInitialization,
    createTrainingJob,
    requeueTrainingJob,
    pauseTrainingJob,
    resumeTrainingJob,
    deleteTrainingJob,
    listInferenceJobs,
    listInferenceResults,
    getInferenceEvaluation,
    deleteInferenceJob,
    requeueInferenceJob,
  };
}

module.exports = { createRuntimeJobService };
