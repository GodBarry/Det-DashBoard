"use strict";

const http = require("http");
const crypto = require("crypto");

const NETWORK_PROJECT_NAME = "网络接收数据";
const DEFAULT_PORT = 4180;

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
  });
  res.end(payload);
}

function safeFileName(value, fallback = "network-image.jpg") {
  const name = String(value || "").split(/[\\/]/).pop().replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  return name || fallback;
}

function decodeImageRequest(buffer, contentType = "", headers = {}) {
  if (contentType.includes("application/json")) {
    const body = JSON.parse(buffer.toString("utf8") || "{}");
    const encoded = body.imageBase64 || body.image_base64 || body.image || body.data;
    if (!encoded) throw new Error("JSON 请求缺少 imageBase64/image/data 字段");
    const text = String(encoded);
    const match = text.match(/^data:([^;,]+);base64,(.*)$/s);
    return {
      bytes: Buffer.from(match ? match[2] : text, "base64"),
      contentType: match?.[1] || body.contentType || "image/jpeg",
      filename: safeFileName(body.filename || body.fileName),
      sessionId: body.sessionId || body.session_id || null,
      projectImageId: body.projectImageId || body.project_image_id || null,
    };
  }
  if (contentType.includes("multipart/form-data")) {
    const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
    if (!boundary) throw new Error("multipart 请求缺少 boundary");
    const marker = Buffer.from(`--${boundary}`);
    let offset = 0;
    while (offset < buffer.length) {
      const start = buffer.indexOf(marker, offset);
      if (start < 0) break;
      const next = buffer.indexOf(marker, start + marker.length);
      if (next < 0) break;
      const part = buffer.subarray(start + marker.length, next);
      const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
      if (headerEnd > 0) {
        const partHeaders = part.subarray(0, headerEnd).toString("utf8");
        const filename = partHeaders.match(/filename="([^"]+)"/i)?.[1];
        const field = partHeaders.match(/name="([^"]+)"/i)?.[1];
        if (filename || ["image", "file"].includes(field)) {
          let bytes = part.subarray(headerEnd + 4);
          if (bytes.subarray(bytes.length - 2).toString() === "\r\n") bytes = bytes.subarray(0, bytes.length - 2);
          return {
            bytes,
            contentType: partHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "image/jpeg",
            filename: safeFileName(filename),
            sessionId: headers["x-session-id"] || null,
            projectImageId: headers["x-project-image-id"] || null,
          };
        }
      }
      offset = next;
    }
    throw new Error("multipart 请求中没有 image/file 文件字段");
  }
  return {
    bytes: buffer,
    contentType: contentType || "application/octet-stream",
    filename: safeFileName(headers["x-filename"]),
    sessionId: headers["x-session-id"] || null,
    projectImageId: headers["x-project-image-id"] || null,
  };
}

function extensionFor(filename, contentType) {
  const ext = require("path").extname(filename || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"].includes(ext)) return ext;
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("bmp")) return ".bmp";
  return ".jpg";
}

function createNetworkInferenceService(deps) {
  const {
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
  } = deps;
  const port = Number(process.env.NETWORK_INFERENCE_PORT || DEFAULT_PORT);
  const maxBodyBytes = Number(process.env.NETWORK_INFERENCE_MAX_BODY_BYTES || 64 * 1024 * 1024);
  let server = null;
  let session = null;
  let requestChain = Promise.resolve();

  async function ensureProject(actor) {
    let project = (await query(
      "SELECT * FROM projects WHERE name=$1 AND project_type='dataset' AND parent_id IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
      [NETWORK_PROJECT_NAME],
    )).rows[0];
    if (project) return project;
    project = (await query(
      `INSERT INTO projects (name, description, project_type, owner_user_id, visibility)
       VALUES ($1,$2,'dataset',$3,'private') RETURNING *`,
      [NETWORK_PROJECT_NAME, "通过 4180 /infer 接收并持久化的无标注图片", actor.id],
    )).rows[0];
    await resourceAccess.assignOwner("projects", project.id, actor);
    return project;
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBodyBytes) throw new Error(`请求体超过 ${Math.round(maxBodyBytes / 1024 / 1024)}MB 限制`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function persistImage(input, activeSession, requestId) {
    if (!input.bytes?.length) throw new Error("收到的图片内容为空");
    const ext = extensionFor(input.filename, input.contentType);
    const receivedDir = path.join(storageRoot, "runtime", "network-inference", activeSession.job.id, "received");
    fs.mkdirSync(receivedDir, { recursive: true });
    const fileName = `${requestId}${ext}`;
    const localPath = path.join(receivedDir, fileName);
    fs.writeFileSync(localPath, input.bytes);
    const metadata = await sharp(localPath).metadata();
    if (!metadata.width || !metadata.height) throw new Error("无法识别图片尺寸或图片格式无效");
    const registered = await transaction(async (client) => {
      const asset = await importService.upsertImageAsset(client, localPath, {
        imageWidth: metadata.width,
        imageHeight: metadata.height,
      });
      const image = await importService.upsertProjectImage(client, {
        projectId: activeSession.project.id,
        imageAssetId: asset.id,
        importBatchId: null,
        displayName: fileName,
        sourcePath: localPath,
        scene: "Network",
        view: "External",
        modality: "visible",
        keyword: input.sessionId ? `session:${input.sessionId}` : "network",
        sourceSize: input.bytes.length,
        sourceMtimeMs: Date.now(),
      });
      return { asset, image };
    });
    return { ...registered, localPath, fileName, width: metadata.width, height: metadata.height };
  }

  async function drawVisualization(sourcePath, predictions, destination, width, height) {
    const escape = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
    })[char]);
    const shapes = predictions.map((item) => {
      const x = Number(item.bbox_x ?? item.x ?? item.bbox?.[0] ?? 0);
      const y = Number(item.bbox_y ?? item.y ?? item.bbox?.[1] ?? 0);
      const w = Number(item.bbox_w ?? item.width ?? item.bbox?.[2] ?? 0);
      const h = Number(item.bbox_h ?? item.height ?? item.bbox?.[3] ?? 0);
      const label = `${escape(item.label || item.class_name || "object")} ${Number(item.score ?? item.confidence ?? 0).toFixed(2)}`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#31d0aa" stroke-width="3"/>
        <rect x="${x}" y="${Math.max(0, y - 24)}" width="${Math.max(90, label.length * 9)}" height="24" fill="#102a2a" opacity=".9"/>
        <text x="${x + 4}" y="${Math.max(17, y - 7)}" fill="white" font-size="15" font-family="sans-serif">${label}</text>`;
    }).join("");
    const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`);
    await sharp(sourcePath).composite([{ input: svg, left: 0, top: 0 }]).jpeg({ quality: 90 }).toFile(destination);
  }

  async function infer(input) {
    const activeSession = session;
    if (!server || !activeSession) {
      const error = new Error("网络推理服务未开启");
      error.statusCode = 503;
      throw error;
    }
    const requestId = crypto.randomUUID();
    const image = await persistImage(input, activeSession, requestId);
    const requestRoot = path.join(storageRoot, "runtime", "network-inference", activeSession.job.id, "requests", requestId);
    fs.mkdirSync(requestRoot, { recursive: true });
    const manifestPath = path.join(requestRoot, "input-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      format: "det-dashboard.inference-input.v1",
      cacheRoot: requestRoot,
      images: [{
        index: 1,
        localPath: image.localPath,
        cachedFileName: image.fileName,
        projectImageId: image.image.id,
        imageAssetId: image.asset.id,
        originalFileName: input.filename || image.fileName,
        width: image.width,
        height: image.height,
      }],
    }, null, 2));

    const current = (await query("SELECT * FROM runtime_inference_jobs WHERE id=$1", [activeSession.job.id])).rows[0];
    const sessionParams = typeof current.params_json === "string" ? JSON.parse(current.params_json) : current.params_json;
    const previousResults = (await query(
      "SELECT * FROM runtime_inference_results WHERE inference_job_id=$1 ORDER BY created_at",
      [current.id],
    )).rows;
    const runParams = {
      ...sessionParams,
      input: { ...(sessionParams.input || {}), sourceType: "network_post", projectIds: [activeSession.project.id], manifestPath },
      output: { ...(sessionParams.output || {}), saveVisualization: true },
    };
    await inferenceWorkerController.runInferenceJob({
      ...current,
      output_root: requestRoot,
      params_json: runParams,
    }, "network-inference-4180");
    const completed = (await query("SELECT * FROM runtime_inference_jobs WHERE id=$1", [current.id])).rows[0];
    const newResults = (await query(
      "SELECT * FROM runtime_inference_results WHERE inference_job_id=$1 ORDER BY created_at",
      [current.id],
    )).rows;
    if (completed.status === "failed") {
      await query(
        "UPDATE runtime_inference_jobs SET status='listening', progress=0, finished_at=NULL, message=$1 WHERE id=$2",
        [`监听中；最近一次请求失败：${completed.message}`, current.id],
      );
      throw new Error(completed.message || "推理失败");
    }
    const result = newResults.find((row) => String(row.project_image_id) === String(image.image.id)) || newResults[0];
    const predictions = Array.isArray(result?.predictions_json)
      ? result.predictions_json
      : JSON.parse(result?.predictions_json || "[]");
    const visualPath = path.join(requestRoot, "visualization.jpg");
    await drawVisualization(image.localPath, predictions, visualPath, image.width, image.height);
    const count = Number(activeSession.received || 0) + 1;
    activeSession.received = count;
    activeSession.predictions = Number(activeSession.predictions || 0) + predictions.length;
    await transaction(async (client) => {
      await client.query("DELETE FROM runtime_inference_results WHERE inference_job_id=$1", [current.id]);
      for (const row of previousResults) await client.query(
        `INSERT INTO runtime_inference_results
         (id, inference_job_id, project_image_id, predictions_json, artifact_path, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [row.id, current.id, row.project_image_id, JSON.stringify(row.predictions_json), row.artifact_path, row.created_at],
      );
      await client.query(
        `INSERT INTO runtime_inference_results
         (inference_job_id, project_image_id, predictions_json, artifact_path)
         VALUES ($1,$2,$3,$4)`,
        [current.id, image.image.id, JSON.stringify(predictions), visualPath],
      );
      await client.query(
        `UPDATE runtime_inference_jobs
         SET status='listening', progress=0, process_pid=NULL, finished_at=NULL,
             params_json=$1, metrics_json=$2, message=$3
         WHERE id=$4`,
        [
          JSON.stringify(sessionParams),
          JSON.stringify({
            images: count,
            received: count,
            predictions: activeSession.predictions,
            lastRequestId: requestId,
            listening: true,
          }),
          `4180 监听中；已接收 ${count} 张，最近结果 ${predictions.length} 个目标`,
          current.id,
        ],
      );
    });
    return {
      code: 0,
      message: "success",
      requestId,
      sessionId: input.sessionId || current.id,
      inferenceSessionId: current.id,
      projectImageId: image.image.id,
      image: { filename: image.fileName, width: image.width, height: image.height },
      predictions,
      boxes: predictions.map((item) => ({
        classId: item.class_id ?? null,
        label: item.label || item.class_name || "object",
        confidence: Number(item.score ?? item.confidence ?? 0),
        x: Number(item.bbox_x ?? item.x ?? item.bbox?.[0] ?? 0),
        y: Number(item.bbox_y ?? item.y ?? item.bbox?.[1] ?? 0),
        width: Number(item.bbox_w ?? item.width ?? item.bbox?.[2] ?? 0),
        height: Number(item.bbox_h ?? item.height ?? item.bbox?.[3] ?? 0),
      })),
      visualization: {
        path: visualPath,
        contentType: "image/jpeg",
        base64: fs.readFileSync(visualPath).toString("base64"),
      },
    };
  }

  async function handle4180(req, res) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && requestUrl.pathname === "/health") {
        json(res, server && session ? 200 : 503, {
          status: server && session ? "listening" : "stopped",
          port,
          sessionId: session?.job.id || null,
          projectId: session?.project.id || null,
          received: session?.received || 0,
          config: session?.config || null,
        });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/infer") {
        const buffer = await readBody(req);
        const input = decodeImageRequest(buffer, String(req.headers["content-type"] || "").toLowerCase(), req.headers);
        const work = requestChain.then(() => infer(input));
        requestChain = work.catch(() => {});
        json(res, 200, await work);
        return;
      }
      json(res, 404, { code: 404, message: "仅支持 GET /health 和 POST /infer" });
    } catch (error) {
      logger.error("network inference request failed:", error);
      json(res, error.statusCode || 500, { code: error.statusCode || 500, message: error.message || "推理失败" });
    }
  }

  async function start(body, actor) {
    if (server || session) throw new Error("网络推理服务已经开启，请先关闭当前会话");
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
    const resolvedParams = typeof job.params_json === "string"
      ? JSON.parse(job.params_json || "{}")
      : (job.params_json || {});
    session = {
      job,
      project,
      received: 0,
      predictions: 0,
      config: {
        modelVersionId: job.model_version_id,
        algorithmAssetId: resolvedParams.algorithmAssetId,
        pythonEnvId: resolvedParams.pythonEnvId,
        device: resolvedParams.device,
        recognitionClasses: resolvedParams.recognitionClasses || [],
        conf: resolvedParams.conf,
        iou: resolvedParams.iou,
        imgsz: resolvedParams.imgsz,
      },
    };
    server = http.createServer(handle4180);
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", resolve);
      });
    } catch (error) {
      server = null;
      session = null;
      await query(
        "UPDATE runtime_inference_jobs SET status='failed', message=$1, finished_at=now() WHERE id=$2",
        [`4180 启动失败：${error.message}`, job.id],
      );
      throw error;
    }
    return status();
  }

  async function stop() {
    const active = session;
    if (!server || !active) return status();
    const closing = server;
    server = null;
    await new Promise((resolve) => closing.close(resolve));
    await requestChain;
    await query(
      `UPDATE runtime_inference_jobs
       SET status='stopped', progress=100, process_pid=NULL, finished_at=now(),
           metrics_json=COALESCE(metrics_json,'{}'::jsonb) || $1::jsonb, message=$2
       WHERE id=$3`,
      [
        JSON.stringify({
          listening: false,
          images: active.received,
          received: active.received,
          predictions: active.predictions,
        }),
        `网络推理会话已停止；共接收 ${active.received} 张`,
        active.job.id,
      ],
    );
    session = null;
    return status();
  }

  function status() {
    return {
      running: Boolean(server && session),
      status: server && session ? "listening" : "stopped",
      port,
      sessionId: session?.job.id || null,
      projectId: session?.project.id || null,
      received: session?.received || 0,
      config: session?.config || null,
    };
  }

  return { start, stop, status };
}

module.exports = {
  createNetworkInferenceService,
  decodeImageRequest,
};
