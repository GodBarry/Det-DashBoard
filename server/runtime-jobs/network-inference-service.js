"use strict";

const http = require("http");
const crypto = require("crypto");

const PROJECT_NAME = "网络接收数据";

function sendJson(res, status, value) {
  const payload = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": payload.length });
  res.end(payload);
}

function safeName(value) {
  return String(value || "network-image.jpg").split(/[\\/]/).pop().replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
}

function parseImage(buffer, contentType, headers = {}) {
  if (contentType.includes("application/json")) {
    const body = JSON.parse(buffer.toString("utf8") || "{}");
    const encoded = body.imageBase64 || body.image_base64 || body.image || body.data;
    if (!encoded) throw new Error("请求缺少 imageBase64/image/data");
    const match = String(encoded).match(/^data:([^;,]+);base64,(.*)$/s);
    return {
      bytes: Buffer.from(match ? match[2] : encoded, "base64"),
      filename: safeName(body.filename || body.fileName),
      contentType: match?.[1] || body.contentType || "image/jpeg",
      sessionId: body.sessionId || body.session_id || null,
      remoteProjectImageId: body.projectImageId || body.project_image_id || null,
    };
  }
  if (contentType.includes("multipart/form-data")) {
    const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
    if (!boundary) throw new Error("multipart 请求缺少 boundary");
    const parts = buffer.toString("latin1").split(`--${boundary}`);
    for (const part of parts) {
      const separator = part.indexOf("\r\n\r\n");
      if (separator < 0) continue;
      const head = part.slice(0, separator);
      const filename = head.match(/filename="([^"]+)"/i)?.[1];
      const field = head.match(/name="([^"]+)"/i)?.[1];
      if (!filename && !["image", "file"].includes(field)) continue;
      let body = part.slice(separator + 4);
      if (body.endsWith("\r\n")) body = body.slice(0, -2);
      return {
        bytes: Buffer.from(body, "latin1"),
        filename: safeName(filename),
        contentType: head.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "image/jpeg",
        sessionId: headers["x-session-id"] || null,
        remoteProjectImageId: headers["x-project-image-id"] || null,
      };
    }
    throw new Error("multipart 请求中没有 image/file 文件");
  }
  return {
    bytes: buffer,
    filename: safeName(headers["x-filename"]),
    contentType: contentType || "application/octet-stream",
    sessionId: headers["x-session-id"] || null,
    remoteProjectImageId: headers["x-project-image-id"] || null,
  };
}

function createNetworkInferenceService({
  query,
  transaction,
  resourceAccess,
  createInferenceJob,
  importService,
  inferenceWorkerController,
  fs,
  path,
  sharp,
  storageRoot,
  logger = console,
}) {
  const port = Number(process.env.NETWORK_INFERENCE_PORT || 4180);
  const maxBytes = Number(process.env.NETWORK_INFERENCE_MAX_BODY_BYTES || 64 * 1024 * 1024);
  let listener = null;
  let session = null;
  let queue = Promise.resolve();

  async function ensureProject(actor) {
    let project = (await query(
      "SELECT * FROM projects WHERE name=$1 AND parent_id IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
      [PROJECT_NAME],
    )).rows[0];
    if (project) return project;
    project = (await query(
      `INSERT INTO projects (name,description,project_type,owner_user_id,visibility)
       VALUES ($1,$2,'dataset',$3,'private') RETURNING *`,
      [PROJECT_NAME, "通过 4180 /infer 接收的无标注图片", actor.id],
    )).rows[0];
    await resourceAccess.assignOwner("projects", project.id, actor);
    return project;
  }

  async function readRequest(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > maxBytes) throw new Error("请求图片超过大小限制");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function registerImage(input, requestId) {
    if (!input.bytes.length) throw new Error("图片内容为空");
    const guessed = path.extname(input.filename).toLowerCase();
    const ext = [".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"].includes(guessed)
      ? guessed
      : input.contentType.includes("png") ? ".png" : ".jpg";
    const dir = path.join(storageRoot, "runtime", "network-inference", session.job.id, "received");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${requestId}${ext}`;
    const localPath = path.join(dir, filename);
    fs.writeFileSync(localPath, input.bytes);
    const meta = await sharp(localPath).metadata();
    if (!meta.width || !meta.height) throw new Error("图片格式无效");
    const rows = await transaction(async (client) => {
      const asset = await importService.upsertImageAsset(client, localPath, { imageWidth: meta.width, imageHeight: meta.height });
      const image = await importService.upsertProjectImage(client, {
        projectId: session.project.id,
        imageAssetId: asset.id,
        importBatchId: null,
        displayName: filename,
        sourcePath: localPath,
        sourceSize: input.bytes.length,
        sourceMtimeMs: Date.now(),
        scene: "Network",
        view: "External",
        modality: "visible",
        keyword: input.sessionId ? `session:${input.sessionId}` : "network",
      });
      return { asset, image };
    });
    return { ...rows, localPath, filename, width: meta.width, height: meta.height };
  }

  async function visualize(imagePath, predictions, outputPath, width, height) {
    const escape = (value) => String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
    const boxes = predictions.map((item) => {
      const x = Number(item.bbox_x ?? item.x ?? item.bbox?.[0] ?? 0);
      const y = Number(item.bbox_y ?? item.y ?? item.bbox?.[1] ?? 0);
      const w = Number(item.bbox_w ?? item.width ?? item.bbox?.[2] ?? 0);
      const h = Number(item.bbox_h ?? item.height ?? item.bbox?.[3] ?? 0);
      const text = `${escape(item.label || item.class_name || "object")} ${Number(item.score ?? item.confidence ?? 0).toFixed(2)}`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#31d0aa" stroke-width="3"/><text x="${x + 3}" y="${Math.max(16, y - 5)}" fill="#31d0aa" font-size="16" font-family="sans-serif">${text}</text>`;
    }).join("");
    await sharp(imagePath).composite([{ input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${boxes}</svg>`), left: 0, top: 0 }]).jpeg({ quality: 90 }).toFile(outputPath);
  }

  async function infer(input) {
    if (!listener || !session) {
      const error = new Error("网络推理服务未开启");
      error.statusCode = 503;
      throw error;
    }
    const requestId = crypto.randomUUID();
    const image = await registerImage(input, requestId);
    const root = path.join(storageRoot, "runtime", "network-inference", session.job.id, "requests", requestId);
    fs.mkdirSync(root, { recursive: true });
    const manifestPath = path.join(root, "input-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      format: "det-dashboard.inference-input.v1",
      cacheRoot: root,
      images: [{
        index: 1,
        localPath: image.localPath,
        cachedFileName: image.filename,
        projectImageId: image.image.id,
        imageAssetId: image.asset.id,
        originalFileName: input.filename,
        width: image.width,
        height: image.height,
      }],
    }, null, 2));
    const job = (await query("SELECT * FROM runtime_inference_jobs WHERE id=$1", [session.job.id])).rows[0];
    const params = typeof job.params_json === "string" ? JSON.parse(job.params_json) : job.params_json;
    const history = (await query("SELECT * FROM runtime_inference_results WHERE inference_job_id=$1 ORDER BY created_at", [job.id])).rows;
    await inferenceWorkerController.runInferenceJob({
      ...job,
      output_root: root,
      params_json: {
        ...params,
        input: { ...(params.input || {}), projectIds: [session.project.id], sourceType: "network_post", manifestPath },
        output: { ...(params.output || {}), saveVisualization: true },
      },
    }, "network-inference-4180");
    const after = (await query("SELECT * FROM runtime_inference_jobs WHERE id=$1", [job.id])).rows[0];
    if (after.status === "failed") {
      await query("UPDATE runtime_inference_jobs SET status='listening',progress=0,finished_at=NULL,message=$1 WHERE id=$2", [`监听中；最近请求失败：${after.message}`, job.id]);
      throw new Error(after.message || "推理失败");
    }
    const fresh = (await query("SELECT * FROM runtime_inference_results WHERE inference_job_id=$1 ORDER BY created_at", [job.id])).rows;
    const result = fresh.find((row) => String(row.project_image_id) === String(image.image.id)) || fresh[0];
    const predictions = Array.isArray(result?.predictions_json) ? result.predictions_json : JSON.parse(result?.predictions_json || "[]");
    const visualPath = path.join(root, "visualization.jpg");
    await visualize(image.localPath, predictions, visualPath, image.width, image.height);
    session.images += 1;
    session.predictions += predictions.length;
    await transaction(async (client) => {
      await client.query("DELETE FROM runtime_inference_results WHERE inference_job_id=$1", [job.id]);
      for (const row of history) await client.query(
        `INSERT INTO runtime_inference_results (id,inference_job_id,project_image_id,predictions_json,artifact_path,created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [row.id, job.id, row.project_image_id, JSON.stringify(row.predictions_json), row.artifact_path, row.created_at],
      );
      await client.query(
        "INSERT INTO runtime_inference_results (inference_job_id,project_image_id,predictions_json,artifact_path) VALUES ($1,$2,$3,$4)",
        [job.id, image.image.id, JSON.stringify(predictions), visualPath],
      );
      await client.query(
        `UPDATE runtime_inference_jobs SET status='listening',progress=0,finished_at=NULL,process_pid=NULL,
         params_json=$1,metrics_json=$2,message=$3 WHERE id=$4`,
        [JSON.stringify(params), JSON.stringify({ images: session.images, received: session.images, predictions: session.predictions, listening: true }), `4180 监听中；已接收 ${session.images} 张`, job.id],
      );
    });
    const boxes = predictions.map((item) => ({
      classId: item.class_id ?? null,
      label: item.label || item.class_name || "object",
      confidence: Number(item.score ?? item.confidence ?? 0),
      x: Number(item.bbox_x ?? item.x ?? item.bbox?.[0] ?? 0),
      y: Number(item.bbox_y ?? item.y ?? item.bbox?.[1] ?? 0),
      width: Number(item.bbox_w ?? item.width ?? item.bbox?.[2] ?? 0),
      height: Number(item.bbox_h ?? item.height ?? item.bbox?.[3] ?? 0),
    }));
    return {
      code: 0,
      message: "success",
      requestId,
      sessionId: input.sessionId || job.id,
      inferenceSessionId: job.id,
      projectImageId: image.image.id,
      sourceProjectImageId: input.remoteProjectImageId,
      predictions,
      boxes,
      visualization: { path: visualPath, contentType: "image/jpeg", base64: fs.readFileSync(visualPath).toString("base64") },
    };
  }

  async function handle(req, res) {
    try {
      const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
      if (req.method === "GET" && pathname === "/health") return sendJson(res, session ? 200 : 503, status());
      if (req.method === "POST" && pathname === "/infer") {
        const input = parseImage(await readRequest(req), String(req.headers["content-type"] || "").toLowerCase(), req.headers);
        const work = queue.then(() => infer(input));
        queue = work.catch(() => {});
        return sendJson(res, 200, await work);
      }
      return sendJson(res, 404, { code: 404, message: "仅支持 GET /health 和 POST /infer" });
    } catch (error) {
      logger.error("network inference request failed:", error);
      return sendJson(res, error.statusCode || 500, { code: error.statusCode || 500, message: error.message });
    }
  }

  async function start(body, actor) {
    if (listener || session) throw new Error("网络推理服务已开启");
    const project = await ensureProject(actor);
    const job = await createInferenceJob({
      ...body,
      name: body.name || "外部接口推理会话",
      datasetProjectId: project.id,
      datasetProjectIds: [project.id],
      executionMode: "network_listener",
      params: {
        ...(body.params || {}),
        input: { ...(body.params?.input || {}), projectIds: [project.id], sourceType: "network_post" },
        networkInference: { enabled: true, port, startedBy: actor.id },
      },
    }, actor);
    const params = typeof job.params_json === "string" ? JSON.parse(job.params_json) : job.params_json;
    session = {
      job,
      project,
      images: 0,
      predictions: 0,
      config: {
        modelVersionId: job.model_version_id,
        algorithmAssetId: params.algorithmAssetId,
        pythonEnvId: params.pythonEnvId,
        device: params.device,
        recognitionClasses: params.recognitionClasses || [],
        conf: params.conf,
        iou: params.iou,
        imgsz: params.imgsz,
      },
    };
    listener = http.createServer(handle);
    try {
      await new Promise((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(port, "0.0.0.0", resolve);
      });
    } catch (error) {
      listener = null;
      session = null;
      await query("UPDATE runtime_inference_jobs SET status='failed',message=$1,finished_at=now() WHERE id=$2", [`4180 启动失败：${error.message}`, job.id]);
      throw error;
    }
    return status();
  }

  async function stop() {
    if (!listener || !session) return status();
    const active = session;
    const server = listener;
    listener = null;
    await new Promise((resolve) => server.close(resolve));
    await queue;
    await query(
      `UPDATE runtime_inference_jobs SET status='stopped',progress=100,finished_at=now(),
       metrics_json=COALESCE(metrics_json,'{}'::jsonb)||$1::jsonb,message=$2 WHERE id=$3`,
      [JSON.stringify({ listening: false, images: active.images, received: active.images, predictions: active.predictions }), `网络推理会话已停止；共接收 ${active.images} 张`, active.job.id],
    );
    session = null;
    return status();
  }

  function status() {
    return {
      running: Boolean(listener && session),
      status: listener && session ? "listening" : "stopped",
      port,
      sessionId: session?.job.id || null,
      projectId: session?.project.id || null,
      received: session?.images || 0,
      config: session?.config || null,
    };
  }

  return { start, stop, status };
}

module.exports = { createNetworkInferenceService, parseImage };
