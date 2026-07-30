"use strict";

function createInferenceReceiverService({ query, resourceAccess, inferenceServerService, callbackUrl, callbackToken, fs, path, sharp, store, hashFile, quickHash, imageObjectKey }) {
  const receiverCallbackUrl = String(callbackUrl || "").trim();
  const receiverCallbackToken = String(callbackToken || "").trim();

  async function ensureNetworkProject(actor) {
    let project = (await query("SELECT * FROM projects WHERE name='网络接收数据' AND parent_id IS NULL AND owner_user_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1", [actor.id])).rows[0];
    if (!project) project = (await query(
      "INSERT INTO projects (name,description,project_type,owner_user_id,visibility) VALUES ('网络接收数据','由外部接口接收的无标注推理图片','network_received',$1,'private') RETURNING *",
      [actor.id],
    )).rows[0];
    return project;
  }

  async function persistIncomingImage(inputPath, receiverId) {
    if (!inputPath || !fs.existsSync(inputPath)) throw new Error("接收图片文件不存在");
    const receiver = (await query("SELECT dataset_project_id FROM runtime_inference_jobs WHERE id=$1", [receiverId])).rows[0];
    if (!receiver?.dataset_project_id) throw new Error("接收任务未绑定网络数据项目");
    const stat = fs.statSync(inputPath);
    const sha = await hashFile(inputPath);
    let asset = (await query("SELECT * FROM image_assets WHERE sha256=$1", [sha])).rows[0];
    if (!asset) {
      const meta = await sharp(inputPath).metadata().catch(() => ({}));
      const ext = path.extname(inputPath).toLowerCase() || ".png";
      const objectKey = imageObjectKey(sha, ext);
      await store.putFile(objectKey, inputPath);
      asset = (await query(
        "INSERT INTO image_assets (sha256,quick_hash,object_key,original_ext,width,height,file_size) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [sha, quickHash(inputPath), objectKey, ext, meta.width || null, meta.height || null, stat.size],
      )).rows[0];
    }
    const displayName = `post_${new Date().toISOString().replace(/[:.]/g, "-")}${path.extname(inputPath) || ".png"}`;
    return (await query(
      "INSERT INTO project_images (project_id,image_asset_id,display_name,source_path,source_size,source_mtime_ms,keyword) VALUES ($1,$2,$3,$4,$5,$6,'network-received') RETURNING *",
      [receiver.dataset_project_id, asset.id, displayName, inputPath, stat.size, Math.round(stat.mtimeMs)],
    )).rows[0];
  }

  async function start(body = {}, actor) {
    const selectedProjectId = body.datasetProjectId || body.dataset_project_id || null;
    const modelVersionId = body.modelVersionId || body.model_version_id;
    if (!modelVersionId) throw new Error("开启接收推理前请选择模型版本");
    if (!receiverCallbackUrl || !receiverCallbackToken) throw new Error("未配置 INFERENCE_CALLBACK_URL 或 INFERENCE_CALLBACK_TOKEN");
    if (selectedProjectId) await resourceAccess.assertProjectRead(actor, selectedProjectId);
    const networkProject = await ensureNetworkProject(actor);
    await resourceAccess.assertIndependentAccess("model_revisions", modelVersionId, actor, "read");
    const params = { ...(body.params || {}), receiver: true, taskType: "test", taskSource: "external_api", algorithmAssetId: body.algorithmAssetId || null };
    const created = await query(
      `INSERT INTO runtime_inference_jobs (name, model_version_id, dataset_project_id, status, params_json, progress, message, created_by_user_id)
       VALUES ($1,$2,$3,'listening',$4,0,$5,$6) RETURNING *`,
      [body.name || "外部接口推理会话", modelVersionId, networkProject.id, JSON.stringify(params), "正在监听远程推理请求", actor.id],
    );
    const job = created.rows[0];
    try {
      const server = await inferenceServerService.start({
        ...body,
        receiverId: job.id,
        callbackUrl: receiverCallbackUrl,
        callbackToken: receiverCallbackToken,
      });
      await query("UPDATE runtime_inference_jobs SET params_json=$1, message=$2 WHERE id=$3", [
        JSON.stringify({ ...params, receiver: { id: job.id, ...server } }),
        `监听中：4180 端口，模型 ${server.modelName || body.weights || ""}`,
        job.id,
      ]);
      return { ...job, ...server, receiverId: job.id };
    } catch (error) {
      await query("UPDATE runtime_inference_jobs SET status='failed', message=$1, finished_at=now() WHERE id=$2", [error.message, job.id]);
      throw error;
    }
  }

  async function stop(receiverId, actor) {
    await resourceAccess.assertInferenceJobWrite(actor, receiverId);
    const result = await inferenceServerService.stop();
    const row = await query(
      "UPDATE runtime_inference_jobs SET status='stopped', progress=100, message=$1, finished_at=now() WHERE id=$2 RETURNING *",
      ["远程接收推理已停止", receiverId],
    );
    return { job: row.rows[0], server: result };
  }

  async function recordEvent(payload = {}) {
    if (!receiverCallbackToken || payload.token !== receiverCallbackToken) throw new Error("无效的推理回调令牌");
    const receiverId = payload.receiverId;
    if (!receiverId) throw new Error("推理回调缺少 receiverId");
    const event = String(payload.event || "");
    const requestId = String(payload.requestId || "");
    if (event === "accepted") {
      if (!requestId) throw new Error("推理接收事件缺少 requestId");
      await query("UPDATE runtime_inference_jobs SET progress=20, message=$1, started_at=COALESCE(started_at,now()) WHERE id=$2", ["已接收外部图片，正在推理", receiverId]);
    } else if (event === "completed") {
      const predictions = payload.predictions || [];
      const image = await persistIncomingImage(payload.inputPath, receiverId);
      await query("INSERT INTO runtime_inference_results (inference_job_id,project_image_id,predictions_json,artifact_path) VALUES ($1,$2,$3,$4)", [receiverId, image.id, JSON.stringify(predictions), payload.artifactPath || ""]);
      await query("UPDATE runtime_inference_jobs SET status='listening', progress=0, metrics_json=COALESCE(metrics_json,'{}'::jsonb) || $1::jsonb, message=$2 WHERE id=$3", [JSON.stringify({ taskType: "test", annotated: false, lastRemoteInferenceAt: new Date().toISOString(), predictions: predictions.length }), `已保存网络接收图片并完成推理：${predictions.length} 个目标，继续监听中`, receiverId]);
    } else if (event === "failed") {
      await query("UPDATE runtime_inference_jobs SET status='listening', progress=0, message=$1 WHERE id=$2", [payload.error || "远程推理失败，继续监听中", receiverId]);
    }
    await query("INSERT INTO runtime_inference_logs (job_id,stream,line) VALUES ($1,$2,$3)", [receiverId, "remote", JSON.stringify(payload)]);
    return { ok: true };
  }

  return { recordEvent, start, stop };
}

module.exports = { createInferenceReceiverService };
