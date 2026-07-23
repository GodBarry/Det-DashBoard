"use strict";

const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PROJECT_NAME = "网络接收数据";

function networkRunnerKind(algorithmKey) {
  if (algorithmKey === "ultralytics_yolo") return "ultralytics_yolo";
  if (algorithmKey === "dinov3_faster_rcnn") return "dinov3_faster_rcnn";
  if (["dummy_empty_detector", "fake_reference_detector"].includes(algorithmKey)) return "builtin";
  return null;
}

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
  pythonEnvService,
  modelService,
  algorithmRuntimeSource,
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
  let starting = false;
  let queue = Promise.resolve();

  function normalizedDevice(value, cudaAvailable, accelerator = "") {
    const isNpu = String(accelerator || "").toLowerCase() === "npu";
    const requested = String(value ?? "").trim().toLowerCase();
    if (!requested || requested === "-1") return isNpu ? "npu:0" : (cudaAvailable ? "cuda:0" : "cpu");
    if (/^\d+$/.test(requested)) return isNpu ? `npu:${requested}` : (cudaAvailable ? `cuda:${requested}` : "cpu");
    return requested;
  }

  async function createYoloRunner(job, params) {
    const envId = params.pythonEnvId || params.python_env_id;
    if (!envId) throw new Error("网络推理缺少 Python 运行环境资产");
    await query(
      "UPDATE runtime_inference_jobs SET status='preparing',progress=10,message=$1 WHERE id=$2",
      ["正在恢复 Python 运行环境", job.id],
    );
    let env = (await query("SELECT * FROM runtime_envs WHERE id=$1", [envId])).rows[0];
    if (!env) throw new Error("网络推理运行环境不存在");
    env = await pythonEnvService.resolveRuntimePythonEnv(env);
    if (!fs.existsSync(env.python_path)) throw new Error(`网络推理 Python 不存在：${env.python_path}`);
    const weightPath = await modelService.findWeightArtifact(job.model_version_id);
    if (!weightPath) throw new Error("网络推理缺少可用模型权重文件");
    const device = normalizedDevice(params.device, Boolean(env.cuda_available), env.accelerator);
    const runnerRoot = path.join(storageRoot, "runtime", "network-inference", job.id, "model-runner");
    fs.mkdirSync(runnerRoot, { recursive: true });
    const configPath = path.join(runnerRoot, "config.json");
    const scriptPath = path.join(runnerRoot, "persistent_yolo_worker.py");
    fs.writeFileSync(configPath, JSON.stringify({
      weights: weightPath,
      device,
      conf: Number(params.conf ?? 0.25),
      iou: Number(params.iou ?? 0.7),
      imgsz: Number(params.imgsz ?? 640),
      recognitionClasses: params.recognitionClasses || [],
    }), "utf8");
    fs.writeFileSync(scriptPath, [
      "import json, sys, traceback",
      "from ultralytics import YOLO",
      "with open(sys.argv[1], 'r', encoding='utf-8') as f: cfg = json.load(f)",
      "try:",
      "    model = YOLO(cfg['weights'])",
      "    model.to(cfg['device'])",
      "    names = getattr(model, 'names', {}) or {}",
      "    allowed = {str(x).strip().lower() for x in cfg.get('recognitionClasses', []) if str(x).strip()}",
      "    print(json.dumps({'event':'ready','device':cfg['device'],'model':cfg['weights']}), flush=True)",
      "except Exception as error:",
      "    print(json.dumps({'event':'fatal','error':str(error),'traceback':traceback.format_exc()}), flush=True)",
      "    raise",
      "for line in sys.stdin:",
      "    try:",
      "        request = json.loads(line)",
      "        if request.get('action') == 'shutdown': break",
      "        result = model.predict(source=request['imagePath'], conf=cfg['conf'], iou=cfg['iou'], imgsz=cfg['imgsz'], device=cfg['device'], verbose=False)[0]",
      "        predictions = []",
      "        boxes = getattr(result, 'boxes', None)",
      "        if boxes is not None:",
      "            xyxy = boxes.xyxy.cpu().tolist()",
      "            confs = boxes.conf.cpu().tolist()",
      "            classes = boxes.cls.cpu().tolist()",
      "            for coords, score, class_id in zip(xyxy, confs, classes):",
      "                x1, y1, x2, y2 = [float(v) for v in coords]",
      "                class_id = int(class_id)",
      "                label = names.get(class_id, str(class_id)) if isinstance(names, dict) else str(class_id)",
      "                if allowed and str(label).strip().lower() not in allowed: continue",
      "                predictions.append({'label':label,'score':float(score),'class_id':class_id,'bbox_x':x1,'bbox_y':y1,'bbox_w':max(0.0,x2-x1),'bbox_h':max(0.0,y2-y1)})",
      "        print(json.dumps({'event':'result','id':request['id'],'predictions':predictions}, ensure_ascii=False), flush=True)",
      "    except Exception as error:",
      "        print(json.dumps({'event':'error','id':request.get('id') if 'request' in locals() else None,'error':str(error),'traceback':traceback.format_exc()}, ensure_ascii=False), flush=True)",
    ].join("\n"), "utf8");
    await query(
      "UPDATE runtime_inference_jobs SET status='preparing',progress=35,message=$1 WHERE id=$2",
      [`正在将模型加载到 ${device}`, job.id],
    );
    const child = spawn(env.python_path, ["-u", scriptPath, configPath], {
      cwd: runnerRoot,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pending = new Map();
    let stopping = false;
    let stdoutBuffer = "";
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const rejectAll = (error) => {
      readyReject(error);
      for (const item of pending.values()) item.reject(error);
      pending.clear();
    };
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines.filter(Boolean)) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.event === "ready") readyResolve(message);
        if (message.event === "fatal") readyReject(new Error(message.error || "模型加载失败"));
        if (message.event === "result" || message.event === "error") {
          const item = pending.get(message.id);
          if (!item) continue;
          pending.delete(message.id);
          if (message.event === "error") item.reject(new Error(message.error || "推理失败"));
          else item.resolve(message.predictions || []);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) logger.error(`[network-yolo ${job.id}] ${text}`);
    });
    child.once("error", rejectAll);
    child.once("exit", (code) => {
      const error = new Error(`常驻模型进程已退出（${code ?? "unknown"}）`);
      rejectAll(error);
      if (!stopping) query(
        "UPDATE runtime_inference_jobs SET status='failed',progress=100,process_pid=NULL,message=$1,finished_at=now() WHERE id=$2",
        [error.message, job.id],
      ).catch(() => {});
    });
    const timer = setTimeout(() => readyReject(new Error("模型加载超时（180 秒）")), 180000);
    const loadingStartedAt = Date.now();
    const heartbeat = setInterval(() => query(
      "UPDATE runtime_inference_jobs SET message=$1 WHERE id=$2 AND status='preparing'",
      [`正在将模型加载到 ${device}（已等待 ${Math.max(1, Math.round((Date.now() - loadingStartedAt) / 1000))} 秒）`, job.id],
    ).catch(() => {}), 5000);
    try {
      const readyInfo = await ready;
      clearTimeout(timer);
      clearInterval(heartbeat);
      return {
        type: "ultralytics_yolo",
        pid: child.pid,
        device: readyInfo.device || device,
        model: readyInfo.model || weightPath,
        predict(imagePath) {
          const id = crypto.randomUUID();
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            child.stdin.write(`${JSON.stringify({ id, imagePath })}\n`, (error) => {
              if (!error) return;
              pending.delete(id);
              reject(error);
            });
          });
        },
        async stop() {
          if (child.exitCode != null) return;
          stopping = true;
          child.stdin.write(`${JSON.stringify({ action: "shutdown" })}\n`);
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              child.kill();
              resolve();
            }, 5000);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        },
      };
    } catch (error) {
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (child.exitCode == null) child.kill();
      throw error;
    }
  }

  async function createDinoRunner(job, params) {
    const envId = params.pythonEnvId || params.python_env_id;
    if (!envId) throw new Error("DINO 网络推理缺少 Python 运行环境资产");
    await query(
      "UPDATE runtime_inference_jobs SET status='preparing',progress=10,message=$1 WHERE id=$2",
      ["正在恢复 DINO Python 运行环境", job.id],
    );
    let env = (await query("SELECT * FROM runtime_envs WHERE id=$1", [envId])).rows[0];
    if (!env) throw new Error("DINO 网络推理运行环境不存在");
    env = await pythonEnvService.resolveRuntimePythonEnv(env);
    if (!env.python_path || !fs.existsSync(env.python_path)) throw new Error(`DINO Python 不存在：${env.python_path || "(empty)"}`);
    const resolved = await algorithmRuntimeSource.resolveTrainingAlgorithmSource(params);
    if (!resolved) throw new Error("DINO 算法源码资产不可用");
    const { algorithm, cacheRoot } = resolved;
    const weightPath = await modelService.findWeightArtifact(job.model_version_id);
    if (!weightPath) throw new Error("DINO 网络推理缺少可用模型权重");
    const runnerRoot = path.join(storageRoot, "runtime", "network-inference", job.id, "model-runner");
    fs.mkdirSync(runnerRoot, { recursive: true });
    const { configPath: modelConfigPath, sourceRoot } = await algorithmRuntimeSource.resolveDinoConfigPath({
      env,
      cacheRoot,
      algorithm,
      params,
      weightPath,
      outputRoot: runnerRoot,
    });
    const device = normalizedDevice(params.device, Boolean(env.cuda_available), env.accelerator);
    const configPath = path.join(runnerRoot, "config.json");
    const scriptPath = path.join(runnerRoot, "persistent_dino_worker.py");
    fs.writeFileSync(configPath, JSON.stringify({
      configPath: modelConfigPath,
      weightPath,
      device,
      scoreThreshold: Number(params.conf ?? params.scoreThreshold ?? 0.25),
      recognitionClasses: params.recognitionClasses || [],
    }), "utf8");
    fs.writeFileSync(scriptPath, [
      "import json, sys, traceback",
      "import torch",
      "import dino_detector",
      "from mmcv.transforms import Compose",
      "from mmengine.config import Config",
      "from mmengine.dataset import pseudo_collate",
      "from mmdet.apis import init_detector",
      "from mmdet.utils import get_test_pipeline_cfg",
      "with open(sys.argv[1], 'r', encoding='utf-8') as f: cfg = json.load(f)",
      "try:",
      "    model_cfg = Config.fromfile(cfg['configPath'])",
      "    def normalize_dataset(node):",
      "        if isinstance(node, dict):",
      "            if str(node.get('type') or '') == 'MosaicCocoDataset': node['type'] = 'CocoDataset'",
      "            if str(node.get('type') or '').endswith('Dataset'): node['lazy_init'] = True",
      "            if isinstance(node.get('pipeline'), list): node['pipeline'] = [x for x in node['pipeline'] if not (isinstance(x, dict) and x.get('type') == 'ApplyMosaicMask')]",
      "            for value in node.values(): normalize_dataset(value)",
      "        elif isinstance(node, list):",
      "            for value in node: normalize_dataset(value)",
      "    normalize_dataset(model_cfg._cfg_dict)",
      "    model = init_detector(model_cfg, cfg['weightPath'], device=cfg['device'])",
      "    classes = list((getattr(model, 'dataset_meta', {}) or {}).get('classes') or cfg.get('recognitionClasses') or [])",
      "    allowed = {str(x).strip().lower() for x in cfg.get('recognitionClasses', []) if str(x).strip()}",
      "    pipeline = Compose(get_test_pipeline_cfg(model.cfg))",
      "    print(json.dumps({'event':'ready','device':cfg['device'],'model':cfg['weightPath']}), flush=True)",
      "except Exception as error:",
      "    print(json.dumps({'event':'fatal','error':str(error),'traceback':traceback.format_exc()}), flush=True)",
      "    raise",
      "for line in sys.stdin:",
      "    try:",
      "        request = json.loads(line)",
      "        if request.get('action') == 'shutdown': break",
      "        item = pipeline(dict(img_path=request['imagePath'], img_id=0))",
      "        with torch.inference_mode(): result = model.test_step(pseudo_collate([item]))[0]",
      "        instances = result.pred_instances.to('cpu')",
      "        boxes = instances.bboxes.numpy().tolist() if hasattr(instances, 'bboxes') else []",
      "        scores = instances.scores.numpy().tolist() if hasattr(instances, 'scores') else [1.0] * len(boxes)",
      "        labels = instances.labels.numpy().tolist() if hasattr(instances, 'labels') else [-1] * len(boxes)",
      "        predictions = []",
      "        for box, score, class_id in zip(boxes, scores, labels):",
      "            if float(score) < cfg['scoreThreshold']: continue",
      "            x1, y1, x2, y2 = [float(v) for v in box]",
      "            class_id = int(class_id)",
      "            label = str(classes[class_id]) if 0 <= class_id < len(classes) else str(class_id)",
      "            if allowed and str(label).strip().lower() not in allowed: continue",
      "            predictions.append({'label':label,'score':float(score),'class_id':class_id,'bbox_x':x1,'bbox_y':y1,'bbox_w':max(0.0,x2-x1),'bbox_h':max(0.0,y2-y1)})",
      "        print(json.dumps({'event':'result','id':request['id'],'predictions':predictions}, ensure_ascii=False), flush=True)",
      "    except Exception as error:",
      "        print(json.dumps({'event':'error','id':request.get('id') if 'request' in locals() else None,'error':str(error),'traceback':traceback.format_exc()}, ensure_ascii=False), flush=True)",
    ].join("\n"), "utf8");
    await query(
      "UPDATE runtime_inference_jobs SET status='preparing',progress=35,message=$1 WHERE id=$2",
      [`正在将 DINO 模型加载到 ${device}`, job.id],
    );
    const child = spawn(env.python_path, ["-u", scriptPath, configPath], {
      cwd: sourceRoot,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: [sourceRoot, cacheRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pending = new Map();
    let stopping = false;
    let stdoutBuffer = "";
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const rejectAll = (error) => {
      readyReject(error);
      for (const item of pending.values()) item.reject(error);
      pending.clear();
    };
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines.filter(Boolean)) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.event === "ready") readyResolve(message);
        if (message.event === "fatal") readyReject(new Error(message.error || "DINO 模型加载失败"));
        if (message.event === "result" || message.event === "error") {
          const item = pending.get(message.id);
          if (!item) continue;
          pending.delete(message.id);
          if (message.event === "error") item.reject(new Error(message.error || "DINO 推理失败"));
          else item.resolve(message.predictions || []);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) logger.error(`[network-dino ${job.id}] ${text}`);
    });
    child.once("error", rejectAll);
    child.once("exit", (code) => {
      const error = new Error(`DINO 常驻模型进程已退出（${code ?? "unknown"}）`);
      rejectAll(error);
      if (!stopping) query(
        "UPDATE runtime_inference_jobs SET status='failed',progress=100,process_pid=NULL,message=$1,finished_at=now() WHERE id=$2",
        [error.message, job.id],
      ).catch(() => {});
    });
    const timer = setTimeout(() => readyReject(new Error("DINO 模型加载超时（300 秒）")), 300000);
    const loadingStartedAt = Date.now();
    const heartbeat = setInterval(() => query(
      "UPDATE runtime_inference_jobs SET message=$1 WHERE id=$2 AND status='preparing'",
      [`正在将 DINO 模型加载到 ${device}（已等待 ${Math.max(1, Math.round((Date.now() - loadingStartedAt) / 1000))} 秒）`, job.id],
    ).catch(() => {}), 5000);
    try {
      const readyInfo = await ready;
      clearTimeout(timer);
      clearInterval(heartbeat);
      return {
        type: "dinov3_faster_rcnn",
        pid: child.pid,
        device: readyInfo.device || device,
        model: readyInfo.model || weightPath,
        predict(imagePath) {
          const id = crypto.randomUUID();
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            child.stdin.write(`${JSON.stringify({ id, imagePath })}\n`, (error) => {
              if (!error) return;
              pending.delete(id);
              reject(error);
            });
          });
        },
        async stop() {
          if (child.exitCode != null) return;
          stopping = true;
          child.stdin.write(`${JSON.stringify({ action: "shutdown" })}\n`);
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              child.kill();
              resolve();
            }, 8000);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        },
      };
    } catch (error) {
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (child.exitCode == null) child.kill();
      throw error;
    }
  }

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
    await query(
      "UPDATE runtime_inference_jobs SET status='running',progress=65,message=$1,started_at=COALESCE(started_at,now()) WHERE id=$2",
      [`正在推理网络图片 ${image.filename}`, job.id],
    );
    let predictions;
    if (session.runner) {
      try {
        predictions = await session.runner.predict(image.localPath);
      } catch (error) {
        await query(
          "UPDATE runtime_inference_jobs SET status='listening',progress=0,message=$1 WHERE id=$2",
          [`监听中；最近请求失败：${error.message}`, job.id],
        );
        throw error;
      }
    } else {
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
      predictions = Array.isArray(result?.predictions_json) ? result.predictions_json : JSON.parse(result?.predictions_json || "[]");
    }
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
        `UPDATE runtime_inference_jobs SET status='listening',progress=0,finished_at=NULL,process_pid=$1,
         params_json=$2,metrics_json=$3,message=$4 WHERE id=$5`,
        [
          session.runner?.pid || null,
          JSON.stringify(params),
          JSON.stringify({ images: session.images, received: session.images, predictions: session.predictions, listening: true }),
          `4180 监听中；已接收 ${session.images} 张`,
          job.id,
        ],
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
    if (starting || listener || session) throw new Error("网络推理服务正在启动或已经开启");
    starting = true;
    try {
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
      let runner = null;
      try {
        const runnerKind = networkRunnerKind(params.algorithmKey);
        if (runnerKind === "ultralytics_yolo") runner = await createYoloRunner(job, params);
        else if (runnerKind === "dinov3_faster_rcnn") runner = await createDinoRunner(job, params);
        else if (!runnerKind) {
          throw new Error(`算法 ${params.templateName || params.algorithmKey || "(unknown)"} 尚未实现网络推理常驻适配器`);
        }
      } catch (error) {
        await query(
          "UPDATE runtime_inference_jobs SET status='failed',progress=100,message=$1,finished_at=now() WHERE id=$2",
          [`模型加载失败：${error.message}`, job.id],
        );
        throw error;
      }
      session = {
      job,
      project,
      runner,
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
        model: runner?.model || null,
        resolvedDevice: runner?.device || params.device,
        modelReady: Boolean(runner),
        modelProcessPid: runner?.pid || null,
      },
      };
      listener = http.createServer(handle);
      try {
        await new Promise((resolve, reject) => {
          listener.once("error", reject);
          listener.listen(port, "0.0.0.0", resolve);
        });
      } catch (error) {
        await runner?.stop().catch(() => {});
        listener = null;
        session = null;
        await query("UPDATE runtime_inference_jobs SET status='failed',message=$1,finished_at=now() WHERE id=$2", [`4180 启动失败：${error.message}`, job.id]);
        throw error;
      }
      await query(
      `UPDATE runtime_inference_jobs
       SET status='listening',progress=0,process_pid=$1,message=$2,started_at=COALESCE(started_at,now()),finished_at=NULL
       WHERE id=$3`,
      [
        runner?.pid || null,
        runner
          ? `模型已加载到 ${runner.device}，4180 监听中`
          : `${params.templateName || params.algorithmKey || "算法"} 已准备，4180 监听中`,
        job.id,
      ],
      );
      return status();
    } finally {
      starting = false;
    }
  }

  async function stop() {
    if (!listener || !session) return status();
    const active = session;
    const server = listener;
    await query(
      "UPDATE runtime_inference_jobs SET status='stopping',message=$1 WHERE id=$2",
      ["正在停止 4180 并释放常驻模型", active.job.id],
    );
    listener = null;
    await new Promise((resolve) => server.close(resolve));
    await queue;
    await active.runner?.stop().catch((error) => logger.error("stop network inference model runner failed:", error));
    await query(
      `UPDATE runtime_inference_jobs SET status='stopped',progress=100,process_pid=NULL,finished_at=now(),
       metrics_json=COALESCE(metrics_json,'{}'::jsonb)||$1::jsonb,message=$2 WHERE id=$3`,
      [JSON.stringify({ listening: false, images: active.images, received: active.images, predictions: active.predictions }), `网络推理会话已停止；共接收 ${active.images} 张`, active.job.id],
    );
    session = null;
    return status();
  }

  function status() {
    return {
      running: Boolean(listener && session),
      status: starting ? "preparing" : (listener && session ? "listening" : "stopped"),
      port,
      sessionId: session?.job.id || null,
      projectId: session?.project.id || null,
      received: session?.images || 0,
      config: session?.config || null,
      modelReady: Boolean(session?.runner),
    };
  }

  return { start, stop, status };
}

module.exports = { createNetworkInferenceService, networkRunnerKind, parseImage };
