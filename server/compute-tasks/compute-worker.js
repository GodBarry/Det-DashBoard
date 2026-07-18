"use strict";

function createComputeWorker({
  query, transaction, fs, path, storageRoot, store, writeObjectToFile,
  pythonEnvService, modelService, algorithmRuntimeSource, runChildProcess,
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
    for (const line of String(text || "").split(/\r?\n/).filter(Boolean)) {
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
      result.push({ projectImageId: row.id, path: target, frameIndex: index, displayName: row.display_name });
    }
    return result;
  }

  async function execute(task) {
    const input = typeof task.input_json === "string" ? JSON.parse(task.input_json || "{}") : (task.input_json || {});
    const taskParameters = typeof task.parameters_json === "string" ? JSON.parse(task.parameters_json || "{}") : (task.parameters_json || {});
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
    const images = await materializeImages(input, taskRoot);
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
      operation: task.operation, input: { ...input, images }, parameters,
      assets: { algorithmRoot: source?.cacheRoot || "", modelPath, outputPath },
    }, null, 2), "utf8");
    await query("UPDATE compute_tasks SET progress=20,message='算法资源已就绪',updated_at=now() WHERE id=$1", [task.id]);
    const beforeRun = (await query("SELECT status FROM compute_tasks WHERE id=$1", [task.id])).rows[0];
    if (beforeRun?.status !== "running") return;
    await runChildProcess(env.python_path, [adapterPath, "--det-dashboard-task", requestPath, "--output", outputPath], {
      cwd: source?.cacheRoot || taskRoot,
      env: { ...processRef.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", PYTHONPATH: [source?.cacheRoot, processRef.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
      onSpawn: (child) => query("UPDATE compute_tasks SET process_pid=$1 WHERE id=$2", [child.pid || null, task.id]).catch(() => {}),
      onStdout: (text) => appendLog(task.id, "stdout", text),
      onStderr: (text) => appendLog(task.id, "stderr", text),
    });
    const afterRun = (await query("SELECT status FROM compute_tasks WHERE id=$1", [task.id])).rows[0];
    if (afterRun?.status !== "running") return;
    if (!fs.existsSync(outputPath)) throw new Error("算法适配器没有生成 result.json");
    const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
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
