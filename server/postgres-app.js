const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const sharp = require("sharp");
const { host, port, dataRoot, dataRootDisplay, browseRoot, browseRootDisplay, hostDialogUrl, nativeDialogMode, maxRequestBodyBytes, storageRoot, exportRoot, exportRootDisplay } = require("./config");
const { pool, query, transaction } = require("./db");
const store = require("./object-store");
const {
  IMAGE_EXTS,
  VIDEO_EXTS,
  walk,
  walkAsync,
  hashFile,
  quickHash,
  inferModality,
  inferSceneFromPath,
  inferSceneFromImportRoot,
  exportBaseName,
  cleanName,
} = require("./utils");
const { buildDatasetMatches, imageKey, shapeToBox } = require("./dataset-formats");
const { normalizeExportFormat, labelmeDocument, cocoDocument, yoloDocuments } = require("./export-formats");

function sendJson(res, data, code = 200) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

function sendError(res, code, message) {
  sendJson(res, { error: message }, code);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function psQuote(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function runFolderDialog(command, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, { windowsHide: true });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ status: "failed", selectedPath: "", error: "系统文件夹选择器打开超时" });
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ status: "unavailable", selectedPath: "", error: error.message }));
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) return finish({ status: "selected", selectedPath: stdout.trim(), error: "" });
      if (code === 1) return finish({ status: "cancelled", selectedPath: "", error: "" });
      finish({ status: "failed", selectedPath: "", error: stderr.trim() || `文件夹选择器退出码：${code}` });
    });
  });
}

async function selectFolder(defaultPath, description) {
  if (process.platform === "linux") {
    const initialDir = fs.existsSync(defaultPath || "") ? defaultPath : dataRoot;
    return runFolderDialog("zenity", [
      "--file-selection",
      "--directory",
      "--title",
      description || "选择数据文件夹",
      "--filename",
      path.join(initialDir, path.sep),
    ]);
  }

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = ${psQuote(description || "Select folder")}`,
      `$dialog.SelectedPath = ${psQuote(defaultPath || dataRoot)}`,
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath; exit 0 } else { exit 1 }",
    ].join("; ");
    return runFolderDialog("powershell.exe", ["-NoProfile", "-STA", "-Command", script]);
  }

  return { status: "unavailable", selectedPath: "", error: `暂不支持 ${process.platform} 系统文件夹选择器` };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxRequestBodyBytes) {
        tooLarge = true;
        const error = new Error(`请求体超过 ${maxRequestBodyBytes} 字节限制`);
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathMappings() {
  return [
    { internal: dataRoot, display: dataRootDisplay },
    { internal: browseRoot, display: browseRootDisplay },
  ];
}

function bestMappingFor(value, key) {
  const resolved = path.resolve(value || "");
  return pathMappings()
    .filter((mapping) => isInsideRoot(mapping[key], resolved))
    .sort((a, b) => b[key].length - a[key].length)[0] || null;
}

function toInternalDataPath(value) {
  const resolved = path.resolve(value || dataRoot);
  const internalMapping = bestMappingFor(resolved, "internal");
  if (internalMapping) return resolved;
  const displayMapping = bestMappingFor(resolved, "display");
  if (displayMapping) {
    const relative = path.relative(displayMapping.display, resolved);
    return path.resolve(displayMapping.internal, relative);
  }
  return resolved;
}

function toDisplayDataPath(value) {
  const resolved = path.resolve(value || dataRoot);
  const internalMapping = bestMappingFor(resolved, "internal");
  if (internalMapping) {
    const relative = path.relative(internalMapping.internal, resolved);
    return path.resolve(internalMapping.display, relative);
  }
  return resolved;
}

function toScopedInternalPath(value, internalRoot, displayRoot) {
  const resolved = path.resolve(value || displayRoot);
  if (isInsideRoot(internalRoot, resolved)) return resolved;
  if (isInsideRoot(displayRoot, resolved)) {
    return path.resolve(internalRoot, path.relative(displayRoot, resolved));
  }
  return resolved;
}

function listFolders(target, scope = "browse") {
  const root = scope === "data" ? dataRoot : browseRoot;
  const displayRoot = scope === "data" ? dataRootDisplay : browseRootDisplay;
  const current = toScopedInternalPath(target || displayRoot, root, displayRoot);
  if (!isInsideRoot(root, current)) throw httpError(403, `路径必须位于浏览根目录内：${displayRoot}`);
  const stat = fs.statSync(current);
  if (!stat.isDirectory()) throw httpError(400, "路径必须是文件夹");
  const dirs = fs.readdirSync(current, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(current, entry.name);
      return { name: entry.name, path: toDisplayDataPath(fullPath) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  const parent = current === root ? "" : path.dirname(current);
  return {
    root: displayRoot,
    current: toDisplayDataPath(current),
    parent: current === root || !isInsideRoot(root, parent) ? "" : toDisplayDataPath(parent),
    dirs,
  };
}

function imageObjectKey(sha256, ext) {
  return `objects/images/sha256/${sha256.slice(0, 2)}/${sha256}${ext}`;
}

function videoObjectKey(sha256, ext) {
  return `objects/videos/sha256/${sha256.slice(0, 2)}/${sha256}${ext}`;
}

function rawLabelObjectKey(projectId, versionId, name) {
  return `objects/raw-labels/${projectId}/${versionId}/${name}`;
}

function pythonEnvObjectKey(sha256, name) {
  const safeName = path.basename(name || `${sha256}.tar.gz`).replace(/[\\/:*?"<>|]/g, "_");
  return `envs/python/conda-pack/${sha256.slice(0, 2)}/${sha256}/${safeName}`;
}

function serverPythonEnvObjectKey(sha256) {
  return `envs/python/server-python/${sha256.slice(0, 2)}/${sha256}/metadata.json`;
}

function algorithmAssetPrefix(algorithmKey, version = "builtin") {
  const safeKey = cleanName(algorithmKey || "custom_algorithm", "algorithm").toLowerCase();
  const safeVersion = cleanName(version || "builtin", "version").toLowerCase();
  return `code-assets/algorithms/${safeKey}/${safeVersion}`;
}

function algorithmManifestKey(algorithmKey, version = "builtin") {
  return `${algorithmAssetPrefix(algorithmKey, version)}/manifest.json`;
}

function algorithmAdapterKey(algorithmKey, version = "builtin") {
  return `${algorithmAssetPrefix(algorithmKey, version)}/adapter.py`;
}

const builtinAlgorithmAssets = [
  {
    name: "Ultralytics YOLO",
    algorithmKey: "ultralytics_yolo",
    framework: "ultralytics",
    taskType: "detect",
    version: "builtin",
    tasks: ["detect", "segment", "classify"],
    description: "Ultralytics YOLO 通用训练和推理适配入口。",
    params: { conf: 0.25, iou: 0.7, imgsz: 640, batch: 16, device: "0", max_det: 300 },
    adapter: [
      "# Platform adapter placeholder for Ultralytics YOLO.",
      "# The dashboard stores this file as a code asset and uses the manifest to resolve runtime behavior.",
      "def run_inference(**kwargs):",
      "    raise NotImplementedError('Use server/postgres-app.js worker integration for the current prototype.')",
      "",
    ].join("\n"),
  },
  {
    name: "DINOv3 Faster R-CNN",
    algorithmKey: "dinov3_faster_rcnn",
    framework: "mmdetection",
    taskType: "detect",
    version: "builtin",
    tasks: ["detect"],
    description: "DINOv3 + Faster R-CNN 目录推理适配入口。",
    params: { scoreThr: 0.25, width: 1920, height: 1080, nmsAgnostic: false },
    adapter: "# Platform adapter placeholder for DINOv3 Faster R-CNN.\n",
  },
  {
    name: "RT-DETR",
    algorithmKey: "rtdetr",
    framework: "pytorch",
    taskType: "detect",
    version: "builtin",
    tasks: ["detect"],
    description: "RT-DETR 检测算法适配入口。",
    params: { conf: 0.25, imgsz: 640, device: "0" },
    adapter: "# Platform adapter placeholder for RT-DETR.\n",
  },
  {
    name: "空检测模型推理",
    algorithmKey: "dummy_empty_detector",
    framework: "builtin",
    taskType: "detect",
    version: "builtin",
    tasks: ["detect"],
    description: "平台内置空预测适配入口，用于打通推理链路。",
    params: {},
    adapter: "# Platform adapter placeholder for empty detector.\n",
  },
];

function uniqueExistingPaths(paths) {
  return Array.from(new Set(paths.filter(Boolean).map((item) => path.resolve(item)))).filter((item) => fs.existsSync(item));
}

function detectPythonVersion(pythonPath) {
  const result = spawnSync(pythonPath, ["--version"], { encoding: "utf8", timeout: 5000 });
  return String(result.stdout || result.stderr || "").trim();
}

function detectUltralytics(pythonPath) {
  const result = spawnSync(pythonPath, ["-c", "import importlib.util; print('yes' if importlib.util.find_spec('ultralytics') else 'no')"], { encoding: "utf8", timeout: 8000 });
  return String(result.stdout || "").trim() === "yes";
}

function inferPlatform(pythonPath) {
  const normalized = String(pythonPath || "").toLowerCase();
  const osType = normalized.includes("\\") || /^[a-z]:/.test(normalized) ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x86_64";
  return { osType, arch };
}

function inferEnvType(pythonPath) {
  const text = String(pythonPath || "").toLowerCase();
  if (text.includes("miniforge")) return "miniforge";
  return "conda";
}

function inspectPythonEnv(pythonPath) {
  const version = detectPythonVersion(pythonPath);
  const script = [
    "import json, importlib.util",
    "info={'ultralytics': bool(importlib.util.find_spec('ultralytics')), 'torch': False, 'torch_version': '', 'cuda_available': False, 'cuda_version': '', 'device_count': 0}",
    "spec=importlib.util.find_spec('torch')",
    "if spec:",
    "    import torch",
    "    info['torch']=True",
    "    info['torch_version']=getattr(torch, '__version__', '')",
    "    info['cuda_available']=bool(torch.cuda.is_available())",
    "    info['cuda_version']=getattr(torch.version, 'cuda', '') or ''",
    "    info['device_count']=torch.cuda.device_count() if torch.cuda.is_available() else 0",
    "print(json.dumps(info, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(pythonPath, ["-c", script], { encoding: "utf8", timeout: 30000 });
  let packages = {};
  try {
    packages = JSON.parse(String(result.stdout || "{}").trim() || "{}");
  } catch {
    packages = { ultralytics: detectUltralytics(pythonPath) };
  }
  const platform = inferPlatform(pythonPath);
  const accelerator = packages.cuda_available ? "cuda" : "cpu";
  const status = packages.ultralytics ? "ready" : "missing_ultralytics";
  return { version, packages, platform, accelerator, status };
}

function inspectCondaPackArchive(sourcePath, unpackPath, pythonPath) {
  const candidates = uniqueExistingPaths([
    pythonPath,
    path.join(unpackPath || "", "bin", "python"),
    path.join(unpackPath || "", "python.exe"),
    path.join(unpackPath || "", "Scripts", "python.exe"),
  ]);
  if (candidates[0]) {
    const info = inspectPythonEnv(candidates[0]);
    return { ...info, pythonPath: candidates[0], detectedFrom: "python" };
  }
  const lowerName = path.basename(sourcePath || "").toLowerCase();
  let listing = "";
  try {
    const result = spawnSync("tar", ["-tf", sourcePath], { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
    listing = String(result.stdout || "").toLowerCase();
  } catch {
    listing = "";
  }
  const text = `${lowerName}\n${listing}`;
  const osType = text.includes("scripts/python.exe") || text.includes("python.exe") || text.includes("win") ? "windows" : "linux";
  const arch = text.includes("aarch64") || text.includes("arm64") ? "arm64" : "x86_64";
  const accelerator = /\b(cuda|cu11|cu12|gpu|nvidia)\b/.test(text) ? "cuda" : "cpu";
  return {
    version: "",
    packages: { archive_inspected: Boolean(listing), cuda_available: accelerator === "cuda" },
    platform: { osType, arch },
    accelerator,
    status: "uploaded",
    pythonPath,
    detectedFrom: listing ? "archive" : "filename",
  };
}

async function seedMlRuntimeConfig() {
  const templateCount = (await query("SELECT count(*)::int AS count FROM training_templates")).rows[0].count;
  if (!templateCount) {
    await query(
      `INSERT INTO training_templates (name, template_key, framework, task_type, default_params_json, capabilities_json, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        "Ultralytics YOLO 通用训练",
        "ultralytics_yolo",
        "ultralytics",
        "detect",
        JSON.stringify({ epochs: 100, imgsz: 640, batch: 16, device: "0" }),
        JSON.stringify({ tasks: ["detect", "segment", "classify"], autoDetected: true }),
        "自动识别为支持 detect / segment / classify 的 Ultralytics YOLO 模板",
      ],
    );
  }
  await query(
    `UPDATE training_templates
     SET template_key='ultralytics_yolo',
         capabilities_json=$1,
         description=CASE WHEN description='' THEN $2 ELSE description END,
         updated_at=now()
     WHERE framework='ultralytics' AND (capabilities_json = '{}'::jsonb OR capabilities_json->'tasks' IS NULL)`,
    [JSON.stringify({ tasks: ["detect", "segment", "classify"], autoDetected: true }), "自动识别为支持 detect / segment / classify 的 Ultralytics YOLO 模板"],
  );
  const dinoTemplate = (await query("SELECT id FROM training_templates WHERE template_key=$1", ["dinov3_faster_rcnn"])).rows[0];
  if (!dinoTemplate) {
    await query(
      `INSERT INTO training_templates (name, template_key, framework, task_type, command_json, default_params_json, capabilities_json, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        "DINOv3 Faster R-CNN 推理",
        "dinov3_faster_rcnn",
        "mmdetection",
        "detect",
        JSON.stringify({
          script: "dinov3-faster-rcnn/tools/platform_infer.py",
          args: ["--image-dir", "{input.imagesDir}", "--manifest", "{input.manifestPath}", "--config", "{model.configPath}", "--checkpoint", "{model.checkpointPath}", "--out-dir", "{outputRoot}"],
        }),
        JSON.stringify({ scoreThr: 0.25, width: 1920, height: 1080, nmsAgnostic: false, outputFormats: ["json", "voc_xml"] }),
        JSON.stringify({ tasks: ["detect"], algorithmRole: "inference", input: "image_dir", output: ["predictions_json", "voc_xml"] }),
        "基于 MMDetection 的 DINOv3 + Faster R-CNN 目录推理入口，读取平台 input-cache/images 并输出 predictions.json/VOC XML。",
      ],
    );
  }
  const dummyTemplate = (await query("SELECT id FROM training_templates WHERE template_key=$1", ["dummy_empty_detector"])).rows[0];
  if (!dummyTemplate) {
    await query(
      `INSERT INTO training_templates (name, template_key, framework, task_type, command_json, default_params_json, capabilities_json, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        "空检测模型推理",
        "dummy_empty_detector",
        "builtin",
        "detect",
        JSON.stringify({ builtin: "empty_predictions" }),
        JSON.stringify({}),
        JSON.stringify({ tasks: ["detect"], algorithmRole: "inference", input: "manifest", output: ["predictions_json"] }),
        "平台内置空模型，用于打通推理流程：读取 input-cache/manifest.json，为每张图片输出空预测。",
      ],
    );
  }
  const dummyModel = (await query("SELECT * FROM model_clusters WHERE name=$1 AND deleted_at IS NULL", ["Dummy Empty Detector"])).rows[0];
  let dummyModelId = dummyModel?.id;
  if (!dummyModelId) {
    dummyModelId = (await query(
      `INSERT INTO model_clusters (name, task_type, framework, description)
       VALUES ($1,'detect','builtin',$2) RETURNING id`,
      ["Dummy Empty Detector", "平台内置空检测模型，用于测试推理任务、输入缓存和结果写回。"],
    )).rows[0].id;
  }
  const dummyVersion = (await query("SELECT id FROM model_revisions WHERE model_id=$1 AND version_name=$2", [dummyModelId, "empty_v1"])).rows[0];
  if (!dummyVersion) {
    await query(
      `INSERT INTO model_revisions (model_id, version_name, stage, params_json, artifact_root)
       VALUES ($1,'empty_v1','builtin',$2,$3)`,
      [dummyModelId, JSON.stringify({ templateKey: "dummy_empty_detector", emptyPredictions: true }), path.join(storageRoot, "runtime", "models", dummyModelId, "empty_v1")],
    );
  }
  const candidates = uniqueExistingPaths([
    process.env.PYTHON,
    "D:\\ProgramData\\miniforge3\\python.exe",
    "C:\\Python314\\python.exe",
    "python",
  ]);
  for (const pythonPath of candidates) {
    const info = inspectPythonEnv(pythonPath);
    const exists = (await query("SELECT id FROM runtime_envs WHERE python_path=$1", [pythonPath])).rows[0];
    if (exists) {
      await query(
        `UPDATE runtime_envs
         SET env_type=$1, status=$2, packages_json=$3, os_type=$4, arch=$5, accelerator=$6,
             python_version=$7, torch_version=$8, cuda_available=$9, cuda_version=$10,
             capabilities_json=$11, updated_at=now()
         WHERE id=$12`,
        [
          inferEnvType(pythonPath),
          info.status,
          JSON.stringify(info.packages),
          info.platform.osType,
          info.platform.arch,
          info.accelerator,
          info.version,
          info.packages.torch_version || "",
          Boolean(info.packages.cuda_available),
          info.packages.cuda_version || "",
          JSON.stringify({ ultralytics_detect: Boolean(info.packages.ultralytics), torch: Boolean(info.packages.torch) }),
          exists.id,
        ],
      );
      continue;
    }
    await query(
      `INSERT INTO runtime_envs (name, python_path, env_type, status, packages_json, os_type, arch, accelerator, python_version, torch_version, cuda_available, cuda_version, capabilities_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        info.version ? info.version.replace(/^Python\s*/i, "Python ") : path.basename(pythonPath),
        pythonPath,
        inferEnvType(pythonPath),
        info.status,
        JSON.stringify(info.packages),
        info.platform.osType,
        info.platform.arch,
        info.accelerator,
        info.version,
        info.packages.torch_version || "",
        Boolean(info.packages.cuda_available),
        info.packages.cuda_version || "",
        JSON.stringify({ ultralytics_detect: Boolean(info.packages.ultralytics), torch: Boolean(info.packages.torch) }),
      ],
    );
  }
}

async function ensureRuntimeSchema() {
  const statements = [
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT NOT NULL DEFAULT 'normal'",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES projects(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id)",
    "ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE project_images ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE label_versions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    `CREATE TABLE IF NOT EXISTS baseline_merge_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      baseline_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      source_project_ids UUID[] NOT NULL,
      params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'preview',
      summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      log_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS baseline_conflicts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merge_run_id UUID NOT NULL REFERENCES baseline_merge_runs(id) ON DELETE CASCADE,
      image_asset_id UUID NOT NULL REFERENCES image_assets(id),
      conflict_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      resolution TEXT NOT NULL DEFAULT '',
      preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS baseline_annotation_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merge_run_id UUID NOT NULL REFERENCES baseline_merge_runs(id) ON DELETE CASCADE,
      baseline_annotation_id UUID REFERENCES image_annotations(id) ON DELETE SET NULL,
      source_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_project_image_id UUID NOT NULL REFERENCES project_images(id) ON DELETE CASCADE,
      source_annotation_id UUID REFERENCES image_annotations(id) ON DELETE SET NULL,
      resolution_method TEXT NOT NULL DEFAULT '',
      annotation_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS model_clusters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'detect',
      framework TEXT NOT NULL DEFAULT 'ultralytics',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS dataset_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      label_version_id UUID REFERENCES label_versions(id) ON DELETE SET NULL,
      format TEXT NOT NULL DEFAULT 'yolo',
      split_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      path TEXT NOT NULL DEFAULT '',
      image_count INT NOT NULL DEFAULT 0,
      annotation_count INT NOT NULL DEFAULT 0,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_training_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
      dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      dataset_snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
      model_id UUID REFERENCES model_clusters(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INT NOT NULL DEFAULT 0,
      params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      progress INT NOT NULL DEFAULT 0,
      current_epoch INT NOT NULL DEFAULT 0,
      total_epochs INT NOT NULL DEFAULT 0,
      worker_id TEXT NOT NULL DEFAULT '',
      process_pid INT,
      heartbeat_at TIMESTAMPTZ,
      output_root TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_training_logs (
      id BIGSERIAL PRIMARY KEY,
      job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
      stream TEXT NOT NULL DEFAULT 'stdout',
      line TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_training_metrics (
      id BIGSERIAL PRIMARY KEY,
      job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
      step INT NOT NULL DEFAULT 0,
      epoch INT NOT NULL DEFAULT 0,
      key TEXT NOT NULL,
      value NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS model_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id UUID NOT NULL REFERENCES model_clusters(id) ON DELETE CASCADE,
      version_name TEXT NOT NULL,
      training_job_id UUID REFERENCES runtime_training_jobs(id) ON DELETE SET NULL,
      dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      dataset_snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
      stage TEXT NOT NULL DEFAULT 'candidate',
      metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      artifact_root TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS model_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_version_id UUID REFERENCES model_revisions(id) ON DELETE CASCADE,
      training_job_id UUID REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL,
      path TEXT NOT NULL,
      size BIGINT,
      sha256 TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_inference_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      model_version_id UUID REFERENCES model_revisions(id) ON DELETE SET NULL,
      dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      progress INT NOT NULL DEFAULT 0,
      output_root TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_inference_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inference_job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
      project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
      predictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      artifact_path TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS training_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      template_key TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
      framework TEXT NOT NULL DEFAULT 'ultralytics',
      task_type TEXT NOT NULL DEFAULT 'detect',
      command_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      default_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    "ALTER TABLE training_templates ADD COLUMN IF NOT EXISTS capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb",
    `CREATE TABLE IF NOT EXISTS runtime_envs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      python_path TEXT NOT NULL,
      env_type TEXT NOT NULL DEFAULT 'miniforge',
      os_type TEXT NOT NULL DEFAULT 'windows',
      arch TEXT NOT NULL DEFAULT 'x86_64',
      accelerator TEXT NOT NULL DEFAULT 'cpu',
      status TEXT NOT NULL DEFAULT 'unknown',
      python_version TEXT NOT NULL DEFAULT '',
      torch_version TEXT NOT NULL DEFAULT '',
      cuda_available BOOLEAN NOT NULL DEFAULT false,
      cuda_version TEXT NOT NULL DEFAULT '',
      packages_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS os_type TEXT NOT NULL DEFAULT 'windows'",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS arch TEXT NOT NULL DEFAULT 'x86_64'",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS accelerator TEXT NOT NULL DEFAULT 'cpu'",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS python_version TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS torch_version TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS cuda_available BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS cuda_version TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'server_python'",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS artifact_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS artifact_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS artifact_size BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS artifact_sha256 TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS unpack_path TEXT NOT NULL DEFAULT ''",
  ];
  const runtimeStatements = process.env.RUN_EXTENDED_SCHEMA === "true" ? statements : statements.slice(0, 6);
  await query("SET statement_timeout = '5000ms'");
  await query("SET lock_timeout = '2000ms'");
  for (let index = 0; index < runtimeStatements.length; index += 1) {
    const sql = runtimeStatements[index];
    try {
      console.log(`Schema ${index + 1}/${runtimeStatements.length}: ${sql.slice(0, 90).replace(/\s+/g, " ")}`);
      await query(sql);
    } catch (error) {
      // Existing runtime folders can contain partially-applied Postgres defaults.
      // Treat duplicate catalog/default entries as already migrated.
      if (error.code === "23505" && String(error.constraint || "").includes("pg_attrdef")) {
        console.warn("Skipping already-applied schema default:", sql.slice(0, 120));
        continue;
      }
      if (error.code === "57014") {
        console.warn("Skipping timed-out schema statement:", sql.slice(0, 120));
        continue;
      }
      if (error.code === "XX002") {
        console.warn("Skipping corrupted-catalog schema statement:", sql.slice(0, 120));
        continue;
      }
      throw error;
    }
  }
  if (process.env.RUN_EXTENDED_SCHEMA !== "true") {
    const mlRuntimeStatements = [
      `CREATE TABLE IF NOT EXISTS model_clusters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'detect',
        framework TEXT NOT NULL DEFAULT 'ultralytics',
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS dataset_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        label_version_id UUID REFERENCES label_versions(id) ON DELETE SET NULL,
        format TEXT NOT NULL DEFAULT 'yolo',
        split_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        path TEXT NOT NULL DEFAULT '',
        image_count INT NOT NULL DEFAULT 0,
        annotation_count INT NOT NULL DEFAULT 0,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS training_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        template_key TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
        framework TEXT NOT NULL DEFAULT 'ultralytics',
        task_type TEXT NOT NULL DEFAULT 'detect',
        command_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        default_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_envs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        python_path TEXT NOT NULL,
        env_type TEXT NOT NULL DEFAULT 'miniforge',
        os_type TEXT NOT NULL DEFAULT 'windows',
        arch TEXT NOT NULL DEFAULT 'x86_64',
        accelerator TEXT NOT NULL DEFAULT 'cpu',
        status TEXT NOT NULL DEFAULT 'unknown',
        python_version TEXT NOT NULL DEFAULT '',
        torch_version TEXT NOT NULL DEFAULT '',
        cuda_available BOOLEAN NOT NULL DEFAULT false,
        cuda_version TEXT NOT NULL DEFAULT '',
        packages_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_type TEXT NOT NULL DEFAULT 'server_python',
        artifact_key TEXT NOT NULL DEFAULT '',
        artifact_name TEXT NOT NULL DEFAULT '',
        artifact_size BIGINT NOT NULL DEFAULT 0,
        artifact_sha256 TEXT NOT NULL DEFAULT '',
        unpack_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS model_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_id UUID NOT NULL REFERENCES model_clusters(id) ON DELETE CASCADE,
        version_name TEXT NOT NULL,
        training_job_id UUID,
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        dataset_snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
        stage TEXT NOT NULL DEFAULT 'candidate',
        metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        artifact_root TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS model_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_version_id UUID REFERENCES model_revisions(id) ON DELETE CASCADE,
        training_job_id UUID,
        artifact_type TEXT NOT NULL,
        path TEXT NOT NULL,
        size BIGINT,
        sha256 TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        dataset_snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
        model_id UUID REFERENCES model_clusters(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INT NOT NULL DEFAULT 0,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        current_epoch INT NOT NULL DEFAULT 0,
        total_epochs INT NOT NULL DEFAULT 0,
        worker_id TEXT NOT NULL DEFAULT '',
        process_pid INT,
        heartbeat_at TIMESTAMPTZ,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_logs (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
        stream TEXT NOT NULL DEFAULT 'stdout',
        line TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_metrics (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
        step INT NOT NULL DEFAULT 0,
        epoch INT NOT NULL DEFAULT 0,
        key TEXT NOT NULL,
        value NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_inference_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        model_version_id UUID REFERENCES model_revisions(id) ON DELETE SET NULL,
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_inference_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inference_job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
        project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
        predictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        artifact_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ];
    const assetRuntimeStatements = [
      mlRuntimeStatements[0],
      `CREATE TABLE IF NOT EXISTS runtime_envs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        python_path TEXT NOT NULL,
        env_type TEXT NOT NULL DEFAULT 'server_python',
        os_type TEXT NOT NULL DEFAULT 'windows',
        arch TEXT NOT NULL DEFAULT 'x86_64',
        accelerator TEXT NOT NULL DEFAULT 'cpu',
        status TEXT NOT NULL DEFAULT 'unknown',
        python_version TEXT NOT NULL DEFAULT '',
        torch_version TEXT NOT NULL DEFAULT '',
        cuda_available BOOLEAN NOT NULL DEFAULT false,
        cuda_version TEXT NOT NULL DEFAULT '',
        packages_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_type TEXT NOT NULL DEFAULT 'server_python',
        artifact_key TEXT NOT NULL DEFAULT '',
        artifact_name TEXT NOT NULL DEFAULT '',
        artifact_size BIGINT NOT NULL DEFAULT 0,
        artifact_sha256 TEXT NOT NULL DEFAULT '',
        unpack_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS model_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_id UUID NOT NULL REFERENCES model_clusters(id) ON DELETE CASCADE,
        version_name TEXT NOT NULL,
        training_job_id UUID,
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        dataset_snapshot_id UUID,
        stage TEXT NOT NULL DEFAULT 'candidate',
        metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        artifact_root TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS model_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_version_id UUID REFERENCES model_revisions(id) ON DELETE CASCADE,
        training_job_id UUID,
        artifact_type TEXT NOT NULL,
        path TEXT NOT NULL,
        size BIGINT,
        sha256 TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS algorithm_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        algorithm_key TEXT NOT NULL,
        framework TEXT NOT NULL DEFAULT '',
        task_type TEXT NOT NULL DEFAULT 'detect',
        version TEXT NOT NULL DEFAULT 'builtin',
        source_type TEXT NOT NULL DEFAULT 'builtin',
        minio_prefix TEXT NOT NULL,
        manifest_key TEXT NOT NULL,
        adapter_key TEXT NOT NULL DEFAULT '',
        source_prefix TEXT NOT NULL DEFAULT '',
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        default_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ready',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        UNIQUE (algorithm_key, version)
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        dataset_snapshot_id UUID,
        model_id UUID REFERENCES model_clusters(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INT NOT NULL DEFAULT 0,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        current_epoch INT NOT NULL DEFAULT 0,
        total_epochs INT NOT NULL DEFAULT 0,
        worker_id TEXT NOT NULL DEFAULT '',
        process_pid INT,
        heartbeat_at TIMESTAMPTZ,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_logs (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
        stream TEXT NOT NULL DEFAULT 'stdout',
        line TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_metrics (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
        step INT NOT NULL DEFAULT 0,
        epoch INT NOT NULL DEFAULT 0,
        key TEXT NOT NULL,
        value NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_inference_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        model_version_id UUID REFERENCES model_revisions(id) ON DELETE SET NULL,
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_inference_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inference_job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
        project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
        predictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        artifact_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ];
    const enabledMlRuntimeStatements = process.env.RUN_ML_SCHEMA === "true" ? mlRuntimeStatements : assetRuntimeStatements;
    for (let index = 0; index < enabledMlRuntimeStatements.length; index += 1) {
      const sql = enabledMlRuntimeStatements[index];
      try {
        const tableMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/i);
        if (tableMatch) {
          const exists = await query("SELECT to_regclass($1) AS name", [tableMatch[1]]);
          if (exists.rows[0]?.name) {
            console.log(`ML schema ${index + 1}/${enabledMlRuntimeStatements.length}: skip existing ${tableMatch[1]}`);
            continue;
          }
        }
        console.log(`ML schema ${index + 1}/${enabledMlRuntimeStatements.length}: ${sql.slice(0, 90).replace(/\s+/g, " ")}`);
        await query(sql);
      } catch (error) {
        if (error.code === "57014") {
          console.warn("Skipping timed-out ML schema statement:", sql.slice(0, 120));
          continue;
        }
        if (error.code === "55P03") {
          console.warn("Skipping locked ML schema statement:", sql.slice(0, 120));
          continue;
        }
        if (error.code === "XX002") {
          console.warn("Skipping corrupted-catalog ML schema statement:", sql.slice(0, 120));
          continue;
        }
        throw error;
      }
    }
    if (process.env.RUN_ML_SCHEMA === "true") await seedMlRuntimeConfig();
  }
  if (process.env.RUN_EXTENDED_SCHEMA === "true") await seedMlRuntimeConfig();

}

async function backfillUnknownScenes() {
  const batches = (await query(
    `SELECT DISTINCT ib.id, ib.source_path
     FROM import_batches ib
     JOIN project_images pi ON pi.import_batch_id=ib.id
     WHERE pi.deleted_at IS NULL AND (pi.scene='' OR pi.scene='UnknownScene')`,
  )).rows;
  for (const batch of batches) {
    const sourcePath = toInternalDataPath(batch.source_path);
    const scene = await inferSceneFromImportRoot(sourcePath);
    if (!scene) continue;
    await query(
      `UPDATE project_images
       SET scene=$1
       WHERE import_batch_id=$2 AND deleted_at IS NULL AND (scene='' OR scene='UnknownScene')`,
      [scene, batch.id],
    );
  }
}

async function upsertImageAsset(client, filePath, meta = {}) {
  const stat = fs.statSync(filePath);
  const qh = quickHash(filePath);
  const sha = await hashFile(filePath);
  const ext = path.extname(filePath).toLowerCase() || ".jpg";
  let width = Number(meta.imageWidth) || null;
  let height = Number(meta.imageHeight) || null;
  if (!width || !height) {
    try {
      const imageMeta = await sharp(filePath).metadata();
      width = width || Number(imageMeta.width) || null;
      height = height || Number(imageMeta.height) || null;
    } catch {}
  }
  const existing = await client.query("SELECT * FROM image_assets WHERE sha256=$1", [sha]);
  if (existing.rows[0]) {
    let row = existing.rows[0];
    const storedSize = await store.objectSize(row.object_key);
    if (storedSize !== Number(row.file_size || stat.size)) await store.putFile(row.object_key, filePath);
    if ((!row.width && width) || (!row.height && height)) {
      row = (await client.query(
        "UPDATE image_assets SET width=COALESCE(width,$1), height=COALESCE(height,$2) WHERE id=$3 RETURNING *",
        [width, height, row.id],
      )).rows[0];
    }
    return row;
  }
  const objectKey = imageObjectKey(sha, ext);
  await store.putFile(objectKey, filePath);
  const inserted = await client.query(
    `INSERT INTO image_assets (sha256, quick_hash, object_key, original_ext, width, height, file_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [sha, qh, objectKey, ext, width, height, stat.size],
  );
  return inserted.rows[0];
}

async function upsertVideoAsset(client, filePath) {
  const stat = fs.statSync(filePath);
  const qh = quickHash(filePath);
  const sha = await hashFile(filePath);
  const ext = path.extname(filePath).toLowerCase() || ".mp4";
  const existing = await client.query("SELECT * FROM video_assets WHERE sha256=$1", [sha]);
  if (existing.rows[0]) return existing.rows[0];
  const objectKey = videoObjectKey(sha, ext);
  await store.putFile(objectKey, filePath);
  const inserted = await client.query(
    `INSERT INTO video_assets (sha256, quick_hash, object_key, original_ext, file_size)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [sha, qh, objectKey, ext, stat.size],
  );
  return inserted.rows[0];
}

async function createProject(body) {
  const rawName = String(body.name || `project_${Date.now()}`);
  const segments = rawName.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean);
  if (!segments.length) throw httpError(400, "项目名称不能为空");
  let parentId = body.parentId || body.parent_id || null;
  const originalParentId = parentId;
  const parentDepth = parentId ? await projectDepth(parentId) : 0;
  if (parentDepth + segments.length > 3) throw httpError(400, "项目文件夹最多支持 3 级");
  let project = null;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const shouldReuseFolder = segments.length > 1 && index < segments.length - 1;
    const existing = shouldReuseFolder ? (await query(
      "SELECT * FROM projects WHERE deleted_at IS NULL AND name=$1 AND parent_id IS NOT DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1",
      [segment, parentId],
    )).rows[0] : null;
    if (existing) {
      project = existing;
    } else {
      project = (await query(
        "INSERT INTO projects (name, description, project_type, parent_id) VALUES ($1,$2,$3,$4) RETURNING *",
        [segment, body.description || "", body.project_type || "normal", parentId],
      )).rows[0];
    }
    parentId = project.id;
  }
  if ((body.createDefaultSplits || body.create_default_splits) && !originalParentId && project?.id) {
    for (const splitName of ["train", "val", "test"]) {
      await query(
        `INSERT INTO projects (name, description, project_type, parent_id)
         SELECT $1, '', 'normal', $2
         WHERE NOT EXISTS (
           SELECT 1 FROM projects
           WHERE deleted_at IS NULL AND name=$1 AND parent_id IS NOT DISTINCT FROM $2
         )`,
        [splitName, project.id],
      );
    }
  }
  return project;
}

async function renameProject(projectId, body = {}) {
  const name = String(body.name || "").trim();
  if (!name) throw httpError(400, "文件夹名称不能为空");
  if (/[\\/]/.test(name)) throw httpError(400, "文件夹名称不能包含路径分隔符");
  const project = (await query("SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL", [projectId])).rows[0];
  if (!project) throw httpError(404, "项目或文件夹不存在");
  const duplicate = (await query(
    "SELECT id FROM projects WHERE deleted_at IS NULL AND id<>$1 AND name=$2 AND parent_id IS NOT DISTINCT FROM $3 LIMIT 1",
    [projectId, name, project.parent_id],
  )).rows[0];
  if (duplicate) throw httpError(409, "同级目录下已存在同名文件夹");
  const updated = await query("UPDATE projects SET name=$1, updated_at=now() WHERE id=$2 RETURNING *", [name, projectId]);
  return updated.rows[0];
}

async function projectDepth(projectId) {
  const result = await query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, 1 AS depth FROM projects WHERE id=$1 AND deleted_at IS NULL
       UNION ALL
       SELECT p.id, p.parent_id, ancestors.depth + 1
       FROM projects p
       JOIN ancestors ON ancestors.parent_id = p.id
       WHERE p.deleted_at IS NULL AND ancestors.depth < 3
     )
     SELECT count(*)::int AS depth FROM ancestors`,
    [projectId],
  );
  const depth = result.rows[0]?.depth || 0;
  if (!depth) throw httpError(400, "父级项目不存在");
  return depth;
}

async function softDeleteProjectTree(projectId) {
  await query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM projects WHERE id=$1
       UNION ALL
       SELECT p.id
       FROM projects p
       JOIN descendants ON p.parent_id = descendants.id
     )
     UPDATE projects SET deleted_at=now()
     WHERE id IN (SELECT id FROM descendants)`,
    [projectId],
  );
}

async function restoreProjectTree(projectId) {
  await query(
    `WITH RECURSIVE descendants AS (
       SELECT id, parent_id FROM projects WHERE id=$1
       UNION ALL
       SELECT p.id, p.parent_id
       FROM projects p
       JOIN descendants ON p.parent_id = descendants.id
     ),
     ancestors AS (
       SELECT id, parent_id FROM projects WHERE id=$1
       UNION ALL
       SELECT p.id, p.parent_id
       FROM projects p
       JOIN ancestors ON ancestors.parent_id = p.id
     ),
     affected AS (
       SELECT id FROM descendants
       UNION
       SELECT id FROM ancestors
     )
     UPDATE projects SET deleted_at=NULL
     WHERE id IN (SELECT id FROM affected)`,
    [projectId],
  );
}

async function listProjects(trash = false) {
  const result = await query(
    `SELECT p.*,
      (SELECT count(*)::int FROM project_images pi WHERE pi.project_id=p.id AND pi.deleted_at IS NULL) AS image_count,
      (SELECT count(*)::int FROM project_videos pv WHERE pv.project_id=p.id AND pv.deleted_at IS NULL) AS video_count,
      (SELECT count(*)::int FROM projects c WHERE c.parent_id=p.id AND c.deleted_at IS NULL) AS child_count,
      (SELECT max(created_at) FROM import_batches ib WHERE ib.project_id=p.id) AS last_import_at
     FROM projects p
     WHERE ${trash ? "p.deleted_at IS NOT NULL" : "p.deleted_at IS NULL"}
     ORDER BY p.created_at DESC`,
  );
  return result.rows;
}

async function importPath(body) {
  const projectId = body.projectId;
  if (!projectId) throw new Error("projectId is required");
  if (shuttingDown) {
    const error = new Error("服务正在关闭，暂不接受新的导入任务");
    error.statusCode = 503;
    throw error;
  }
  const sourcePath = toInternalDataPath(body.sourcePath || "");
  if (!sourcePath || !fs.existsSync(sourcePath)) throw httpError(400, "导入路径不存在");
  if (!fs.statSync(sourcePath).isDirectory()) throw httpError(400, "导入路径必须是文件夹");
  if (!isInsideRoot(dataRoot, sourcePath) && !isInsideRoot(browseRoot, sourcePath)) {
    throw httpError(403, `导入路径必须位于浏览根目录内：${browseRootDisplay}`);
  }
  body.sourcePath = sourcePath;

  const { project, batch } = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [String(projectId)]);
    const projectRow = (await client.query("SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL", [projectId])).rows[0];
    if (!projectRow) throw new Error("project not found");
    const active = (await client.query(
      "SELECT id FROM import_batches WHERE project_id=$1 AND deleted_at IS NULL AND status IN ('scanning','running','cancel_requested') LIMIT 1",
      [projectId],
    )).rows[0];
    if (active) {
      const error = new Error("该项目已有导入任务正在运行，请等待完成或先取消当前任务");
      error.statusCode = 409;
      throw error;
    }
    const batchRow = (await client.query(
      `INSERT INTO import_batches (project_id, source_path, import_mode, source_type, status, total_files, processed_files, message)
       VALUES ($1,$2,'merge_project','server_path','scanning',0,0,$3) RETURNING *`,
      [projectId, toDisplayDataPath(sourcePath), "正在扫描文件"],
    )).rows[0];
    return { project: projectRow, batch: batchRow };
  });

  setImmediate(() => {
    const task = runImportBatch(batch.id, project, body).catch(async (error) => {
      console.error("import failed", error);
      await query(
        "UPDATE import_batches SET status='failed', message=$1, finished_at=now() WHERE id=$2",
        [error.message || "导入失败", batch.id],
      ).catch(() => {});
    }).finally(() => activeImportTasks.delete(task));
    activeImportTasks.add(task);
  });

  return { project, batch };
}

async function importCancelled(batchId) {
  if (shuttingDown) return true;
  const row = (await query("SELECT status FROM import_batches WHERE id=$1", [batchId])).rows[0];
  return !row || row.status === "cancel_requested" || row.status === "cancelled" || row.status === "deleted";
}

async function cancelImport(importId) {
  await query(
    "UPDATE import_batches SET status='cancel_requested', message=$1 WHERE id=$2 AND status IN ('scanning','running')",
    ["正在取消导入", importId],
  );
}

async function runImportBatch(batchId, project, body) {
  const projectId = project.id;
  const sourcePath = path.resolve(body.sourcePath || "");
  let lastCancellationCheck = 0;
  let files;
  try {
    files = await walkAsync(sourcePath, {
      shouldStop: async () => {
        if (shuttingDown) return true;
        const now = Date.now();
        if (now - lastCancellationCheck < 500) return false;
        lastCancellationCheck = now;
        return importCancelled(batchId);
      },
    });
  } catch (error) {
    if (error.code !== "SCAN_CANCELLED") throw error;
    await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["导入已取消", batchId]);
    return;
  }
  const images = files.filter((file) => IMAGE_EXTS.has(path.extname(file).toLowerCase()));
  const videos = files.filter((file) => VIDEO_EXTS.has(path.extname(file).toLowerCase()));
  const { matches, unresolved, usedLabelFiles, formatCounts } = buildDatasetMatches({ files, images, sourceRoot: sourcePath });

  await query(
    "UPDATE import_batches SET status='running', total_files=$1, processed_files=0, message=$2 WHERE id=$3",
    [images.length + videos.length, `扫描完成：${images.length} 图片，${videos.length} 视频；LabelMe ${formatCounts.labelme}，COCO ${formatCounts.coco}，YOLO ${formatCounts.yolo}`, batchId],
  );
  if (await importCancelled(batchId)) {
    await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["导入已取消", batchId]);
    return;
  }

  const client = { query };
  const version = (await query(
    `INSERT INTO label_versions (project_id, name, target_type, status, import_batch_id)
     VALUES ($1,$2,'image','active',$3) RETURNING *`,
    [projectId, body.labelVersionName || `import_${new Date().toISOString()}`, batchId],
  )).rows[0];

  for (const labelFile of usedLabelFiles) {
    const relative = path.relative(sourcePath, labelFile).replace(/\.\.(?:[\\/]|$)/g, "").replace(/[\\/]+/g, "__");
    await store.putFile(rawLabelObjectKey(projectId, version.id, relative || path.basename(labelFile)), labelFile);
  }

  let imageCount = 0;
  let annCount = 0;
  let unlabeledImageCount = 0;
  for (const imageFile of images) {
    if (imageCount % 5 === 0 && await importCancelled(batchId)) {
      await query("UPDATE import_batches SET status='cancelled', processed_files=$1, message=$2, finished_at=now() WHERE id=$3", [imageCount, "导入已取消", batchId]);
      return;
    }
    const matched = matches.get(imageKey(imageFile));
    const meta = matched?.meta || {};
    const scene = inferSceneFromPath(meta, imageFile, sourcePath);
    const asset = await upsertImageAsset(client, imageFile, meta);
    const modality = inferModality(meta, imageFile);
    const displayName = body.rename
      ? `${cleanName(meta.view, "UnknownView")}_${cleanName(scene, "UnknownScene")}_${modality === "infrared" ? "IR" : "VIS"}_${String(imageCount + 1).padStart(6, "0")}${path.extname(imageFile).toLowerCase()}`
      : path.basename(imageFile);
    const projectImage = await upsertProjectImage(client, {
      projectId,
      imageAssetId: asset.id,
      importBatchId: batchId,
      displayName,
      scene,
      view: meta.view || "UnknownView",
      modality,
      keyword: meta.keyword || "",
    });
    const shapes = Array.isArray(meta.shapes) ? meta.shapes : [];
    if (!shapes.length) unlabeledImageCount += 1;
    for (const shape of shapes) {
      const box = shapeToBox(shape, asset.width, asset.height);
      if (!box) {
        unresolved.push({ labelFile: matched?.labelFile || "", reason: "invalid_shape", imageFile });
        continue;
      }
      await client.query(
        `INSERT INTO image_annotations
         (label_version_id, project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h, shape_type, difficult, score, attributes_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [version.id, projectImage.id, shape.label || "unknown", box.x, box.y, box.width, box.height, shape.shape_type || "rectangle", Boolean(shape.difficult), shape.score, shape.attributes || {}],
      );
      annCount += 1;
    }
    imageCount += 1;
    if (imageCount % 5 === 0 || imageCount === images.length) {
      await query("UPDATE import_batches SET processed_files=$1, message=$2 WHERE id=$3", [imageCount, `正在导入图片 ${imageCount} / ${images.length}`, batchId]);
    }
  }

  let videoCount = 0;
  for (const videoFile of videos) {
    if (await importCancelled(batchId)) {
      await query("UPDATE import_batches SET status='cancelled', processed_files=$1, message=$2, finished_at=now() WHERE id=$3", [images.length + videoCount, "导入已取消", batchId]);
      return;
    }
    const asset = await upsertVideoAsset(client, videoFile);
    await query(
      `INSERT INTO project_videos (project_id, video_asset_id, import_batch_id, display_name, label_status)
       VALUES ($1,$2,$3,$4,'unlabeled')`,
      [projectId, asset.id, batchId, path.basename(videoFile)],
    );
    videoCount += 1;
    await query("UPDATE import_batches SET processed_files=$1, message=$2 WHERE id=$3", [images.length + videoCount, `正在导入视频 ${videoCount} / ${videos.length}`, batchId]);
  }

  await query("UPDATE projects SET active_label_version_id=$1, updated_at=now() WHERE id=$2", [version.id, projectId]);
  const message = `导入完成：${imageCount} 图片，${unlabeledImageCount} 无目标图片，${videoCount} 视频，${annCount} 标注，${unresolved.length} 条警告；LabelMe ${formatCounts.labelme}，COCO ${formatCounts.coco}，YOLO ${formatCounts.yolo}`;
  await query("UPDATE import_batches SET status='done', processed_files=$1, message=$2, finished_at=now() WHERE id=$3", [images.length + videos.length, message, batchId]);
}

async function upsertProjectImage(client, image) {
  const params = [
    image.projectId,
    image.imageAssetId,
    image.importBatchId,
    image.displayName,
    image.scene,
    image.view,
    image.modality,
    image.keyword,
  ];
  const upsertSql = `
    INSERT INTO project_images (project_id, image_asset_id, import_batch_id, display_name, scene, view, modality, keyword)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (project_id, image_asset_id, display_name)
    DO UPDATE SET
      import_batch_id=EXCLUDED.import_batch_id,
      scene=EXCLUDED.scene,
      view=EXCLUDED.view,
      modality=EXCLUDED.modality,
      keyword=EXCLUDED.keyword,
      deleted_at=NULL
    RETURNING *`;
  try {
    return (await client.query(upsertSql, params)).rows[0];
  } catch (error) {
    if (error.code !== "23505" || error.constraint !== "idx_project_images_unique_asset") throw error;
    return (await client.query(
      `UPDATE project_images
       SET import_batch_id=$3,
           scene=$5,
           view=$6,
           modality=$7,
           keyword=$8,
           deleted_at=NULL
       WHERE project_id=$1 AND image_asset_id=$2 AND display_name=$4
       RETURNING *`,
      params,
    )).rows[0];
  }
}

async function listImports(projectId, trash = false) {
  const result = await query(
    `SELECT *,
      CASE WHEN total_files > 0 THEN round((processed_files::numeric / total_files::numeric) * 100)::int ELSE 0 END AS progress
     FROM import_batches
     WHERE project_id=$1 AND ${trash ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"}
     ORDER BY created_at DESC`,
    [projectId],
  );
  return result.rows;
}

async function softDeleteImport(importId) {
  await transaction(async (client) => {
    await client.query("UPDATE import_batches SET deleted_at=now(), status='deleted' WHERE id=$1", [importId]);
    await client.query("UPDATE project_images SET deleted_at=now() WHERE import_batch_id=$1", [importId]);
    await client.query("UPDATE project_videos SET deleted_at=now() WHERE import_batch_id=$1", [importId]);
    await client.query("UPDATE label_versions SET deleted_at=now(), status='archived' WHERE import_batch_id=$1", [importId]);
  });
}

async function restoreImport(importId) {
  await transaction(async (client) => {
    await client.query("UPDATE import_batches SET deleted_at=NULL, status='done' WHERE id=$1", [importId]);
    await client.query("UPDATE project_images SET deleted_at=NULL WHERE import_batch_id=$1", [importId]);
    await client.query("UPDATE project_videos SET deleted_at=NULL WHERE import_batch_id=$1", [importId]);
    await client.query("UPDATE label_versions SET deleted_at=NULL, status='active' WHERE import_batch_id=$1", [importId]);
  });
}

let shuttingDown = false;
const activeImportTasks = new Set();
const activeExportTasks = new Set();

async function cleanupUnreferencedAssets(client) {
  const images = await client.query(
    `DELETE FROM image_assets ia
     WHERE NOT EXISTS (SELECT 1 FROM project_images pi WHERE pi.image_asset_id=ia.id)
       AND NOT EXISTS (SELECT 1 FROM extracted_frames ef WHERE ef.image_asset_id=ia.id)
     RETURNING id, object_key`,
  );
  const videos = await client.query(
    `DELETE FROM video_assets va
     WHERE NOT EXISTS (SELECT 1 FROM project_videos pv WHERE pv.video_asset_id=va.id)
     RETURNING id, object_key`,
  );
  for (const row of [...images.rows, ...videos.rows]) await store.removeObject(row.object_key);
  return { image_assets: images.rowCount, video_assets: videos.rowCount };
}

async function emptyImportTrash(projectId) {
  return transaction(async (client) => {
    const batches = await client.query(
      "SELECT id FROM import_batches WHERE project_id=$1 AND deleted_at IS NOT NULL",
      [projectId],
    );
    const ids = batches.rows.map((row) => row.id);
    if (!ids.length) return { imports: 0, project_images: 0, project_videos: 0, label_versions: 0, image_assets: 0, video_assets: 0 };

    await client.query(
      `UPDATE projects
       SET active_label_version_id = (
         SELECT lv.id
         FROM label_versions lv
         WHERE lv.project_id=$1
           AND lv.deleted_at IS NULL
           AND (lv.import_batch_id IS NULL OR NOT (lv.import_batch_id = ANY($2::uuid[])))
         ORDER BY lv.created_at DESC
         LIMIT 1
       )
       WHERE id=$1
         AND active_label_version_id IN (
           SELECT id FROM label_versions WHERE import_batch_id = ANY($2::uuid[])
         )`,
      [projectId, ids],
    );
    const labelVersions = await client.query(
      "DELETE FROM label_versions WHERE import_batch_id = ANY($1::uuid[]) RETURNING id",
      [ids],
    );
    const images = await client.query(
      "DELETE FROM project_images WHERE import_batch_id = ANY($1::uuid[]) RETURNING id",
      [ids],
    );
    const videos = await client.query(
      "DELETE FROM project_videos WHERE import_batch_id = ANY($1::uuid[]) RETURNING id",
      [ids],
    );
    const imports = await client.query(
      "DELETE FROM import_batches WHERE id = ANY($1::uuid[]) RETURNING id",
      [ids],
    );
    const assets = await cleanupUnreferencedAssets(client);
    return { imports: imports.rowCount, project_images: images.rowCount, project_videos: videos.rowCount, label_versions: labelVersions.rowCount, ...assets };
  });
}

async function emptyProjectTrash() {
  return transaction(async (client) => {
    const projects = await client.query("SELECT id FROM projects WHERE deleted_at IS NOT NULL");
    const ids = projects.rows.map((row) => row.id);
    if (!ids.length) return { projects: 0, imports: 0, project_images: 0, project_videos: 0, label_versions: 0, image_assets: 0, video_assets: 0 };

    await client.query("UPDATE projects SET active_label_version_id=NULL WHERE id = ANY($1::uuid[])", [ids]);
    const labelVersions = await client.query("DELETE FROM label_versions WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
    const images = await client.query("DELETE FROM project_images WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
    const videos = await client.query("DELETE FROM project_videos WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
    const imports = await client.query("DELETE FROM import_batches WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
    const deletedProjects = await client.query("DELETE FROM projects WHERE id = ANY($1::uuid[]) RETURNING id", [ids]);
    const assets = await cleanupUnreferencedAssets(client);
    return { projects: deletedProjects.rowCount, imports: imports.rowCount, project_images: images.rowCount, project_videos: videos.rowCount, label_versions: labelVersions.rowCount, ...assets };
  });
}

async function softDeleteProjectImages(projectId, ids = []) {
  const uniqueIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
  if (!uniqueIds.length) return { deleted: 0 };
  const result = await query(
    `UPDATE project_images
     SET deleted_at=now()
     WHERE project_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
     RETURNING id`,
    [projectId, uniqueIds],
  );
  return { deleted: result.rows.length };
}

function bboxIou(a, b) {
  const ax1 = Number(a.bbox_x || 0);
  const ay1 = Number(a.bbox_y || 0);
  const ax2 = ax1 + Number(a.bbox_w || 0);
  const ay2 = ay1 + Number(a.bbox_h || 0);
  const bx1 = Number(b.bbox_x || 0);
  const by1 = Number(b.bbox_y || 0);
  const bx2 = bx1 + Number(b.bbox_w || 0);
  const by2 = by1 + Number(b.bbox_h || 0);
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = ix * iy;
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  return inter / Math.max(1, areaA + areaB - inter);
}

function normalizeLabel(label, mapping = {}) {
  const key = String(label || "unknown").trim() || "unknown";
  return mapping[key] || key;
}

async function sourceImageRows(sourceProjectIds) {
  const rows = await query(
    `SELECT pi.*, ia.sha256, ia.width AS image_width, ia.height AS image_height, ia.original_ext,
            p.name AS project_name, p.active_label_version_id
     FROM project_images pi
     JOIN image_assets ia ON ia.id=pi.image_asset_id
     JOIN projects p ON p.id=pi.project_id
     WHERE pi.project_id = ANY($1::uuid[]) AND pi.deleted_at IS NULL AND p.deleted_at IS NULL
     ORDER BY pi.created_at`,
    [sourceProjectIds],
  );
  const images = rows.rows;
  if (!images.length) return [];
  const anns = await query(
    `SELECT a.*
     FROM image_annotations a
     JOIN projects p ON p.active_label_version_id=a.label_version_id
     WHERE p.id = ANY($1::uuid[]) AND a.project_image_id = ANY($2::uuid[])
     ORDER BY a.id`,
    [sourceProjectIds, images.map((row) => row.id)],
  );
  const byImage = new Map();
  for (const ann of anns.rows) {
    const key = String(ann.project_image_id);
    if (!byImage.has(key)) byImage.set(key, []);
    byImage.get(key).push(ann);
  }
  return images.map((row) => ({ ...row, annotations: byImage.get(String(row.id)) || [] }));
}

function analyzeImageGroup(rows, params) {
  const iouSame = Number(params.iouSame ?? 0.9);
  const iouLight = Number(params.iouLight ?? 0.75);
  const labelMap = params.labelMap || {};
  const priority = params.sourcePriority || [];
  const priorityIndex = (projectId) => {
    const index = priority.indexOf(projectId);
    return index >= 0 ? index : 9999;
  };
  const sorted = [...rows].sort((a, b) => priorityIndex(a.project_id) - priorityIndex(b.project_id) || String(a.project_id).localeCompare(String(b.project_id)));
  const chosenRow = sorted[0];
  const all = rows.flatMap((row) => row.annotations.map((ann) => ({ ...ann, source_project_id: row.project_id, source_project_name: row.project_name, source_project_image_id: row.id })));
  const normalized = all.map((ann) => ({ ...ann, normalized_label: normalizeLabel(ann.label, labelMap) }));
  const chosen = normalized.filter((ann) => String(ann.source_project_id) === String(chosenRow.project_id));
  let conflictType = "";
  let severity = "low";
  let autoResolved = true;
  const log = [];

  if (!normalized.length) {
    log.push("无标注图片，保留图片但不生成标注");
    return { chosenRow, annotations: [], conflictType: "", severity: "low", autoResolved: true, log };
  }
  const counts = new Map(rows.map((row) => [row.project_id, row.annotations.length]));
  if (new Set(counts.values()).size > 1) {
    conflictType = "count_conflict";
    severity = "high";
    autoResolved = false;
    log.push("不同来源目标数量不一致");
  }
  for (const ann of normalized) {
    const best = chosen.reduce((acc, item) => {
      const iou = bboxIou(ann, item);
      return iou > acc.iou ? { iou, item } : acc;
    }, { iou: 0, item: null });
    if (best.item && best.iou >= iouSame && ann.normalized_label !== best.item.normalized_label) {
      conflictType ||= "label_conflict";
      severity = "high";
      autoResolved = false;
      log.push(`同位置类别不一致：${ann.label} / ${best.item.label}`);
    } else if (best.item && best.iou >= iouLight && best.iou < iouSame && ann.normalized_label === best.item.normalized_label) {
      conflictType ||= "bbox_conflict";
      severity = severity === "high" ? "high" : "medium";
      log.push(`轻微框偏差：${ann.normalized_label} IoU=${best.iou.toFixed(2)}`);
    }
  }
  if (!conflictType && rows.length > 1) log.push("多来源标注一致，按来源优先级保留");
  return { chosenRow, annotations: chosen, conflictType, severity, autoResolved, log };
}

function applyConflictDecision(group, params, conflict) {
  if (!conflict?.resolution?.startsWith("source_project:")) return analyzeImageGroup(group, params);
  const sourceProjectId = conflict.resolution.split(":")[1];
  const chosenRow = group.find((row) => String(row.project_id) === sourceProjectId) || group[0];
  const labelMap = params.labelMap || {};
  const annotations = chosenRow.annotations.map((ann) => ({
    ...ann,
    source_project_id: chosenRow.project_id,
    source_project_name: chosenRow.project_name,
    source_project_image_id: chosenRow.id,
    normalized_label: normalizeLabel(ann.label, labelMap),
  }));
  return {
    chosenRow,
    annotations,
    conflictType: conflict.conflict_type,
    severity: conflict.severity,
    autoResolved: false,
    log: [`人工选择保留来源：${chosenRow.project_name}`],
  };
}

async function listBaselineConflicts(runId) {
  const result = await query(
    `SELECT bc.*, ia.width AS image_width, ia.height AS image_height, ia.object_key
     FROM baseline_conflicts bc
     JOIN image_assets ia ON ia.id=bc.image_asset_id
     WHERE bc.merge_run_id=$1
     ORDER BY bc.created_at, bc.id`,
    [runId],
  );
  return result.rows;
}

async function resolveBaselineConflicts(runId, body = {}) {
  const ids = Array.from(new Set((body.conflictIds || []).map(String).filter(Boolean)));
  if (!ids.length) return { updated: 0 };
  const resolution = String(body.resolution || "pending");
  const status = body.status || (resolution === "pending" ? "pending" : "resolved");
  const result = await query(
    `UPDATE baseline_conflicts
     SET status=$1, resolution=$2
     WHERE merge_run_id=$3 AND id = ANY($4::uuid[])
     RETURNING id`,
    [status, resolution, runId, ids],
  );
  return { updated: result.rowCount };
}

async function createBaselinePreview(body = {}) {
  const sourceProjectIds = Array.from(new Set((body.sourceProjectIds || []).map(String).filter(Boolean)));
  if (sourceProjectIds.length < 1) throw new Error("请选择至少一个来源项目");
  const params = {
    iouSame: Number(body.iouSame ?? 0.9),
    iouLight: Number(body.iouLight ?? 0.75),
    sourcePriority: body.sourcePriority?.length ? body.sourcePriority : sourceProjectIds,
    labelMap: body.labelMap || {},
  };
  const rows = await sourceImageRows(sourceProjectIds);
  const byAsset = new Map();
  for (const row of rows) {
    const key = String(row.image_asset_id);
    if (!byAsset.has(key)) byAsset.set(key, []);
    byAsset.get(key).push(row);
  }
  const run = await query(
    `INSERT INTO baseline_merge_runs (name, source_project_ids, params_json, status)
     VALUES ($1,$2,$3,'preview') RETURNING *`,
    [body.name || `baseline_${new Date().toISOString()}`, sourceProjectIds, JSON.stringify(params)],
  );
  const runId = run.rows[0].id;
  const summary = { source_projects: sourceProjectIds.length, source_images: rows.length, unique_images: byAsset.size, auto_resolved: 0, conflicts: 0, annotations_kept: 0, by_type: {} };
  const logs = [];
  for (const group of byAsset.values()) {
    const analysis = analyzeImageGroup(group, params);
    summary.annotations_kept += analysis.annotations.length;
    if (analysis.conflictType) {
      summary.conflicts += 1;
      summary.by_type[analysis.conflictType] = (summary.by_type[analysis.conflictType] || 0) + 1;
      await query(
        `INSERT INTO baseline_conflicts (merge_run_id, image_asset_id, conflict_type, severity, preview_json)
         VALUES ($1,$2,$3,$4,$5)`,
        [runId, group[0].image_asset_id, analysis.conflictType, analysis.severity, JSON.stringify({ sources: group.map((row) => ({ project_id: row.project_id, project_name: row.project_name, image_id: row.id, annotations: row.annotations.length })), log: analysis.log })],
      );
    } else {
      summary.auto_resolved += 1;
    }
    logs.push(...analysis.log.slice(0, 5));
  }
  await query("UPDATE baseline_merge_runs SET summary_json=$1, log_json=$2 WHERE id=$3", [JSON.stringify(summary), JSON.stringify(logs.slice(0, 200)), runId]);
  return { runId, summary, logs: logs.slice(0, 200) };
}

async function applyBaselineRun(runId, body = {}) {
  const run = (await query("SELECT * FROM baseline_merge_runs WHERE id=$1", [runId])).rows[0];
  if (!run) throw new Error("baseline run not found");
  if (run.status === "applied") throw new Error("baseline run already applied");
  const sourceProjectIds = run.source_project_ids;
  const params = run.params_json || {};
  const rows = await sourceImageRows(sourceProjectIds);
  const byAsset = new Map();
  for (const row of rows) {
    const key = String(row.image_asset_id);
    if (!byAsset.has(key)) byAsset.set(key, []);
    byAsset.get(key).push(row);
  }
  return transaction(async (client) => {
    const decisions = await client.query("SELECT * FROM baseline_conflicts WHERE merge_run_id=$1", [runId]);
    const decisionByAsset = new Map(decisions.rows.map((row) => [String(row.image_asset_id), row]));
    const project = (await client.query(
      "INSERT INTO projects (name, description, project_type) VALUES ($1,$2,'baseline') RETURNING *",
      [body.name || run.name, `Baseline generated from ${sourceProjectIds.length} projects`],
    )).rows[0];
    const version = (await client.query(
      "INSERT INTO label_versions (project_id, name, target_type, status) VALUES ($1,$2,'image','active') RETURNING *",
      [project.id, "baseline_v1"],
    )).rows[0];
    let imageCount = 0;
    let annCount = 0;
    for (const group of byAsset.values()) {
      const analysis = applyConflictDecision(group, params, decisionByAsset.get(String(group[0].image_asset_id)));
      const source = analysis.chosenRow;
      const pi = (await client.query(
        `INSERT INTO project_images (project_id, image_asset_id, display_name, scene, view, modality, keyword)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (project_id, image_asset_id, display_name) DO UPDATE SET deleted_at=NULL
         RETURNING *`,
        [project.id, source.image_asset_id, source.display_name, source.scene, source.view, source.modality, source.keyword],
      )).rows[0];
      imageCount += 1;
      for (const ann of analysis.annotations) {
        const saved = (await client.query(
          `INSERT INTO image_annotations
           (label_version_id, project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h, shape_type, difficult, score, attributes_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [version.id, pi.id, ann.normalized_label || ann.label || "unknown", ann.bbox_x, ann.bbox_y, ann.bbox_w, ann.bbox_h, ann.shape_type || "rectangle", Boolean(ann.difficult), ann.score, ann.attributes_json || {}],
        )).rows[0];
        await client.query(
          `INSERT INTO baseline_annotation_sources
           (merge_run_id, baseline_annotation_id, source_project_id, source_project_image_id, source_annotation_id, resolution_method, annotation_snapshot_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [runId, saved.id, ann.source_project_id, ann.source_project_image_id, ann.id, analysis.conflictType ? "source_priority" : "auto_consistent", ann],
        );
        annCount += 1;
      }
    }
    await client.query("UPDATE projects SET active_label_version_id=$1, updated_at=now() WHERE id=$2", [version.id, project.id]);
    await client.query("UPDATE baseline_merge_runs SET baseline_project_id=$1, status='applied', applied_at=now() WHERE id=$2", [project.id, runId]);
    return { project, imageCount, annotationCount: annCount };
  });
}

async function listMlModels() {
  try {
    const rows = await query(
      `SELECT m.*,
        (SELECT count(*)::int FROM model_revisions mv WHERE mv.model_id=m.id) AS version_count,
        (SELECT max(mv.created_at) FROM model_revisions mv WHERE mv.model_id=m.id) AS last_version_at
       FROM model_clusters m
       WHERE m.deleted_at IS NULL
       ORDER BY m.created_at DESC`,
    );
    return rows.rows;
  } catch (error) {
    if (error.code !== "42P01") throw error;
    const rows = await query(
      `SELECT m.*, 0::int AS version_count, NULL::timestamptz AS last_version_at
       FROM model_clusters m
       WHERE m.deleted_at IS NULL
       ORDER BY m.created_at DESC`,
    );
    return rows.rows;
  }
}

async function createMlModel(body = {}) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("模型名称不能为空");
  const taskType = String(body.taskType || body.task_type || "detect").trim() || "detect";
  const framework = String(body.framework || "ultralytics").trim() || "ultralytics";
  const description = String(body.description || "").trim();
  const rows = await query(
    `INSERT INTO model_clusters (name, task_type, framework, description)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, taskType, framework, description],
  );
  return rows.rows[0];
}

function dateCode() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function nextModelVersionName(prefix, modelId) {
  const base = cleanName(prefix, "version");
  const like = `${base}_%`;
  const rows = await query("SELECT count(*)::int AS count FROM model_revisions WHERE model_id=$1 AND version_name LIKE $2", [modelId, like]);
  return `${base}_${String((rows.rows[0]?.count || 0) + 1).padStart(3, "0")}`;
}

async function createModelVersion(body = {}) {
  const modelId = body.modelId || body.model_id;
  if (!modelId) throw new Error("请选择模型簇");
  const model = (await query("SELECT * FROM model_clusters WHERE id=$1 AND deleted_at IS NULL", [modelId])).rows[0];
  if (!model) throw new Error("模型簇不存在");
  const stage = String(body.stage || "pretrained").trim();
  const sourcePath = String(body.sourcePath || body.source_path || "").trim();
  const params = body.params || {};
  const defaultPrefix = `${stage === "pretrained" ? "pretrain" : stage}_${model.name}_${dateCode()}`;
  const versionName = String(body.versionName || body.version_name || await nextModelVersionName(defaultPrefix, model.id)).trim();
  const artifactRoot = path.join(storageRoot, "runtime", "models", model.id, versionName);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const version = (await query(
    `INSERT INTO model_revisions (model_id, version_name, stage, params_json, artifact_root)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [model.id, versionName, stage, JSON.stringify(params), artifactRoot],
  )).rows[0];
  if (sourcePath) {
    if (!fs.existsSync(sourcePath)) throw new Error("权重文件不存在");
    const ext = path.extname(sourcePath).toLowerCase() || ".pt";
    const target = path.join(artifactRoot, `weights${ext}`);
    fs.copyFileSync(sourcePath, target);
    const objectKey = `ml/artifacts/models/${model.id}/${version.id}/weights${ext}`;
    await store.putFile(objectKey, target);
    const stat = fs.statSync(target);
    const sha = await hashFile(target).catch(() => null);
    await query(
      `INSERT INTO model_files (model_version_id, artifact_type, path, size, sha256, metadata_json)
       VALUES ($1,'weights',$2,$3,$4,$5)`,
      [version.id, objectKey, stat.size, sha, JSON.stringify({ localPath: target, sourcePath })],
    );
  }
  return version;
}

async function renameModelVersion(versionId, body = {}) {
  const name = String(body.versionName || body.version_name || "").trim();
  if (!name) throw new Error("版本名不能为空");
  const rows = await query("UPDATE model_revisions SET version_name=$1 WHERE id=$2 RETURNING *", [name, versionId]);
  if (!rows.rows[0]) throw new Error("模型版本不存在");
  return rows.rows[0];
}

async function listDatasetSnapshots() {
  const rows = await query(
    `SELECT ds.*, p.name AS source_project_name
     FROM dataset_snapshots ds
     LEFT JOIN projects p ON p.id=ds.source_project_id
     ORDER BY ds.created_at DESC
     LIMIT 200`,
  );
  return rows.rows;
}

async function listTrainingTemplates() {
  try {
    return (await query("SELECT * FROM training_templates ORDER BY created_at DESC")).rows;
  } catch (error) {
    if (error.code !== "42P01") throw error;
    return builtinAlgorithmAssets.map((asset) => ({
      id: `builtin-${asset.algorithmKey}`,
      name: asset.name,
      template_key: asset.algorithmKey,
      framework: asset.framework,
      task_type: asset.taskType,
      capabilities_json: { tasks: asset.tasks, builtin: true },
    }));
  }
}

function algorithmManifest(asset) {
  return {
    name: asset.name,
    algorithmKey: asset.algorithmKey,
    framework: asset.framework,
    version: asset.version || "builtin",
    tasks: asset.tasks || [asset.taskType || "detect"],
    entry: { type: "python", adapter: "adapter.py", function: "run_inference" },
    inputs: { imageDir: true, manifest: true, modelWeights: true },
    outputs: { predictionsJson: true, visualizations: true, labelmeJson: true },
    params: asset.params || {},
    description: asset.description || "",
  };
}

async function ensureBuiltinAlgorithmAssets() {
  for (const asset of builtinAlgorithmAssets) {
    const version = asset.version || "builtin";
    const minioPrefix = algorithmAssetPrefix(asset.algorithmKey, version);
    const manifestKey = algorithmManifestKey(asset.algorithmKey, version);
    const adapterKey = algorithmAdapterKey(asset.algorithmKey, version);
    const manifest = algorithmManifest(asset);
    await store.putJson(manifestKey, manifest);
    await store.putText(adapterKey, asset.adapter || "", "text/x-python");
    await query(
      `INSERT INTO algorithm_assets
       (name, algorithm_key, framework, task_type, version, source_type, minio_prefix, manifest_key, adapter_key, source_prefix, capabilities_json, default_params_json, description, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ready')
       ON CONFLICT (algorithm_key, version) DO UPDATE SET
         name=EXCLUDED.name,
         framework=EXCLUDED.framework,
         task_type=EXCLUDED.task_type,
         minio_prefix=EXCLUDED.minio_prefix,
         manifest_key=EXCLUDED.manifest_key,
         adapter_key=EXCLUDED.adapter_key,
         capabilities_json=EXCLUDED.capabilities_json,
         default_params_json=EXCLUDED.default_params_json,
         description=EXCLUDED.description,
         status='ready',
         deleted_at=NULL,
         updated_at=now()`,
      [
        asset.name,
        asset.algorithmKey,
        asset.framework,
        asset.taskType || "detect",
        version,
        "builtin",
        minioPrefix,
        manifestKey,
        adapterKey,
        `${minioPrefix}/source/`,
        JSON.stringify({ tasks: asset.tasks || [asset.taskType || "detect"], builtin: true }),
        JSON.stringify(asset.params || {}),
        asset.description || "",
      ],
    );
  }
}

async function listAlgorithmAssets() {
  try {
    await ensureBuiltinAlgorithmAssets();
    const rows = await query(
      `SELECT * FROM algorithm_assets
       WHERE deleted_at IS NULL
       ORDER BY source_type='builtin' DESC, name, version`,
    );
    return rows.rows;
  } catch (error) {
    if (!["42P01", "XX002", "57014"].includes(error.code)) throw error;
    return builtinAlgorithmAssets.map((asset) => ({
      id: `builtin-${asset.algorithmKey}`,
      name: asset.name,
      algorithm_key: asset.algorithmKey,
      framework: asset.framework,
      task_type: asset.taskType,
      version: asset.version || "builtin",
      source_type: "builtin",
      minio_prefix: algorithmAssetPrefix(asset.algorithmKey, asset.version),
      manifest_key: algorithmManifestKey(asset.algorithmKey, asset.version),
      adapter_key: algorithmAdapterKey(asset.algorithmKey, asset.version),
      capabilities_json: { tasks: asset.tasks, builtin: true },
      default_params_json: asset.params || {},
      description: asset.description,
      status: "ready",
    }));
  }
}

function templateCapabilities(body = {}) {
  const raw = body.capabilities || body.capabilities_json || {};
  if (Array.isArray(raw.tasks) && raw.tasks.length) {
    return { ...raw, tasks: raw.tasks.filter((task) => ["detect", "segment", "classify"].includes(task)) };
  }
  const key = String(body.templateKey || body.template_key || "").toLowerCase();
  const framework = String(body.framework || "").toLowerCase();
  if (framework === "ultralytics" || key.includes("ultralytics") || key.includes("yolo")) {
    return { tasks: ["detect", "segment", "classify"], autoDetected: true };
  }
  return { tasks: [body.taskType || body.task_type || "detect"], autoDetected: false };
}

async function createTrainingTemplate(body = {}) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("模板名称不能为空");
  const capabilities = templateCapabilities(body);
  const taskType = capabilities.tasks?.[0] || body.taskType || body.task_type || "detect";
  const rows = await query(
    `INSERT INTO training_templates (name, template_key, framework, task_type, command_json, default_params_json, capabilities_json, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      name,
      body.templateKey || body.template_key || "ultralytics_yolo",
      body.framework || "ultralytics",
      taskType,
      JSON.stringify(body.command || body.command_json || {}),
      JSON.stringify(body.defaultParams || body.default_params_json || {}),
      JSON.stringify(capabilities),
      body.description || "",
    ],
  );
  return rows.rows[0];
}

async function listPythonEnvs() {
  return (await query("SELECT * FROM runtime_envs ORDER BY os_type, arch, accelerator DESC, status='ready' DESC, created_at DESC")).rows;
}

async function createPythonEnv(body = {}) {
  const sourceType = body.sourceType || body.source_type || "server_python";
  if (sourceType === "conda_pack") {
    const sourcePath = path.resolve(String(body.condaPackPath || body.conda_pack_path || body.sourcePath || body.source_path || "").trim());
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("conda-pack 环境包路径不存在");
    if (!isInsideRoot(dataRoot, sourcePath) && !isInsideRoot(storageRoot, sourcePath)) throw new Error(`conda-pack 环境包必须位于 ${dataRoot} 或 ${storageRoot} 内`);
    const stat = fs.statSync(sourcePath);
    const sha = await hashFile(sourcePath);
    const artifactKey = pythonEnvObjectKey(sha, path.basename(sourcePath));
    await store.putFile(artifactKey, sourcePath, { "x-amz-meta-source": "conda-pack" });
    const unpackPath = String(body.unpackPath || body.unpack_path || path.join(storageRoot, "runtime", "python-envs", sha.slice(0, 12))).trim();
    const defaultPython = process.platform === "win32" ? path.join(unpackPath, "python.exe") : path.join(unpackPath, "bin", "python");
    const requestedPythonPath = String(body.pythonPath || body.python_path || defaultPython).trim();
    const info = inspectCondaPackArchive(sourcePath, unpackPath, requestedPythonPath);
    const pythonPath = info.pythonPath || requestedPythonPath;
    const platform = info.platform;
    const accelerator = info.accelerator;
    const capabilities = {
      source_type: "conda_pack",
      artifact_key: artifactKey,
      tasks: body.tasks || ["detect", "segment", "classify"],
      detected_from: info.detectedFrom,
      auto_detected: true,
    };
    const rows = await query(
      `INSERT INTO runtime_envs
       (name, python_path, env_type, os_type, arch, accelerator, status, python_version, torch_version, cuda_available, cuda_version,
        packages_json, capabilities_json, source_type, artifact_key, artifact_name, artifact_size, artifact_sha256, unpack_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [
        body.name || path.basename(sourcePath).replace(/\.(tar\.gz|tgz)$/i, ""),
        pythonPath,
        "conda-pack",
        platform.osType,
        platform.arch,
        accelerator,
        info.status,
        info.version,
        info.packages.torch_version || "",
        Boolean(info.packages.cuda_available),
        info.packages.cuda_version || "",
        JSON.stringify({ sourcePath, packages: info.packages }),
        JSON.stringify(capabilities),
        "conda_pack",
        artifactKey,
        path.basename(sourcePath),
        stat.size,
        sha,
        unpackPath,
      ],
    );
    return rows.rows[0];
  }

  const pythonPath = path.resolve(String(body.pythonPath || body.python_path || "").trim());
  if (!pythonPath || !fs.existsSync(pythonPath)) throw new Error("Python 解释器路径不存在");
  const info = inspectPythonEnv(pythonPath);
  const envType = inferEnvType(pythonPath);
  const osType = info.platform.osType;
  const arch = info.platform.arch;
  const accelerator = info.accelerator;
  const metadata = {
    sourceType: "server_python",
    recommendedSourceType: body.preferCondaPack ? "conda_pack" : "server_python",
    assetPolicy: body.preferCondaPack ? "建议使用 conda-pack 环境包统一入 MinIO；服务器 Python 路径用于快速检测和临时登记。" : "服务器 Python 路径登记",
    pythonPath,
    envType,
    osType,
    arch,
    accelerator,
    inspectedAt: new Date().toISOString(),
    version: info.version,
    packages: info.packages,
    capabilities: { ultralytics_detect: Boolean(info.packages.ultralytics), torch: Boolean(info.packages.torch) },
  };
  const sha = crypto.createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
  const artifactKey = serverPythonEnvObjectKey(sha);
  await store.putJson(artifactKey, metadata);
  const artifactSize = Buffer.byteLength(JSON.stringify(metadata), "utf8");
  const rows = await query(
    `INSERT INTO runtime_envs
     (name, python_path, env_type, os_type, arch, accelerator, status, python_version, torch_version, cuda_available, cuda_version,
      packages_json, capabilities_json, source_type, artifact_key, artifact_name, artifact_size, artifact_sha256, unpack_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [
      body.name || info.version || path.basename(pythonPath),
      pythonPath,
      envType,
      osType,
      arch,
      accelerator,
      info.status,
      info.version,
      info.packages.torch_version || "",
      Boolean(info.packages.cuda_available),
      info.packages.cuda_version || "",
      JSON.stringify(info.packages),
      JSON.stringify({ ultralytics_detect: Boolean(info.packages.ultralytics), torch: Boolean(info.packages.torch) }),
      "server_python",
      artifactKey,
      "metadata.json",
      artifactSize,
      sha,
      "",
    ],
  );
  return rows.rows[0];
}

async function listModelVersions(modelId) {
  const params = [];
  const where = [];
  if (modelId) {
    params.push(modelId);
    where.push(`mv.model_id=$${params.length}`);
  }
  const rows = await query(
    `SELECT mv.*, m.name AS model_name, p.name AS dataset_project_name
     FROM model_revisions mv
     JOIN model_clusters m ON m.id=mv.model_id
     LEFT JOIN projects p ON p.id=mv.dataset_project_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY mv.created_at DESC
     LIMIT 200`,
    params,
  );
  return rows.rows;
}

async function findWeightArtifact(modelVersionId) {
  if (!modelVersionId) return null;
  const rows = await query(
    `SELECT ma.*
     FROM model_files ma
     WHERE ma.model_version_id=$1 AND ma.artifact_type='weights'
     ORDER BY
       CASE WHEN ma.path ILIKE '%/weights/best.pt' OR ma.path ILIKE '%\\\\weights\\\\best.pt' THEN 0 ELSE 1 END,
       ma.created_at DESC
     LIMIT 1`,
    [modelVersionId],
  );
  const artifact = rows.rows[0];
  if (!artifact) return null;
  const meta = artifact.metadata_json || {};
  if (meta.localPath && fs.existsSync(meta.localPath)) return meta.localPath;
  const fallback = store.localFallbackPath(artifact.path);
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

async function streamModelArtifact(res, modelVersionId, artifactId) {
  const params = [modelVersionId];
  let where = "ma.model_version_id=$1";
  if (artifactId) {
    params.push(artifactId);
    where += ` AND ma.id=$${params.length}`;
  } else {
    where += " AND ma.artifact_type='weights'";
  }
  const rows = await query(
    `SELECT ma.*, mv.version_name, m.name AS model_name
     FROM model_files ma
     JOIN model_revisions mv ON mv.id=ma.model_version_id
     JOIN model_clusters m ON m.id=mv.model_id
     WHERE ${where}
     ORDER BY
       CASE WHEN ma.path ILIKE '%/weights/best.pt' OR ma.path ILIKE '%\\\\weights\\\\best.pt' THEN 0 ELSE 1 END,
       ma.created_at DESC
     LIMIT 1`,
    params,
  );
  const artifact = rows.rows[0];
  if (!artifact) return sendError(res, 404, "model artifact not found");
  const ext = path.extname(artifact.path || "") || ".bin";
  const fileName = `${cleanName(artifact.model_name, "model")}_${cleanName(artifact.version_name, "version")}_${path.basename(artifact.path || `artifact${ext}`)}`;
  const meta = artifact.metadata_json || {};
  const localPath = meta.localPath && fs.existsSync(meta.localPath) ? meta.localPath : store.localFallbackPath(artifact.path);
  if (fs.existsSync(localPath)) {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
    fs.createReadStream(localPath).pipe(res);
    return;
  }
  const stream = await store.getStream(artifact.path);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  });
  stream.pipe(res);
}

async function listTrainingJobs() {
  try {
    const rows = await query(
      `SELECT tj.*, p.name AS dataset_project_name, m.name AS model_name, ds.name AS dataset_snapshot_name
       FROM runtime_training_jobs tj
       LEFT JOIN projects p ON p.id=tj.dataset_project_id
       LEFT JOIN model_clusters m ON m.id=tj.model_id
       LEFT JOIN dataset_snapshots ds ON ds.id=tj.dataset_snapshot_id
       ORDER BY tj.created_at DESC
       LIMIT 200`,
    );
    return rows.rows;
  } catch (error) {
    if (!["42P01", "XX002"].includes(error.code)) throw error;
    return [];
  }
}

async function createTrainingJob(body = {}) {
  const datasetProjectId = body.datasetProjectId || body.dataset_project_id || null;
  if (!datasetProjectId) throw new Error("请选择训练数据集项目");
  const project = (await query("SELECT id, name FROM projects WHERE id=$1 AND deleted_at IS NULL", [datasetProjectId])).rows[0];
  if (!project) throw new Error("训练数据集项目不存在");
  const modelId = body.modelId || body.model_id || null;
  if (modelId) {
    const model = (await query("SELECT id FROM model_clusters WHERE id=$1 AND deleted_at IS NULL", [modelId])).rows[0];
    if (!model) throw new Error("模型不存在");
  }
  const params = { ...(body.params || {}) };
  if (body.templateId || body.template_id) {
    const template = (await query("SELECT * FROM training_templates WHERE id=$1", [body.templateId || body.template_id])).rows[0];
    if (!template) throw new Error("训练模板不存在");
    Object.assign(params, template.default_params_json || {}, params);
    const requestedTask = String(body.taskType || body.task_type || params.taskType || template.task_type || "detect");
    const supportedTasks = template.capabilities_json?.tasks || [template.task_type || "detect"];
    if (!supportedTasks.includes(requestedTask)) throw new Error(`训练模板不支持 ${requestedTask} 任务`);
    params.templateId = template.id;
    params.templateKey = template.template_key;
    params.taskType = requestedTask;
  }
  if (body.pythonEnvId || body.python_env_id) {
    const env = (await query("SELECT * FROM runtime_envs WHERE id=$1", [body.pythonEnvId || body.python_env_id])).rows[0];
    if (!env) throw new Error("Python 环境不存在");
    params.pythonEnvId = env.id;
    params.python = env.python_path;
  }
  if (body.initialModelVersionId || body.initial_model_version_id) params.initialModelVersionId = body.initialModelVersionId || body.initial_model_version_id;
  const totalEpochs = Number(params.epochs || body.totalEpochs || 0) || 0;
  const name = String(body.name || `${project.name}_train_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`).trim();
  const template = String(body.template || "ultralytics_yolo_detect");
  const inserted = await query(
    `INSERT INTO runtime_training_jobs (name, template, dataset_project_id, model_id, params_json, total_epochs, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, template, datasetProjectId, modelId, JSON.stringify(params), totalEpochs, "已进入训练队列，等待训练 worker 接管"],
  );
  const job = inserted.rows[0];
  const outputRoot = path.join(storageRoot, "runtime", "training", job.id);
  fs.mkdirSync(outputRoot, { recursive: true });
  const updated = await query("UPDATE runtime_training_jobs SET output_root=$1 WHERE id=$2 RETURNING *", [outputRoot, job.id]);
  await query("INSERT INTO runtime_training_logs (job_id, stream, line) VALUES ($1,$2,$3)", [job.id, "system", `queued: ${template}; dataset=${project.name}`]);
  return updated.rows[0];
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

async function listInferenceJobs() {
  try {
    const rows = await query(
      `SELECT ij.*, mv.version_name, m.name AS model_name, p.name AS dataset_project_name
       FROM runtime_inference_jobs ij
       LEFT JOIN model_revisions mv ON mv.id=ij.model_version_id
       LEFT JOIN model_clusters m ON m.id=mv.model_id
       LEFT JOIN projects p ON p.id=ij.dataset_project_id
       ORDER BY ij.created_at DESC
       LIMIT 200`,
    );
    return rows.rows;
  } catch (error) {
    if (!["42P01", "XX002"].includes(error.code)) throw error;
    return [];
  }
}

async function listInferenceResults(jobId) {
  const rows = await query(
    `SELECT ir.*, pi.display_name, pi.scene, pi.view, pi.modality
     FROM runtime_inference_results ir
     LEFT JOIN project_images pi ON pi.id=ir.project_image_id
     WHERE ir.inference_job_id=$1
     ORDER BY ir.created_at, ir.id
     LIMIT 500`,
    [jobId],
  );
  return rows.rows;
}

async function deleteInferenceJob(jobId) {
  const deleted = await query("DELETE FROM runtime_inference_jobs WHERE id=$1 RETURNING id", [jobId]);
  if (!deleted.rows[0]) throw new Error("推理任务不存在");
  return { deleted: true, id: deleted.rows[0].id };
}

async function createInferenceJob(body = {}) {
  const datasetProjectId = body.datasetProjectId || body.dataset_project_id || null;
  if (!datasetProjectId) throw new Error("请选择推理数据集项目");
  const project = (await query("SELECT id, name FROM projects WHERE id=$1 AND deleted_at IS NULL", [datasetProjectId])).rows[0];
  if (!project) throw new Error("推理数据集项目不存在");
  const modelVersionId = body.modelVersionId || body.model_version_id || null;
  if (modelVersionId) {
    const version = (await query("SELECT id FROM model_revisions WHERE id=$1", [modelVersionId])).rows[0];
    if (!version) throw new Error("模型版本不存在");
  }
  const params = body.params || {};
  const algorithmAssetId = body.algorithmAssetId || body.algorithm_asset_id || params.algorithmAssetId || params.templateId || null;
  if (algorithmAssetId) {
    const algorithms = await listAlgorithmAssets();
    const algorithm = algorithms.find((item) => String(item.id) === String(algorithmAssetId) || item.algorithm_key === algorithmAssetId || item.template_key === algorithmAssetId);
    if (!algorithm) throw new Error("算法方法资产不存在");
    params.algorithmAssetId = algorithm.id;
    params.templateId = algorithm.id;
    params.algorithmKey = algorithm.algorithm_key || algorithm.template_key;
    params.templateName = algorithm.name;
    params.manifestKey = algorithm.manifest_key;
    params.adapterKey = algorithm.adapter_key;
    params.algorithmMinioPrefix = algorithm.minio_prefix;
  }
  const name = String(body.name || `${project.name}_infer_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`).trim();
  const inserted = await query(
    `INSERT INTO runtime_inference_jobs (name, model_version_id, dataset_project_id, status, params_json, message)
     VALUES ($1,$2,$3,'preparing',$4,$5) RETURNING *`,
    [name, modelVersionId, datasetProjectId, JSON.stringify(params), "正在准备推理输入缓存"],
  );
  const job = inserted.rows[0];
  const outputRoot = path.join(storageRoot, "runtime", "inference", job.id);
  fs.mkdirSync(outputRoot, { recursive: true });
  const updated = await query("UPDATE runtime_inference_jobs SET output_root=$1 WHERE id=$2 RETURNING *", [outputRoot, job.id]);
  setImmediate(() => {
    prepareInferenceInputCache(updated.rows[0]).catch(async (error) => {
      console.error("prepare inference input failed", error);
      await query(
        "UPDATE runtime_inference_jobs SET status='failed', message=$1, finished_at=now() WHERE id=$2",
        [error.message || "推理输入缓存准备失败", job.id],
      ).catch(() => {});
    });
  });
  return updated.rows[0];
}

function yamlScalar(value) {
  return JSON.stringify(String(value ?? ""));
}

function yoloClassLine(ann, width, height, labelIndex) {
  const x = Number(ann.bbox_x || 0);
  const y = Number(ann.bbox_y || 0);
  const w = Number(ann.bbox_w || 0);
  const h = Number(ann.bbox_h || 0);
  const cx = (x + w / 2) / Math.max(1, Number(width || 1));
  const cy = (y + h / 2) / Math.max(1, Number(height || 1));
  return [
    labelIndex,
    Math.max(0, Math.min(1, cx)).toFixed(8),
    Math.max(0, Math.min(1, cy)).toFixed(8),
    Math.max(0, Math.min(1, w / Math.max(1, Number(width || 1)))).toFixed(8),
    Math.max(0, Math.min(1, h / Math.max(1, Number(height || 1)))).toFixed(8),
  ].join(" ");
}

async function writeObjectToFile(objectKey, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const stream = await store.getStream(objectKey);
  await new Promise((resolve, reject) => {
    const write = fs.createWriteStream(targetPath);
    stream.pipe(write);
    write.on("finish", resolve);
    write.on("error", reject);
    stream.on("error", reject);
  });
}

function inferenceListParam(source = {}, ...keys) {
  for (const key of keys) {
    const raw = source[key];
    if (!raw || raw === "all") continue;
    if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean);
    const values = String(raw).split(",").map((item) => item.trim()).filter(Boolean);
    if (values.length) return values;
  }
  return [];
}

function linkOrCopyFile(source, target, copyOnly = false) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  if (copyOnly) {
    fs.copyFileSync(source, target);
    return;
  }
  try {
    fs.linkSync(source, target);
  } catch {
    try {
      fs.symlinkSync(path.relative(path.dirname(target), source), target);
    } catch {
      fs.copyFileSync(source, target);
    }
  }
}

async function ensureImageAssetCache(row) {
  const ext = row.original_ext || path.extname(row.object_key || "") || ".jpg";
  const target = path.join(storageRoot, "runtime", "cache", "assets", "images", `${row.image_asset_id}${ext}`);
  if (!fs.existsSync(target)) await writeObjectToFile(row.object_key, target);
  return target;
}

async function prepareInferenceInputCache(job) {
  const paramsJson = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  const input = paramsJson.input || {};
  const filters = input.filters || {};
  const sqlParams = [job.dataset_project_id];
  const where = ["pi.project_id=$1", "pi.deleted_at IS NULL"];

  const sceneValues = inferenceListParam(filters, "scenes", "scene");
  const viewValues = inferenceListParam(filters, "views", "view");
  const modalityValues = inferenceListParam(filters, "modalities", "modality");
  const importValues = inferenceListParam(filters, "importBatchIds", "importBatchId");
  const labelValues = inferenceListParam(filters, "labels", "label");
  const q = String(filters.q || "").trim();

  if (sceneValues.length) {
    sqlParams.push(sceneValues);
    where.push(`pi.scene = ANY($${sqlParams.length})`);
  }
  if (viewValues.length) {
    sqlParams.push(viewValues);
    where.push(`pi.view = ANY($${sqlParams.length})`);
  }
  if (modalityValues.length) {
    sqlParams.push(modalityValues);
    where.push(`pi.modality = ANY($${sqlParams.length})`);
  }
  if (importValues.length) {
    sqlParams.push(importValues);
    where.push(`pi.import_batch_id = ANY($${sqlParams.length}::uuid[])`);
  }
  if (q) {
    sqlParams.push(`%${q}%`);
    where.push(`(pi.display_name ILIKE $${sqlParams.length} OR pi.scene ILIKE $${sqlParams.length} OR pi.view ILIKE $${sqlParams.length} OR pi.keyword ILIKE $${sqlParams.length})`);
  }
  if (labelValues.length) {
    sqlParams.push(labelValues);
    where.push(`EXISTS (
      SELECT 1 FROM image_annotations a
      JOIN projects p ON p.active_label_version_id = a.label_version_id
      WHERE p.id = pi.project_id AND a.project_image_id = pi.id AND a.label = ANY($${sqlParams.length})
    )`);
  }

  const limit = Math.max(0, Math.min(100000, Number(input.limit || 0)));
  if (limit > 0) sqlParams.push(limit);

  const rows = (await query(
    `SELECT pi.id AS project_image_id, pi.project_id, pi.image_asset_id, pi.import_batch_id, pi.display_name,
            pi.scene, pi.view, pi.modality, pi.keyword,
            ia.object_key, ia.original_ext, ia.width, ia.height, ia.file_size
     FROM project_images pi
     JOIN image_assets ia ON ia.id=pi.image_asset_id
     LEFT JOIN import_batches ib ON ib.id=pi.import_batch_id
     WHERE ${where.join(" AND ")} AND (ib.id IS NULL OR ib.deleted_at IS NULL)
     ORDER BY pi.created_at, pi.id
     ${limit > 0 ? `LIMIT $${sqlParams.length}` : ""}`,
    sqlParams,
  )).rows;
  if (!rows.length) throw new Error("推理输入范围内没有可用图片");

  const outputRoot = job.output_root || path.join(storageRoot, "runtime", "inference", job.id);
  const cacheRoot = path.join(outputRoot, "input-cache");
  const imagesDir = path.join(cacheRoot, "images");
  const cachePolicy = input.cachePolicy || "reuse_asset_cache";
  fs.mkdirSync(imagesDir, { recursive: true });

  const manifestImages = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const assetPath = await ensureImageAssetCache(row);
    const ext = path.extname(assetPath) || row.original_ext || ".jpg";
    const cachedFileName = `${String(index + 1).padStart(8, "0")}${ext}`;
    const cachedPath = path.join(imagesDir, cachedFileName);
    linkOrCopyFile(assetPath, cachedPath, cachePolicy === "job_copy");
    manifestImages.push({
      index: index + 1,
      projectImageId: row.project_image_id,
      imageAssetId: row.image_asset_id,
      importBatchId: row.import_batch_id,
      objectKey: row.object_key,
      originalFileName: row.display_name,
      cachedFileName,
      localPath: path.join("images", cachedFileName).replaceAll("\\", "/"),
      width: row.width,
      height: row.height,
      scene: row.scene,
      view: row.view,
      modality: row.modality,
      keyword: row.keyword,
    });
  }

  const manifest = {
    jobId: job.id,
    projectId: job.dataset_project_id,
    imageCount: manifestImages.length,
    cacheRoot,
    imagesDir,
    createdAt: new Date().toISOString(),
    images: manifestImages,
  };
  const sourceFilters = {
    sourceType: input.sourceType || "project_images",
    projectId: job.dataset_project_id,
    filters,
    limit,
    cachePolicy,
  };
  fs.writeFileSync(path.join(cacheRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(cacheRoot, "source_filters.json"), JSON.stringify(sourceFilters, null, 2));
  fs.writeFileSync(path.join(cacheRoot, "dataset_meta.json"), JSON.stringify({
    projectId: job.dataset_project_id,
    imageCount: manifestImages.length,
    modalities: Array.from(new Set(manifestImages.map((item) => item.modality).filter(Boolean))),
    scenes: Array.from(new Set(manifestImages.map((item) => item.scene).filter(Boolean))),
    views: Array.from(new Set(manifestImages.map((item) => item.view).filter(Boolean))),
  }, null, 2));

  const nextParams = {
    ...paramsJson,
    input: {
      sourceType: input.sourceType || "project_images",
      filters,
      limit,
      cachePolicy,
      cacheRoot,
      imagesDir,
      manifestPath: path.join(cacheRoot, "manifest.json"),
      imageCount: manifestImages.length,
      preparedAt: manifest.createdAt,
    },
  };
  await query(
    "UPDATE runtime_inference_jobs SET status='pending', progress=5, params_json=$1, message=$2 WHERE id=$3",
    [JSON.stringify(nextParams), `推理输入缓存已准备：${manifestImages.length} 张图片`, job.id],
  );
  return manifest;
}

async function claimInferenceJob(workerId) {
  return transaction(async (client) => {
    const row = (await client.query(
      `SELECT *
       FROM runtime_inference_jobs
       WHERE status='pending'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    )).rows[0];
    if (!row) return null;
    await client.query(
      "UPDATE runtime_inference_jobs SET status='running', progress=10, message=$1, started_at=COALESCE(started_at, now()) WHERE id=$2",
      [`推理 worker ${workerId} 已接管任务`, row.id],
    );
    return { ...row, status: "running" };
  });
}

function isDummyInferenceJob(job) {
  const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  return params.templateKey === "dummy_empty_detector" || (!job.model_version_id && params.templateKey === "dinov3_faster_rcnn");
}

async function runDummyInferenceJob(job) {
  const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  const input = params.input || {};
  const manifestPath = input.manifestPath || path.join(job.output_root, "input-cache", "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("推理输入 manifest 不存在");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const outputRoot = job.output_root || path.join(storageRoot, "runtime", "inference", job.id);
  const outputDir = path.join(outputRoot, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const images = Array.isArray(manifest.images) ? manifest.images : [];
  const predictionRows = images.map((image) => ({
    index: image.index,
    cachedFileName: image.cachedFileName,
    projectImageId: image.projectImageId,
    imageAssetId: image.imageAssetId,
    originalFileName: image.originalFileName,
    width: image.width,
    height: image.height,
    predictions: [],
  }));
  const predictions = {
    format: "det-dashboard.predictions.v1",
    algorithm: "dummy_empty_detector",
    jobId: job.id,
    imageCount: predictionRows.length,
    images: predictionRows,
  };
  const predictionsPath = path.join(outputDir, "predictions.json");
  fs.writeFileSync(predictionsPath, JSON.stringify(predictions, null, 2), "utf8");

  await transaction(async (client) => {
    await client.query("DELETE FROM runtime_inference_results WHERE inference_job_id=$1", [job.id]);
    for (const row of predictionRows) {
      await client.query(
        `INSERT INTO runtime_inference_results (inference_job_id, project_image_id, predictions_json, artifact_path)
         VALUES ($1,$2,$3,$4)`,
        [job.id, row.projectImageId || null, JSON.stringify(row.predictions), predictionsPath],
      );
    }
    const nextParams = {
      ...params,
      output: {
        ...(params.output || {}),
        predictionsPath,
        resultCount: predictionRows.length,
        completedAt: new Date().toISOString(),
      },
    };
    await client.query(
      "UPDATE runtime_inference_jobs SET status='done', progress=100, params_json=$1, message=$2, finished_at=now() WHERE id=$3",
      [JSON.stringify(nextParams), `空模型推理完成：${predictionRows.length} 张图片，0 个预测框`, job.id],
    );
  });
}

async function runInferenceJob(job, workerId) {
  try {
    if (!isDummyInferenceJob(job)) {
      await query(
        "UPDATE runtime_inference_jobs SET status='pending', progress=5, message=$1 WHERE id=$2",
        ["等待外部推理 worker：当前内置 worker 只执行空模型任务", job.id],
      );
      return;
    }
    await query("UPDATE runtime_inference_jobs SET progress=35, message=$1 WHERE id=$2", ["正在执行空模型推理", job.id]);
    await runDummyInferenceJob(job);
  } catch (error) {
    await query(
      "UPDATE runtime_inference_jobs SET status='failed', message=$1, finished_at=now() WHERE id=$2",
      [error.message || `推理 worker ${workerId} 执行失败`, job.id],
    ).catch(() => {});
  }
}

function startInferenceWorker() {
  if (String(process.env.INFERENCE_WORKER_ENABLED || "true").toLowerCase() === "false") return;
  const workerId = `local-infer-${process.pid}`;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const job = await claimInferenceJob(workerId);
      if (job) await runInferenceJob(job, workerId);
    } catch (error) {
      console.error("inference worker error:", error);
    } finally {
      busy = false;
    }
  }, Number(process.env.INFERENCE_WORKER_INTERVAL_MS || 2500));
}

async function appendTrainingLog(jobId, stream, line) {
  const text = String(line || "").slice(0, 4000);
  if (!text) return;
  await query("INSERT INTO runtime_training_logs (job_id, stream, line) VALUES ($1,$2,$3)", [jobId, stream, text]).catch(() => {});
}

async function createDatasetSnapshotForTraining(job) {
  const existingId = job.dataset_snapshot_id;
  if (existingId) {
    const existing = (await query("SELECT * FROM dataset_snapshots WHERE id=$1", [existingId])).rows[0];
    if (existing) return existing;
  }
  const project = (await query("SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL", [job.dataset_project_id])).rows[0];
  if (!project) throw new Error("训练数据集项目不存在");
  if (!project.active_label_version_id) throw new Error("项目没有 active_label_version_id，无法生成训练快照");

  const rows = (await query(
    `SELECT pi.*, ia.object_key, ia.original_ext, ia.width, ia.height
     FROM project_images pi
     JOIN image_assets ia ON ia.id=pi.image_asset_id
     LEFT JOIN import_batches ib ON ib.id=pi.import_batch_id
     WHERE pi.project_id=$1 AND pi.deleted_at IS NULL AND (ib.id IS NULL OR ib.deleted_at IS NULL)
     ORDER BY pi.created_at, pi.id`,
    [project.id],
  )).rows;
  if (!rows.length) throw new Error("项目没有可训练图片");

  const annRows = (await query(
    `SELECT a.*
     FROM image_annotations a
     WHERE a.label_version_id=$1 AND a.project_image_id = ANY($2::uuid[])
     ORDER BY a.label, a.id`,
    [project.active_label_version_id, rows.map((row) => row.id)],
  )).rows;
  const labels = Array.from(new Set(annRows.map((ann) => String(ann.label || "unknown")))).sort((a, b) => a.localeCompare(b));
  if (!labels.length) throw new Error("项目没有标注类别，无法生成 YOLO 快照");
  const labelToIndex = new Map(labels.map((label, index) => [label, index]));
  const annsByImage = new Map();
  for (const ann of annRows) {
    const key = String(ann.project_image_id);
    if (!annsByImage.has(key)) annsByImage.set(key, []);
    annsByImage.get(key).push(ann);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  const snapshotName = `${cleanName(project.name, "dataset")}_${stamp}`;
  const snapshotRoot = path.join(storageRoot, "runtime", "snapshots", snapshotName);
  const splitRatio = 0.9;
  const split = { train: 0, val: 0, ratio: splitRatio };
  fs.mkdirSync(snapshotRoot, { recursive: true });
  for (const part of ["train", "val"]) {
    fs.mkdirSync(path.join(snapshotRoot, "images", part), { recursive: true });
    fs.mkdirSync(path.join(snapshotRoot, "labels", part), { recursive: true });
  }

  for (let i = 0; i < rows.length; i += 1) {
    const item = rows[i];
    const part = rows.length < 5 || i < Math.ceil(rows.length * splitRatio) ? "train" : "val";
    split[part] += 1;
    const ext = item.original_ext || ".jpg";
    const base = exportBaseName(item, i + 1);
    const imageName = `${base}${ext}`;
    const labelName = `${base}.txt`;
    await writeObjectToFile(item.object_key, path.join(snapshotRoot, "images", part, imageName));
    const lines = (annsByImage.get(String(item.id)) || []).map((ann) => yoloClassLine(ann, item.width, item.height, labelToIndex.get(String(ann.label || "unknown")) ?? 0));
    fs.writeFileSync(path.join(snapshotRoot, "labels", part, labelName), `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  }

  const dataYaml = [
    `path: ${yamlScalar(snapshotRoot.replace(/\\/g, "/"))}`,
    "train: images/train",
    "val: images/val",
    `nc: ${labels.length}`,
    "names:",
    ...labels.map((label, index) => `  ${index}: ${yamlScalar(label)}`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(snapshotRoot, "data.yaml"), dataYaml, "utf8");
  fs.writeFileSync(path.join(snapshotRoot, "snapshot.json"), JSON.stringify({ projectId: project.id, labelVersionId: project.active_label_version_id, labels, split, imageCount: rows.length, annotationCount: annRows.length }, null, 2), "utf8");

  const snapshot = (await query(
    `INSERT INTO dataset_snapshots (name, source_project_id, label_version_id, format, split_json, path, image_count, annotation_count, metadata_json)
     VALUES ($1,$2,$3,'yolo',$4,$5,$6,$7,$8) RETURNING *`,
    [snapshotName, project.id, project.active_label_version_id, JSON.stringify(split), snapshotRoot, rows.length, annRows.length, JSON.stringify({ labels, dataYaml: path.join(snapshotRoot, "data.yaml") })],
  )).rows[0];
  await query("UPDATE runtime_training_jobs SET dataset_snapshot_id=$1 WHERE id=$2", [snapshot.id, job.id]);
  await appendTrainingLog(job.id, "system", `dataset snapshot created: ${snapshotRoot}`);
  return snapshot;
}

function buildTrainingCommand(job, snapshot) {
  const params = job.params_json || {};
  if (Array.isArray(params.command) && params.command.length) {
    return { command: params.command[0], args: params.command.slice(1) };
  }
  const python = params.python || process.env.PYTHON || "python";
  const model = params.resolvedWeights || params.weights || params.model || "yolov8n.pt";
  const taskType = ["detect", "segment", "classify"].includes(params.taskType) ? params.taskType : "detect";
  const args = [
    "-c", "from ultralytics.cfg import entrypoint; entrypoint()",
    taskType, "train",
    `data=${path.join(snapshot.path, "data.yaml")}`,
    `model=${model}`,
    `epochs=${Number(params.epochs || job.total_epochs || 100)}`,
    `imgsz=${Number(params.imgsz || 640)}`,
    `batch=${Number(params.batch || 16)}`,
    `project=${job.output_root}`,
    "name=run",
    "exist_ok=True",
  ];
  if (params.device !== "" && params.device != null) args.push(`device=${params.device}`);
  return { command: python, args };
}

async function claimTrainingJob(workerId) {
  return transaction(async (client) => {
    const row = (await client.query(
      `SELECT * FROM runtime_training_jobs
       WHERE status='pending'
       ORDER BY priority DESC, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    )).rows[0];
    if (!row) return null;
    const updated = (await client.query(
      `UPDATE runtime_training_jobs
       SET status='preparing', worker_id=$1, heartbeat_at=now(), started_at=COALESCE(started_at, now()), message=$2
       WHERE id=$3 RETURNING *`,
      [workerId, "正在生成数据集快照", row.id],
    )).rows[0];
    return updated;
  });
}

async function scanArtifacts(job, modelVersionId) {
  const root = job.output_root;
  const files = walk(root).filter((file) => fs.statSync(file).isFile());
  const saved = [];
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const ext = path.extname(file).toLowerCase();
    const artifactType = ext === ".pt" || ext === ".onnx" ? "weights" : ext === ".png" || ext === ".jpg" ? "figure" : ext === ".yaml" || ext === ".json" ? "config" : "file";
    const objectKey = `ml/artifacts/training/${job.id}/${rel}`;
    await store.putFile(objectKey, file);
    const stat = fs.statSync(file);
    const sha = stat.size < 1024 * 1024 * 1024 ? await hashFile(file).catch(() => null) : null;
    const row = (await query(
      `INSERT INTO model_files (model_version_id, training_job_id, artifact_type, path, size, sha256, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [modelVersionId, job.id, artifactType, objectKey, stat.size, sha, JSON.stringify({ localPath: file, relativePath: rel })],
    )).rows[0];
    saved.push(row);
  }
  return saved;
}

async function finishTrainingJob(job) {
  const modelId = job.model_id || (await createMlModel({ name: `${job.name}_model`, taskType: "detect", framework: "ultralytics", description: "Auto-created from training job" })).id;
  const project = (await query("SELECT name FROM projects WHERE id=$1", [job.dataset_project_id])).rows[0];
  const params = job.params_json || {};
  const prefix = `detect_${project?.name || "dataset"}_yolo_ep${Number(params.epochs || job.total_epochs || 0) || "x"}_${dateCode()}`;
  const versionName = await nextModelVersionName(prefix, modelId);
  const version = (await query(
    `INSERT INTO model_revisions (model_id, version_name, training_job_id, dataset_project_id, dataset_snapshot_id, stage, params_json, artifact_root)
     VALUES ($1,$2,$3,$4,$5,'candidate',$6,$7) RETURNING *`,
    [modelId, versionName, job.id, job.dataset_project_id, job.dataset_snapshot_id, JSON.stringify(job.params_json || {}), job.output_root],
  )).rows[0];
  const artifacts = await scanArtifacts(job, version.id);
  await query(
    "UPDATE runtime_training_jobs SET model_id=$1, status='done', progress=100, message=$2, finished_at=now(), heartbeat_at=now() WHERE id=$3",
    [modelId, `训练完成，生成模型版本 ${version.version_name}，登记 ${artifacts.length} 个 artifact`, job.id],
  );
  await appendTrainingLog(job.id, "system", `model version created: ${version.version_name}; artifacts=${artifacts.length}`);
}

function parseMetricLine(line) {
  const metrics = [];
  const patterns = [
    ["box_loss", /box_loss[=: ]+([0-9.]+)/i],
    ["cls_loss", /cls_loss[=: ]+([0-9.]+)/i],
    ["dfl_loss", /dfl_loss[=: ]+([0-9.]+)/i],
    ["map50", /mAP50(?:\S*)?[=: ]+([0-9.]+)/i],
  ];
  for (const [key, regex] of patterns) {
    const match = String(line).match(regex);
    if (match) metrics.push({ key, value: Number(match[1]) });
  }
  return metrics;
}

async function runTrainingJob(job, workerId) {
  try {
    fs.mkdirSync(job.output_root, { recursive: true });
    const snapshot = await createDatasetSnapshotForTraining(job);
    job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [job.id])).rows[0];
    if (job.params_json?.initialModelVersionId && !job.params_json?.resolvedWeights) {
      const weightPath = await findWeightArtifact(job.params_json.initialModelVersionId);
      if (!weightPath) throw new Error("选择的初始化模型版本没有可用权重 artifact");
      job.params_json = { ...(job.params_json || {}), resolvedWeights: weightPath };
      await query("UPDATE runtime_training_jobs SET params_json=$1 WHERE id=$2", [JSON.stringify(job.params_json), job.id]);
      await appendTrainingLog(job.id, "system", `resolved initial weights: ${weightPath}`);
    }
    const { command, args } = buildTrainingCommand(job, snapshot);
    await query("UPDATE runtime_training_jobs SET status='running', message=$1, heartbeat_at=now() WHERE id=$2", [`正在执行: ${command} ${args.join(" ")}`, job.id]);
    await appendTrainingLog(job.id, "system", `command: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, { cwd: job.output_root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    await query("UPDATE runtime_training_jobs SET process_pid=$1 WHERE id=$2", [child.pid || null, job.id]);
    const onData = (stream) => async (chunk) => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        await appendTrainingLog(job.id, stream, line);
        for (const metric of parseMetricLine(line)) {
          await query("INSERT INTO runtime_training_metrics (job_id, key, value) VALUES ($1,$2,$3)", [job.id, metric.key, metric.value]).catch(() => {});
        }
      }
      await query("UPDATE runtime_training_jobs SET heartbeat_at=now(), message=$1 WHERE id=$2", [text.split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 500) || "训练中", job.id]).catch(() => {});
    };
    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [job.id])).rows[0];
    if (exitCode !== 0) throw new Error(`训练命令退出码 ${exitCode}`);
    await finishTrainingJob(job);
  } catch (error) {
    await appendTrainingLog(job.id, "error", error.stack || error.message);
    await query("UPDATE runtime_training_jobs SET status='failed', message=$1, finished_at=now(), heartbeat_at=now() WHERE id=$2", [error.message || "训练失败", job.id]).catch(() => {});
  }
}

function startTrainingWorker() {
  if (String(process.env.TRAINING_WORKER_ENABLED || "true").toLowerCase() === "false") return;
  const workerId = `local-${process.pid}`;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const job = await claimTrainingJob(workerId);
      if (job) await runTrainingJob(job, workerId);
    } catch (error) {
      console.error("training worker error:", error);
    } finally {
      busy = false;
    }
  }, Number(process.env.TRAINING_WORKER_INTERVAL_MS || 3000));
}

async function saveImageAnnotations(projectImageId, body = {}) {
  const image = (await query(
    `SELECT pi.*, ia.width AS image_width, ia.height AS image_height, p.active_label_version_id, p.id AS project_id
     FROM project_images pi
     JOIN image_assets ia ON ia.id = pi.image_asset_id
     JOIN projects p ON p.id = pi.project_id
     WHERE pi.id=$1 AND pi.deleted_at IS NULL AND p.deleted_at IS NULL`,
    [projectImageId],
  )).rows[0];
  if (!image) throw new Error("image not found");

  let labelVersionId = image.active_label_version_id;
  if (!labelVersionId) {
    const version = (await query(
      `INSERT INTO label_versions (project_id, name, target_type, status)
       VALUES ($1,$2,'image','active') RETURNING *`,
      [image.project_id, `manual_${new Date().toISOString()}`],
    )).rows[0];
    labelVersionId = version.id;
    await query("UPDATE projects SET active_label_version_id=$1, updated_at=now() WHERE id=$2", [labelVersionId, image.project_id]);
  }

  const maxW = Number(image.image_width || 1);
  const maxH = Number(image.image_height || 1);
  const annotations = Array.isArray(body.annotations) ? body.annotations : [];
  const clean = annotations.map((ann) => {
    const x = Math.max(0, Math.min(maxW - 1, Number(ann.bbox_x || 0)));
    const y = Math.max(0, Math.min(maxH - 1, Number(ann.bbox_y || 0)));
    const w = Math.max(1, Math.min(maxW - x, Number(ann.bbox_w || 1)));
    const h = Math.max(1, Math.min(maxH - y, Number(ann.bbox_h || 1)));
    return {
      label: String(ann.label || "").trim() || "unknown",
      bbox_x: x,
      bbox_y: y,
      bbox_w: w,
      bbox_h: h,
      shape_type: ann.shape_type || "rectangle",
      difficult: Boolean(ann.difficult),
      score: ann.score == null ? null : Number(ann.score),
      attributes_json: ann.attributes_json || ann.attributes || {},
    };
  });

  return transaction(async (client) => {
    await client.query("DELETE FROM image_annotations WHERE label_version_id=$1 AND project_image_id=$2", [labelVersionId, projectImageId]);
    const saved = [];
    for (const ann of clean) {
      const row = (await client.query(
        `INSERT INTO image_annotations
         (label_version_id, project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h, shape_type, difficult, score, attributes_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [labelVersionId, projectImageId, ann.label, ann.bbox_x, ann.bbox_y, ann.bbox_w, ann.bbox_h, ann.shape_type, ann.difficult, ann.score, ann.attributes_json],
      )).rows[0];
      saved.push(row);
    }
    await client.query("UPDATE projects SET updated_at=now() WHERE id=$1", [image.project_id]);
    return { annotations: saved };
  });
}

async function listProjectImages(projectId, queryParams) {
  const page = Math.max(1, Number(queryParams.page || 1));
  const pageSize = Math.min(200, Math.max(12, Number(queryParams.pageSize || 48)));
  const offset = (page - 1) * pageSize;
  const params = [projectId];
  const where = ["pi.project_id=$1", "pi.deleted_at IS NULL"];

  const listParam = (...keys) => {
    for (const key of keys) {
      const raw = queryParams[key];
      if (!raw || raw === "all") continue;
      const values = String(raw).split(",").map((item) => item.trim()).filter(Boolean);
      if (values.length) return values;
    }
    return [];
  };

  const sceneValues = listParam("scenes", "scene");
  const viewValues = listParam("views", "view");
  const modalityValues = listParam("modalities", "modality");
  const labelValues = listParam("labels", "label");
  const importValues = listParam("importBatchIds", "importBatchId");
  const q = String(queryParams.q || "").trim();

  if (sceneValues.length) {
    params.push(sceneValues);
    where.push(`pi.scene = ANY($${params.length})`);
  }
  if (viewValues.length) {
    params.push(viewValues);
    where.push(`pi.view = ANY($${params.length})`);
  }
  if (modalityValues.length) {
    params.push(modalityValues);
    where.push(`pi.modality = ANY($${params.length})`);
  }
  if (importValues.length) {
    params.push(importValues);
    where.push(`pi.import_batch_id = ANY($${params.length}::uuid[])`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(pi.display_name ILIKE $${params.length} OR pi.scene ILIKE $${params.length} OR pi.view ILIKE $${params.length} OR pi.keyword ILIKE $${params.length})`);
  }
  if (labelValues.length) {
    params.push(labelValues);
    where.push(`EXISTS (
      SELECT 1 FROM image_annotations a
      JOIN projects p ON p.active_label_version_id = a.label_version_id
      WHERE p.id = pi.project_id AND a.project_image_id = pi.id AND a.label = ANY($${params.length})
    )`);
  }
  params.push(pageSize, offset);
  const rows = await query(
    `SELECT pi.*, ia.width AS image_width, ia.height AS image_height, ia.object_key,
      (SELECT count(*)::int FROM image_annotations a
       JOIN projects p ON p.active_label_version_id = a.label_version_id
       WHERE p.id = pi.project_id AND a.project_image_id = pi.id) AS annotation_count
     FROM project_images pi
     JOIN image_assets ia ON ia.id = pi.image_asset_id
     LEFT JOIN import_batches ib ON ib.id = pi.import_batch_id
     WHERE ${where.join(" AND ")} AND (ib.id IS NULL OR ib.deleted_at IS NULL)
     ORDER BY pi.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const count = await query(
    `SELECT count(*)::int AS count
     FROM project_images pi
     LEFT JOIN import_batches ib ON ib.id = pi.import_batch_id
     WHERE ${where.join(" AND ")} AND (ib.id IS NULL OR ib.deleted_at IS NULL)`,
    params.slice(0, -2),
  );

  const items = rows.rows;
  if (!items.length) return { page, pageSize, total: count.rows[0].count, items };

  const annParams = [projectId, items.map((item) => item.id)];
  const annWhere = ["p.id=$1", "a.project_image_id = ANY($2::uuid[])"];
  if (labelValues.length) {
    annParams.push(labelValues);
    annWhere.push(`a.label = ANY($${annParams.length})`);
  }
  const annotations = await query(
    `SELECT a.id, a.project_image_id, a.label, a.bbox_x, a.bbox_y, a.bbox_w, a.bbox_h, a.shape_type, a.difficult, a.score
     FROM image_annotations a
     JOIN projects p ON p.active_label_version_id = a.label_version_id
     WHERE ${annWhere.join(" AND ")}
     ORDER BY a.id`,
    annParams,
  );
  const byImage = new Map();
  for (const ann of annotations.rows) {
    const key = String(ann.project_image_id);
    if (!byImage.has(key)) byImage.set(key, []);
    byImage.get(key).push(ann);
  }
  return { page, pageSize, total: count.rows[0].count, items: items.map((item) => ({ ...item, annotations: byImage.get(String(item.id)) || [] })) };
}

async function projectSummary(projectId) {
  const rows = await query(
    `SELECT
      (SELECT count(*)::int FROM project_images WHERE project_id=$1 AND deleted_at IS NULL) AS image_count,
      (SELECT count(*)::int FROM project_videos WHERE project_id=$1 AND deleted_at IS NULL) AS video_count,
      (SELECT count(*)::int FROM image_annotations a JOIN projects p ON p.active_label_version_id=a.label_version_id WHERE p.id=$1) AS annotation_count,
      (SELECT json_agg(DISTINCT scene) FROM project_images WHERE project_id=$1 AND deleted_at IS NULL) AS scenes,
      (SELECT json_agg(DISTINCT view) FROM project_images WHERE project_id=$1 AND deleted_at IS NULL) AS views,
      (SELECT json_agg(DISTINCT modality) FROM project_images WHERE project_id=$1 AND deleted_at IS NULL) AS modalities,
      (SELECT json_agg(DISTINCT label) FROM image_annotations a JOIN projects p ON p.active_label_version_id=a.label_version_id WHERE p.id=$1) AS labels`,
    [projectId],
  );
  return rows.rows[0];
}

async function streamProjectImage(res, projectImageId, thumb) {
  const result = await query(
    `SELECT pi.id AS project_image_id, ia.*
     FROM project_images pi JOIN image_assets ia ON ia.id=pi.image_asset_id
     WHERE pi.id=$1 AND pi.deleted_at IS NULL`,
    [projectImageId],
  );
  const row = result.rows[0];
  if (!row) return sendError(res, 404, "image not found");
  if (!thumb) {
    const stream = await store.getStream(row.object_key);
    res.writeHead(200, { "content-type": "application/octet-stream" });
    stream.pipe(res);
    return;
  }
  const thumbKey = `cache/thumbs/images/${row.id}.webp`;
  if (!(await store.objectExists(thumbKey))) {
    const tempDir = path.join(storageRoot, "tmp");
    fs.mkdirSync(tempDir, { recursive: true });
    const src = path.join(tempDir, `${row.id}${row.original_ext || ".jpg"}`);
    const out = path.join(tempDir, `${row.id}.webp`);
    await new Promise(async (resolve, reject) => {
      const stream = await store.getStream(row.object_key);
      const write = fs.createWriteStream(src);
      stream.pipe(write);
      write.on("finish", resolve);
      write.on("error", reject);
    });
    await sharp(src).resize({ width: 420, height: 236, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toFile(out);
    await store.putFile(thumbKey, out);
  }
  const stream = await store.getStream(thumbKey);
  res.writeHead(200, { "content-type": "image/webp", "cache-control": "public, max-age=604800" });
  stream.pipe(res);
}

async function exportProject(projectId, options = {}) {
  if (shuttingDown) {
    const error = new Error("服务正在关闭，暂不接受新的导出任务");
    error.statusCode = 503;
    throw error;
  }
  const format = normalizeExportFormat(options.format);
  if (!format) {
    const error = new Error("导出格式仅支持 labelme、coco 或 yolo");
    error.statusCode = 400;
    throw error;
  }
  const project = (await query("SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL", [projectId])).rows[0];
  if (!project) throw new Error("project not found");
  fs.mkdirSync(exportRoot, { recursive: true });
  const job = (await query("INSERT INTO jobs (type,status,progress,payload,message,started_at) VALUES ('export','running',0,$1,$2,now()) RETURNING *", [{ projectId, outputPath: exportRootDisplay, format }, `正在导出 ${format.toUpperCase()}`])).rows[0];

  setImmediate(() => {
    const task = runExportProject(project, job, format).catch(async (error) => {
      console.error("export failed", error);
      await query(
        "UPDATE jobs SET status='failed', message=$1, finished_at=now() WHERE id=$2",
        [error.message || "导出失败", job.id],
      ).catch(() => {});
    }).finally(() => activeExportTasks.delete(task));
    activeExportTasks.add(task);
  });

  return { jobId: job.id, status: job.status, outputRoot: exportRootDisplay, format };
}

async function runExportProject(project, job, format) {
  const projectId = project.id;
  const rows = (await query(
    `SELECT pi.*, ia.object_key, ia.original_ext, ia.width, ia.height
     FROM project_images pi JOIN image_assets ia ON ia.id=pi.image_asset_id
     WHERE pi.project_id=$1 AND pi.deleted_at IS NULL ORDER BY pi.created_at`,
    [projectId],
  )).rows;
  const annotationRows = project.active_label_version_id && rows.length
    ? (await query(
      "SELECT * FROM image_annotations WHERE label_version_id=$1 AND project_image_id = ANY($2::uuid[]) ORDER BY id",
      [project.active_label_version_id, rows.map((row) => row.id)],
    )).rows
    : [];
  const annotationsByImage = new Map();
  for (const annotation of annotationRows) {
    if (!annotationsByImage.has(annotation.project_image_id)) annotationsByImage.set(annotation.project_image_id, []);
    annotationsByImage.get(annotation.project_image_id).push(annotation);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  const exportPrefix = `exports/${project.id}/${format}_${stamp}`;
  const localRoot = path.join(exportRoot, `${cleanName(project.name, "dataset")}_${format}_${stamp}`);
  const displayLocalRoot = path.join(exportRootDisplay, path.basename(localRoot));
  const localImagesDir = path.join(localRoot, "images");
  const localLabelsDir = path.join(localRoot, format === "labelme" ? "jsons" : format === "coco" ? "annotations" : "labels");
  const tempDir = path.join(storageRoot, "tmp", job.id);
  fs.mkdirSync(localImagesDir, { recursive: true });
  fs.mkdirSync(localLabelsDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const entries = [];
  try {
    for (let i = 0; i < rows.length; i += 1) {
      const item = rows[i];
      const base = exportBaseName(item, i + 1);
      const ext = item.original_ext || ".jpg";
      const exportImageName = `${base}${ext}`;
      const exportLabelName = format === "yolo" ? `${base}.txt` : format === "coco" ? "instances.json" : `${base}.json`;
      const imageStream = await store.getStream(item.object_key);
      const tempImage = path.join(tempDir, exportImageName);
      await new Promise((resolve, reject) => {
        const write = fs.createWriteStream(tempImage);
        imageStream.pipe(write);
        write.on("finish", resolve);
        write.on("error", reject);
      });
      await store.putFile(`${exportPrefix}/images/${exportImageName}`, tempImage);
      fs.copyFileSync(tempImage, path.join(localImagesDir, exportImageName));
      const annotations = annotationsByImage.get(item.id) || [];
      entries.push({ item, annotations, imageName: exportImageName, labelName: exportLabelName });
      if (format === "labelme") {
        const document = labelmeDocument(item, annotations, exportImageName);
        await store.putJson(`${exportPrefix}/jsons/${exportLabelName}`, document);
        fs.writeFileSync(path.join(localLabelsDir, exportLabelName), JSON.stringify(document, null, 2), "utf8");
      }
      await query("INSERT INTO export_items (job_id, project_image_id, export_image_name, export_json_name) VALUES ($1,$2,$3,$4)", [job.id, item.id, exportImageName, exportLabelName]);
      await query("UPDATE jobs SET progress=$1, message=$2 WHERE id=$3", [Math.round(((i + 1) / Math.max(1, rows.length)) * 95), `导出 ${format.toUpperCase()} ${i + 1}/${rows.length}`, job.id]);
    }

    if (format === "coco") {
      const document = cocoDocument(entries);
      const target = path.join(localLabelsDir, "instances.json");
      fs.writeFileSync(target, JSON.stringify(document, null, 2), "utf8");
      await store.putJson(`${exportPrefix}/annotations/instances.json`, document);
    } else if (format === "yolo") {
      const documents = yoloDocuments(entries);
      for (const [name, content] of documents.labelFiles) {
        const target = path.join(localLabelsDir, name);
        fs.writeFileSync(target, content, "utf8");
        await store.putFile(`${exportPrefix}/labels/${name}`, target);
      }
      const yamlTarget = path.join(localRoot, "data.yaml");
      fs.writeFileSync(yamlTarget, documents.dataYaml, "utf8");
      await store.putFile(`${exportPrefix}/data.yaml`, yamlTarget);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const message = `${format.toUpperCase()} 导出完成：${displayLocalRoot}`;
  await query("UPDATE jobs SET status='done', progress=100, message=$1, finished_at=now() WHERE id=$2", [message, job.id]);
  return { jobId: job.id, exportPrefix, outputDir: displayLocalRoot };
}

async function route(req, res) {
  const parsed = url.parse(req.url, true);
  const method = req.method;
  if (method === "GET" && parsed.pathname === "/api/health/live") {
    return sendJson(res, { status: "ok" });
  }
  if (method === "GET" && parsed.pathname === "/api/health/ready") {
    await query("SELECT 1");
    return sendJson(res, { status: shuttingDown ? "stopping" : "ok" }, shuttingDown ? 503 : 200);
  }
  if (method === "GET" && parsed.pathname === "/api/config") {
    return sendJson(res, {
      dataRoot,
      dataRootDisplay,
      browseRoot,
      browseRootDisplay,
      hostDialogUrl,
      nativeDialogMode,
      storageRoot,
      exportRoot: exportRootDisplay,
      platform: process.platform,
    });
  }
  if (method === "GET" && parsed.pathname === "/api/fs/dirs") {
    return sendJson(res, listFolders(parsed.query.path || browseRootDisplay, parsed.query.scope || "browse"));
  }
  if (method === "GET" && parsed.pathname === "/api/dialog/folder") {
    if (nativeDialogMode === "disabled") {
      return sendJson(res, { status: "unavailable", selectedPath: "", error: "系统文件夹选择器未启用" }, 503);
    }
    const purpose = parsed.query.purpose || "import";
    const defaultPath = purpose === "import" ? browseRoot : storageRoot;
    const result = await selectFolder(defaultPath, purpose === "import" ? "选择要导入的数据文件夹" : "选择导出文件夹");
    return sendJson(res, {
      ...result,
      selectedPath: result.selectedPath ? toDisplayDataPath(result.selectedPath) : "",
      dataRoot: dataRootDisplay,
      browseRoot: browseRootDisplay,
      storageRoot,
    });
  }
  if (method === "GET" && parsed.pathname === "/api/projects") return sendJson(res, { projects: await listProjects(false) });
  if (method === "GET" && parsed.pathname === "/api/projects/trash") return sendJson(res, { projects: await listProjects(true) });
  if (method === "DELETE" && parsed.pathname === "/api/projects/trash/empty") return sendJson(res, await emptyProjectTrash());
  if (method === "POST" && parsed.pathname === "/api/projects") return sendJson(res, { project: await createProject(await readBody(req)) });
  const deleteProject = parsed.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === "PATCH" && deleteProject) return sendJson(res, { project: await renameProject(deleteProject[1], await readBody(req)) });
  if (method === "DELETE" && deleteProject) {
    await softDeleteProjectTree(deleteProject[1]);
    return sendJson(res, { ok: true });
  }
  const restoreProject = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/restore$/);
  if (method === "POST" && restoreProject) {
    await restoreProjectTree(restoreProject[1]);
    return sendJson(res, { ok: true });
  }
  if (method === "POST" && parsed.pathname === "/api/imports") return sendJson(res, await importPath(await readBody(req)));
  if (method === "GET" && parsed.pathname === "/api/ml/models") return sendJson(res, { models: await listMlModels() });
  if (method === "POST" && parsed.pathname === "/api/ml/models") return sendJson(res, { model: await createMlModel(await readBody(req)) });
  if (method === "GET" && parsed.pathname === "/api/ml/model-versions") return sendJson(res, { versions: await listModelVersions(parsed.query.modelId || parsed.query.model_id) });
  if (method === "POST" && parsed.pathname === "/api/ml/model-versions") return sendJson(res, { version: await createModelVersion(await readBody(req)) });
  if (method === "GET" && parsed.pathname === "/api/ml/algorithm-assets") return sendJson(res, { algorithms: await listAlgorithmAssets() });
  if (method === "GET" && parsed.pathname === "/api/ml/training-templates") return sendJson(res, { templates: await listTrainingTemplates() });
  if (method === "POST" && parsed.pathname === "/api/ml/training-templates") return sendJson(res, { template: await createTrainingTemplate(await readBody(req)) });
  if (method === "GET" && parsed.pathname === "/api/ml/python-envs") return sendJson(res, { envs: await listPythonEnvs() });
  if (method === "POST" && parsed.pathname === "/api/ml/python-envs") return sendJson(res, { env: await createPythonEnv(await readBody(req)) });
  const renameModelVersionMatch = parsed.pathname.match(/^\/api\/ml\/model-versions\/([^/]+)$/);
  if (method === "PATCH" && renameModelVersionMatch) return sendJson(res, { version: await renameModelVersion(renameModelVersionMatch[1], await readBody(req)) });
  const modelVersionDownload = parsed.pathname.match(/^\/api\/ml\/model-versions\/([^/]+)\/download$/);
  if (method === "GET" && modelVersionDownload) return streamModelArtifact(res, modelVersionDownload[1], parsed.query.artifactId || parsed.query.artifact_id);
  if (method === "GET" && parsed.pathname === "/api/ml/dataset-snapshots") return sendJson(res, { snapshots: await listDatasetSnapshots() });
  if (method === "GET" && parsed.pathname === "/api/ml/training-jobs") return sendJson(res, { jobs: await listTrainingJobs() });
  if (method === "POST" && parsed.pathname === "/api/ml/training-jobs") return sendJson(res, { job: await createTrainingJob(await readBody(req)) });
  const requeueTrainingMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/requeue$/);
  if (method === "POST" && requeueTrainingMatch) return sendJson(res, { job: await requeueTrainingJob(requeueTrainingMatch[1], await readBody(req)) });
  const trainingLogsMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/logs$/);
  if (method === "GET" && trainingLogsMatch) {
    const rows = await query("SELECT * FROM runtime_training_logs WHERE job_id=$1 ORDER BY id DESC LIMIT 300", [trainingLogsMatch[1]]);
    return sendJson(res, { logs: rows.rows.reverse() });
  }
  const trainingMetricsMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/metrics$/);
  if (method === "GET" && trainingMetricsMatch) {
    const rows = await query("SELECT * FROM runtime_training_metrics WHERE job_id=$1 ORDER BY id DESC LIMIT 500", [trainingMetricsMatch[1]]);
    return sendJson(res, { metrics: rows.rows.reverse() });
  }
  if (method === "GET" && parsed.pathname === "/api/ml/inference-jobs") return sendJson(res, { jobs: await listInferenceJobs() });
  if (method === "POST" && parsed.pathname === "/api/ml/inference-jobs") return sendJson(res, { job: await createInferenceJob(await readBody(req)) });
  const deleteInferenceMatch = parsed.pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)$/);
  if (method === "DELETE" && deleteInferenceMatch) return sendJson(res, await deleteInferenceJob(deleteInferenceMatch[1]));
  const inferenceResultsMatch = parsed.pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/results$/);
  if (method === "GET" && inferenceResultsMatch) return sendJson(res, { results: await listInferenceResults(inferenceResultsMatch[1]) });
  if (method === "POST" && parsed.pathname === "/api/baselines/preview") return sendJson(res, await createBaselinePreview(await readBody(req)));
  const baselineConflicts = parsed.pathname.match(/^\/api\/baselines\/([^/]+)\/conflicts$/);
  if (method === "GET" && baselineConflicts) return sendJson(res, { conflicts: await listBaselineConflicts(baselineConflicts[1]) });
  if (method === "POST" && baselineConflicts) return sendJson(res, await resolveBaselineConflicts(baselineConflicts[1], await readBody(req)));
  const applyBaseline = parsed.pathname.match(/^\/api\/baselines\/([^/]+)\/apply$/);
  if (method === "POST" && applyBaseline) return sendJson(res, await applyBaselineRun(applyBaseline[1], await readBody(req)));
  const imports = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/imports$/);
  if (method === "GET" && imports) return sendJson(res, { imports: await listImports(imports[1], parsed.query.trash === "1") });
  const emptyImportsTrash = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/imports\/trash\/empty$/);
  if (method === "DELETE" && emptyImportsTrash) return sendJson(res, await emptyImportTrash(emptyImportsTrash[1]));
  const deleteImport = parsed.pathname.match(/^\/api\/imports\/([^/]+)$/);
  if (method === "DELETE" && deleteImport) {
    await softDeleteImport(deleteImport[1]);
    return sendJson(res, { ok: true });
  }
  const cancelImportMatch = parsed.pathname.match(/^\/api\/imports\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelImportMatch) {
    await cancelImport(cancelImportMatch[1]);
    return sendJson(res, { ok: true });
  }
  const restoreImportMatch = parsed.pathname.match(/^\/api\/imports\/([^/]+)\/restore$/);
  if (method === "POST" && restoreImportMatch) {
    await restoreImport(restoreImportMatch[1]);
    return sendJson(res, { ok: true });
  }
  const summary = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/summary$/);
  if (method === "GET" && summary) return sendJson(res, { summary: await projectSummary(summary[1]) });
  const imageList = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/images$/);
  if (method === "GET" && imageList) return sendJson(res, await listProjectImages(imageList[1], parsed.query));
  const deleteImagesMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/images\/delete$/);
  if (method === "POST" && deleteImagesMatch) {
    return sendJson(res, await softDeleteProjectImages(deleteImagesMatch[1], (await readBody(req)).ids));
  }
  const exportMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
  if (method === "POST" && exportMatch) return sendJson(res, await exportProject(exportMatch[1], await readBody(req)));
  const thumb = parsed.pathname.match(/^\/api\/project-images\/([^/]+)\/thumb$/);
  if (method === "GET" && thumb) return streamProjectImage(res, thumb[1], true);
  const full = parsed.pathname.match(/^\/api\/project-images\/([^/]+)\/full$/);
  if (method === "GET" && full) return streamProjectImage(res, full[1], false);
  const saveAnnotationsMatch = parsed.pathname.match(/^\/api\/project-images\/([^/]+)\/annotations\/save$/);
  if (method === "POST" && saveAnnotationsMatch) return sendJson(res, await saveImageAnnotations(saveAnnotationsMatch[1], await readBody(req)));
  if (method === "GET" && parsed.pathname === "/api/jobs") {
    const rows = await query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50");
    return sendJson(res, { jobs: rows.rows });
  }
  if (method === "GET" && parsed.pathname === "/api/imports/latest") {
    const projectId = parsed.query.projectId || parsed.query.project_id;
    const params = [];
    const where = ["deleted_at IS NULL"];
    if (projectId) {
      params.push(projectId);
      where.push(`project_id=$${params.length}`);
    }
    const rows = await query(
      `SELECT *, CASE WHEN total_files > 0 THEN round((processed_files::numeric / total_files::numeric) * 100)::int ELSE 0 END AS progress
       FROM import_batches WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 1`,
      params,
    );
    return sendJson(res, { importBatch: rows.rows[0] || null });
  }

  // Serve static files from dist/
  if (method === "GET") {
    const distRoot = path.resolve(__dirname, "..", "dist");
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(parsed.pathname === "/" ? "/index.html" : parsed.pathname);
    } catch {
      return sendError(res, 400, "invalid path encoding");
    }
    const filePath = path.resolve(distRoot, `.${requestedPath}`);
    if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${path.sep}`)) {
      return sendError(res, 403, "forbidden");
    }
    try {
      if (fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
          ".json": "application/json",
          ".woff2": "font/woff2",
          ".map": "application/json",
        };
        const contentType = mimeTypes[ext] || "application/octet-stream";
        const content = fs.readFileSync(filePath);
        const cacheControl = requestedPath.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : ext === ".html" ? "no-store" : "public, max-age=3600";
        res.writeHead(200, {
          "content-type": contentType,
          "cache-control": cacheControl,
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
        });
        res.end(content);
        return;
      }
    } catch {
      // File not found, fall through to 404
    }
    // SPA fallback: serve index.html for non-API, non-file routes
    if (!parsed.pathname.startsWith("/api/")) {
      try {
        const indexHtml = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"));
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
        });
        res.end(indexHtml);
        return;
      } catch {}
    }
  }
  sendError(res, 404, "not found");
}

async function main() {
  console.log("Boot: ensureRuntimeSchema start");
  await ensureRuntimeSchema();
  console.log("Boot: ensureRuntimeSchema done");
  await backfillUnknownScenes();
  console.log("Boot: ensureBucketSafe start");

  await store.ensureBucketSafe();
  console.log("Boot: ensureBucketSafe done");
  await ensureBuiltinAlgorithmAssets().catch((error) => console.warn("Algorithm asset seed skipped:", error.message));
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) sendError(res, error.statusCode || 500, error.message);
      else res.end();
    });
  });
  globalThis.detDashboardServer = server;
  server.on("error", (error) => console.error("HTTP server error:", error));
  server.on("close", () => console.error("HTTP server closed"));
  server.listen(port, host, () => {
    console.log(`PostgreSQL + MinIO API: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    console.log(`DATA_ROOT=${dataRoot}`);
    console.log(`DATA_ROOT_DISPLAY=${dataRootDisplay}`);
    console.log(`BROWSE_ROOT=${browseRoot}`);
    console.log(`BROWSE_ROOT_DISPLAY=${browseRootDisplay}`);
    console.log(`STORAGE_ROOT=${storageRoot}`);
  });
  if (process.env.RUN_EXTENDED_SCHEMA === "true") {
    startTrainingWorker();
    startInferenceWorker();
  }
  return server;
}

let httpServer;
let shutdownStarted = false;

async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping gracefully`);
  const serverClosed = new Promise((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(resolve);
  });
  const backgroundTasksStopped = Promise.allSettled([...activeImportTasks, ...activeExportTasks]);
  const timeout = new Promise((resolve) => setTimeout(resolve, 25000));
  await Promise.race([Promise.all([serverClosed, backgroundTasksStopped]), timeout]);
  await pool.end().catch((error) => console.error("PostgreSQL shutdown error:", error.message));
}

process.on("SIGINT", () => shutdown("SIGINT").finally(() => process.exit(0)));
process.on("SIGTERM", () => shutdown("SIGTERM").finally(() => process.exit(0)));

main()
  .then((server) => { httpServer = server; })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });








