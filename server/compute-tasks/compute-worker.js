"use strict";

function createComputeWorker({
  query, transaction, fs, path, storageRoot, store, writeObjectToFile,
  pythonEnvService, modelService, algorithmRuntimeSource, runChildProcess,
  videoFrameExecutor,
  processRef = process, logger = console, clock,
}) {
  async function claim(workerId) {
    return transaction(async (client) => {
      const task = (await client.query(
        `SELECT * FROM compute_tasks WHERE status='pending'
         ORDER BY priority, created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      )).rows[0];
      if (!task) return null;
      return (await client.query(
        `UPDATE compute_tasks SET status='running', started_at=COALESCE(started_at,now()),
         progress=5, message=$1, updated_at=now() WHERE id=$2 RETURNING *`,
        [`计算节点 ${workerId} 正在准备资源`, task.id],
      )).rows[0];
    });
  }

  async function appendLog(taskId, stream, text) {
    const cleanText = String(text || "").replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
    for (const line of cleanText.split(/[\r\n]+/).filter(Boolean)) {
      await query("INSERT INTO compute_task_logs(task_id,stream,line) VALUES ($1,$2,$3)", [taskId, stream, line.slice(0, 4000)]).catch(() => {});
    }
  }

  async function materializeImages(input, taskRoot) {
    const ids = [...new Set([input.projectImageId, ...(input.imageIds || [])].filter(Boolean))];
    if (!ids.length) return [];
    const rows = (await query(
      `SELECT pi.id, pi.display_name, ia.object_key FROM project_images pi
       JOIN image_assets ia ON ia.id=pi.image_asset_id
       WHERE pi.id=ANY($1::uuid[]) AND pi.deleted_at IS NULL`, [ids],
    )).rows;
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const imageRoot = path.join(taskRoot, "images");
    fs.mkdirSync(imageRoot, { recursive: true });
    const result = [];
    for (let index = 0; index < ids.length; index += 1) {
      const row = byId.get(String(ids[index]));
      if (!row) continue;
      const ext = path.extname(row.display_name || "") || ".jpg";
      const target = path.join(imageRoot, `${String(index).padStart(8, "0")}${ext}`);
      if (!fs.existsSync(target)) await writeObjectToFile(row.object_key, target);
      result.push({
        projectImageId: row.id,
        path: target,
        frameIndex: index,
        sequenceIndex: Number(input.frameOffset || 0) + index,
        displayName: row.display_name,
        persistSuggestion: true,
      });
    }
    return result;
  }

  async function execute(task) {
    const input = typeof task.input_json === "string" ? JSON.parse(task.input_json || "{}") : (task.input_json || {});
    const taskParameters = typeof task.parameters_json === "string" ? JSON.parse(task.parameters_json || "{}") : (task.parameters_json || {});
    if (task.operation === "fixed_interval_extract") {
      if (!videoFrameExecutor) throw new Error("视频抽帧执行器未配置");
      const output = await videoFrameExecutor.executeFixedInterval(task, appendLog);
      await query(
        `UPDATE compute_tasks SET status='done',progress=100,output_json=$1,message='固定间隔抽帧完成',
         process_pid=NULL,finished_at=now(),updated_at=now() WHERE id=$2`, [output, task.id],
      );
      return;
    }
    const algorithm = task.adapter_id ? (await query("SELECT * FROM algorithm_assets WHERE id=$1 AND deleted_at IS NULL", [task.adapter_id])).rows[0] : null;
    if (!algorithm) throw new Error("计算任务缺少可用算法资产");
    const environment = task.environment_asset_id ? (await query("SELECT * FROM runtime_envs WHERE id=$1", [task.environment_asset_id])).rows[0] : null;
    if (!environment) throw new Error("计算任务缺少 Python 环境资产");
    const env = await pythonEnvService.resolveRuntimePythonEnv(environment);
    if (!env.python_path || !fs.existsSync(env.python_path)) throw new Error(`Python 环境不可用: ${env.python_path || "未配置"}`);

    const taskRoot = path.join(storageRoot, "runtime", "compute", task.id);
    fs.mkdirSync(taskRoot, { recursive: true });
    const source = await algorithmRuntimeSource.resolveTrainingAlgorithmSource({ algorithmAssetId: algorithm.id, algorithmKey: algorithm.algorithm_key });
    const adapterPath = path.join(taskRoot, "adapter.py");
    if (algorithm.adapter_key) await writeObjectToFile(algorithm.adapter_key, adapterPath);
    if (!fs.existsSync(adapterPath)) throw new Error("算法资产缺少 adapter.py");
    let images = await materializeImages(input, taskRoot);
    let supplemental = { images, cleanup: null, supplementalFrameIndices: [] };
    if (Number(input.supplementCount || 0) > 0) {
      if (!videoFrameExecutor) throw new Error("视频补帧执行器未配置");
      supplemental = await videoFrameExecutor.supplementSequence(task, input, images, env.python_path, appendLog);
      images = supplemental.images;
    }
    const modelPath = task.model_asset_id ? await modelService.findWeightArtifact(task.model_asset_id) : "";
    const modelRevision = task.model_asset_id
      ? (await query("SELECT params_json FROM model_revisions WHERE id=$1", [task.model_asset_id])).rows[0]
      : null;
    const modelParameters = typeof modelRevision?.params_json === "string"
      ? JSON.parse(modelRevision.params_json || "{}")
      : (modelRevision?.params_json || {});
    const parameters = { ...modelParameters, ...taskParameters };
    const requestPath = path.join(taskRoot, "request.json");
    const outputPath = path.join(taskRoot, "result.json");
    fs.writeFileSync(requestPath, JSON.stringify({
      protocol: "det-dashboard.compute.v1", taskId: task.id, purpose: task.purpose,
      operation: task.operation, input: { ...input, images, supplementalFrameIndices: supplemental.supplementalFrameIndices || [] }, parameters,
      assets: { algorithmRoot: source?.cacheRoot || "", modelPath, outputPath },
    }, null, 2), "utf8");
    await query("UPDATE compute_tasks SET progress=20,message='算法资源已就绪',updated_at=now() WHERE id=$1", [task.id]);
    const beforeRun = (await query("SELECT status FROM compute_tasks WHERE id=$1", [task.id])).rows[0];
    if (beforeRun?.status !== "running") return;
    let lastAdapterProgress = 20;
    let lastProgressUpdateAt = 0;
    const reportAdapterProgress = (text) => {
      const matches = [...String(text || "").matchAll(/propagate in video:\s*(\d{1,3})%/gi)];
      if (!matches.length) return;
      const algorithmPercent = Math.max(0, Math.min(100, Number(matches.at(-1)[1])));
      const progress = Math.min(95, 20 + Math.round(algorithmPercent * 0.75));
      const now = Date.now();
      if (progress <= lastAdapterProgress || (progress < 95 && now - lastProgressUpdateAt < 350)) return;
      lastAdapterProgress = progress;
      lastProgressUpdateAt = now;
      query(
        "UPDATE compute_tasks SET progress=$1,message=$2,updated_at=now() WHERE id=$3 AND status='running'",
        [progress, `向后跟踪 ${algorithmPercent}%`, task.id],
      ).catch(() => {});
    };
    const handleOutput = (stream, text) => {
      reportAdapterProgress(text);
      return appendLog(task.id, stream, text);
    };
    try {
      await runChildProcess(env.python_path, [adapterPath, "--det-dashboard-task", requestPath, "--output", outputPath], {
        cwd: source?.cacheRoot || taskRoot,
        env: { ...processRef.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", PYTHONPATH: [source?.cacheRoot, processRef.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
        onSpawn: (child) => query("UPDATE compute_tasks SET process_pid=$1 WHERE id=$2", [child.pid || null, task.id]).catch(() => {}),
        onStdout: (text) => handleOutput("stdout", text),
        onStderr: (text) => handleOutput("stderr", text),
      });
    } finally {
      for (const cleanupPath of supplemental.cleanup || []) fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
    const afterRun = (await query("SELECT status FROM compute_tasks WHERE id=$1", [task.id])).rows[0];
    if (afterRun?.status !== "running") return;
    if (!fs.existsSync(outputPath)) throw new Error("算法适配器没有生成 result.json");
    const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (supplemental.supplementalFrameIndices?.length) {
      output.supplementalFrameIndices = supplemental.supplementalFrameIndices;
      output.supplementalCount = supplemental.supplementalFrameIndices.length;
    }
    await transaction(async (client) => {
      const sessionId = input.annotationSessionId;
      if (sessionId && Array.isArray(output.suggestions)) {
        await client.query("DELETE FROM annotation_suggestions WHERE compute_task_id=$1", [task.id]);
        for (const suggestion of output.suggestions) {
          await client.query(
            `INSERT INTO annotation_suggestions
             (session_id,compute_task_id,project_image_id,track_id,revision,frame_index,label,shape_type,geometry_json,score,source,status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'suggested')`,
            [sessionId, task.id, suggestion.projectImageId, suggestion.trackId || "", suggestion.revision || 1,
              suggestion.frameIndex ?? null, suggestion.label || "unknown", suggestion.shapeType || "rectangle",
              suggestion.geometry || {}, suggestion.score ?? null, algorithm.algorithm_key],
          );
        }
      }
      await client.query(
        `UPDATE compute_tasks SET status='done',progress=100,output_json=$1,message='计算完成',
         process_pid=NULL,finished_at=now(),updated_at=now() WHERE id=$2`, [output, task.id],
      );
      if (task.adapter_id && task.model_asset_id && task.environment_asset_id) {
        const model = (await client.query("SELECT model_id FROM model_revisions WHERE id=$1", [task.model_asset_id])).rows[0];
        await client.query(
          `INSERT INTO runtime_asset_links
           (algorithm_asset_id,model_id,model_version_id,python_env_id,dataset_project_id,last_success_job_id,success_count,last_metrics_json,last_success_at)
           VALUES ($1,$2,$3,$4,$5,$6,1,$7,now())
           ON CONFLICT (
             COALESCE(algorithm_asset_id,'00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE(model_version_id,'00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE(python_env_id,'00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE(dataset_project_id,'00000000-0000-0000-0000-000000000000'::uuid)
           ) DO UPDATE SET success_count=runtime_asset_links.success_count+1,last_success_job_id=EXCLUDED.last_success_job_id,
             last_metrics_json=EXCLUDED.last_metrics_json,last_success_at=now()`,
          [task.adapter_id, model?.model_id || null, task.model_asset_id, task.environment_asset_id,
            input.projectId || null, task.id, { purpose: task.purpose, operation: task.operation, suggestionCount: output.suggestions?.length || 0 }],
        ).catch(() => {});
      }
    });
  }

  function startComputeWorker() {
    if (String(processRef.env.COMPUTE_WORKER_ENABLED || "true").toLowerCase() === "false") return null;
    const workerId = `local-compute-${processRef.pid}`;
    const recovery = query(
      "UPDATE compute_tasks SET status='pending',process_pid=NULL,message='服务重启，任务返回队列',updated_at=now() WHERE status='running' AND finished_at IS NULL",
    ).catch((error) => logger.error("compute task recovery failed", error));
    let busy = false;
    let stopped = false;
    let active = Promise.resolve();
    const tick = async () => {
      if (stopped || busy) return active;
      busy = true;
      active = (async () => {
        let task = null;
        try {
          await recovery;
          task = await claim(workerId);
          if (task) await execute(task);
        } catch (error) {
          logger.error("compute worker error", error);
          if (task?.id) {
            await appendLog(task.id, "stderr", error.stack || error.message);
            const current = (await query("SELECT status FROM compute_tasks WHERE id=$1", [task.id]).catch(() => ({ rows: [] }))).rows[0];
            if (!["paused", "cancelled"].includes(current?.status)) {
              await query("UPDATE compute_tasks SET status='failed',message=$1,process_pid=NULL,finished_at=now(),updated_at=now() WHERE id=$2", ["计算失败，请查看任务日志", task.id]).catch(() => {});
            }
          }
        } finally { busy = false; }
      })();
      return active;
    };
    const interval = clock.setInterval(tick, Number(processRef.env.COMPUTE_WORKER_INTERVAL_MS || 1200));
    const initial = clock.setTimeout(tick, 400);
    return { async stop() { stopped = true; clock.clearInterval(interval); clock.clearTimeout(initial); await active; } };
  }

  return { execute, startComputeWorker };
}

module.exports = { createComputeWorker };
