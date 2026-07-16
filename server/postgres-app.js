const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const sharp = require("sharp");
const { createRuntimeContext } = require("./bootstrap/runtime-context");
const runtime = createRuntimeContext();
const { host, port, dataRoot, dataRootDisplay, browseRoot, browseRootDisplay, browseAllDrives, hostPathMode, hostDialogUrl, nativeDialogMode, maxRequestBodyBytes, storageRoot, exportRoot, exportRootDisplay, databaseUrl, minio } = runtime.config;
const { pool, query, transaction } = runtime.database;
const store = runtime.store;
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
const { evaluateDetections } = require("./evaluation-metrics");
const { sendJson, sendError, httpError } = runtime.http;
const { createAccessControl } = require("./access-control");
const { createResourceAccess } = require("./resource-access");
const { createCollaborationService } = require("./collaboration-service");
const { createMultiUserRouter } = require("./api-router");
const { createAuthService } = require("./auth-service");
const { createSettingsService } = require("./settings-service");
const { createPathService } = require("./platform/path-service");
const { createProjectService } = require("./dataset/project-service");
const { createDatasetContentService } = require("./dataset/content-service");
const { createTrashService } = require("./dataset/trash-service");
const { createRuntimeQueueService } = require("./runtime-jobs/queue-service");
const { createModelService } = require("./ml-assets/model-service");
const { createPythonEnvService } = require("./ml-assets/python-env-service");
const { createAlgorithmAssetService } = require("./ml-assets/algorithm-asset-service");
const {
  seededRandom,
  hashToSeed,
  clampNumber,
  shuffleWithRng,
  qualityJitter,
  jitterBoxFromGt,
  randomBackgroundBox,
  fakeScore,
  boxIou,
  metricLabel,
  averagePrecision,
} = require("./runtime-jobs/inference-metrics");
const {
  imageObjectKey,
  videoObjectKey,
  rawLabelObjectKey,
  pythonEnvObjectKey,
  pythonEnvManifestKey,
  modelWeightManifestKey,
  serverPythonEnvObjectKey,
  algorithmAssetPrefix,
  algorithmManifestKey,
  algorithmAdapterKey,
} = require("./storage-keys");
const { discoverDatasetSplitPlan, splitForImage, serializeSplitPlan } = require("./dataset-split-plan");
const { analyzeImageGroup, applyConflictDecision } = require("./dataset/baseline-core");
const {
  normalizeTrainingDatasetSplits,
  normalizeTrainingDatasetFilters,
  trainingImageMatchesFilter,
  yamlScalar,
  yoloClassLine,
  parseMetricLine,
} = require("./training-format");

const lifecycle = runtime.lifecycle;
const staticHandler = runtime.staticHandler;

let accessControl;
let resourceAccess;
let collaborationService;
let multiUserRouter;
let projectService;
let datasetContentService;
let runtimeQueueService;
let modelService;
let pythonEnvService;
let algorithmAssetService;
const authService = createAuthService({ query, httpError });
const settingsService = createSettingsService({
  query,
  path,
  databaseUrl,
  dataRoot,
  dataRootDisplay,
  browseRoot,
  browseRootDisplay,
  exportRootDisplay,
  minio,
});
const trashService = createTrashService({ query, transaction, store, httpError });
const { getAppSettings, saveAppSettings } = settingsService;
const pathService = createPathService({
  config: runtime.config,
  fs,
  path,
  childProcess: { spawn },
});
const {
  isInsideRoot,
  toInternalDataPath,
  toDisplayDataPath,
  listFolders,
  selectFolder,
} = pathService;
pythonEnvService = createPythonEnvService({
  query,
  scopeSql: (input) => resourceAccess.scopeSql(input),
  assignOwner: (...args) => resourceAccess.assignOwner(...args),
  fs,
  path,
  process,
  spawnSync,
  crypto,
  store,
  cleanName,
  hashFile,
  pythonEnvObjectKey,
  pythonEnvManifestKey,
  serverPythonEnvObjectKey,
  dataRoot,
  storageRoot,
  minio,
  isInsideRoot,
  writeObjectToFile,
  sendError,
});

function requestedScope(parsed, actor) {
  return String(parsed?.query?.scope || (accessControl.isAdmin(actor) ? "all" : "mine")).toLowerCase();
}

function scopedSql(table, alias, actor, scope, params = []) {
  return resourceAccess.scopeSql({ table, alias, actor, scope, params });
}

async function projectForImage(imageId) {
  return (await query("SELECT project_id FROM project_images WHERE id=$1 AND deleted_at IS NULL", [imageId])).rows[0]?.project_id || null;
}

async function projectForImport(importId) {
  return (await query("SELECT project_id FROM import_batches WHERE id=$1", [importId])).rows[0]?.project_id || null;
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

function uniqueExistingPaths(paths) {
  return Array.from(new Set(paths.filter(Boolean).map((item) => path.resolve(item)))).filter((item) => fs.existsSync(item));
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
        "Ultralytics YOLO template supporting detect / segment / classify",
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
    [JSON.stringify({ tasks: ["detect", "segment", "classify"], autoDetected: true }), "Ultralytics YOLO template supporting detect / segment / classify"],
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
        "DINOv3 + Faster R-CNN directory inference entry for predictions.json/VOC XML.",
      ],
    );
  }
  const dummyTemplate = (await query("SELECT id FROM training_templates WHERE template_key=$1", ["dummy_empty_detector"])).rows[0];
  if (!dummyTemplate) {
    await query(
      `INSERT INTO training_templates (name, template_key, framework, task_type, command_json, default_params_json, capabilities_json, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        "Empty detector inference",
        "dummy_empty_detector",
        "builtin",
        "detect",
        JSON.stringify({ builtin: "empty_predictions" }),
        JSON.stringify({}),
        JSON.stringify({ tasks: ["detect"], algorithmRole: "inference", input: "manifest", output: ["predictions_json"] }),
        "Built-in empty model for inference workflow smoke tests.",
      ],
    );
  }
  const dummyModel = (await query("SELECT * FROM model_clusters WHERE name=$1 AND deleted_at IS NULL", ["Dummy Empty Detector"])).rows[0];
  let dummyModelId = dummyModel?.id;
  if (!dummyModelId) {
    dummyModelId = (await query(
      `INSERT INTO model_clusters (name, task_type, framework, description)
       VALUES ($1,'detect','builtin',$2) RETURNING id`,
      ["Dummy Empty Detector", "Built-in empty detector for inference tests."],
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
    const info = pythonEnvService.inspectPythonEnv(pythonPath);
    const exists = (await query("SELECT id FROM runtime_envs WHERE python_path=$1", [pythonPath])).rows[0];
    if (exists) {
      await query(
        `UPDATE runtime_envs
         SET env_type=$1, status=$2, packages_json=$3, os_type=$4, arch=$5, accelerator=$6,
             python_version=$7, torch_version=$8, cuda_available=$9, cuda_version=$10,
             capabilities_json=$11, updated_at=now()
         WHERE id=$12`,
        [
          pythonEnvService.inferEnvType(pythonPath),
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
        pythonEnvService.inferEnvType(pythonPath),
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
    "ALTER TABLE project_images ADD COLUMN IF NOT EXISTS source_path TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS source_path TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE label_versions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    `CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      display_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
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
      generated_model_version_id UUID,
      initial_model_version_id UUID,
      initialization_strategy TEXT NOT NULL DEFAULT 'random',
      resume_from_checkpoint BOOLEAN NOT NULL DEFAULT false,
      save_period INT NOT NULL DEFAULT -1,
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
      priority INT NOT NULL DEFAULT 0,
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
    `CREATE TABLE IF NOT EXISTS runtime_asset_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      algorithm_asset_id UUID,
      model_id UUID,
      model_version_id UUID,
      python_env_id UUID,
      dataset_project_id UUID,
      last_success_job_id UUID,
      success_count INT NOT NULL DEFAULT 0,
      last_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_success_at TIMESTAMPTZ
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_asset_links_unique
      ON runtime_asset_links (
        COALESCE(algorithm_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(model_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(python_env_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(dataset_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
    "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0",
    "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb",
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
  // Core project browsing, imports, and baseline generation must always have
  // their schema available. Only the larger ML platform schema is optional.
  const runtimeStatements = process.env.RUN_EXTENDED_SCHEMA === "true" ? statements : statements.slice(0, 15);
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
  await authService.seedDefaultAdmin();
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
        generated_model_version_id UUID,
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
        priority INT NOT NULL DEFAULT 0,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0",
      "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb",
      `CREATE TABLE IF NOT EXISTS runtime_inference_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inference_job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
        project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
        predictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        artifact_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_asset_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        algorithm_asset_id UUID,
        model_id UUID,
        model_version_id UUID,
        python_env_id UUID,
        dataset_project_id UUID,
        last_success_job_id UUID,
        success_count INT NOT NULL DEFAULT 0,
        last_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_success_at TIMESTAMPTZ
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_asset_links_unique
        ON runtime_asset_links (
          COALESCE(algorithm_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(model_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(python_env_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(dataset_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )`,
    ];
    const assetRuntimeStatements = [
      mlRuntimeStatements[0],
      mlRuntimeStatements[1],
      mlRuntimeStatements[2],
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
        generated_model_version_id UUID,
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
        priority INT NOT NULL DEFAULT 0,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0",
      "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb",
      `CREATE TABLE IF NOT EXISTS runtime_inference_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inference_job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
        project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
        predictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        artifact_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_asset_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        algorithm_asset_id UUID,
        model_id UUID,
        model_version_id UUID,
        python_env_id UUID,
        dataset_project_id UUID,
        last_success_job_id UUID,
        success_count INT NOT NULL DEFAULT 0,
        last_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_success_at TIMESTAMPTZ
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_asset_links_unique
        ON runtime_asset_links (
          COALESCE(algorithm_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(model_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(python_env_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(dataset_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
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

  const modelArtifactMigrationStatements = [
    `ALTER TABLE IF EXISTS runtime_training_jobs
       ADD COLUMN IF NOT EXISTS generated_model_version_id UUID`,
    `ALTER TABLE IF EXISTS runtime_training_jobs ADD COLUMN IF NOT EXISTS initial_model_version_id UUID`,
    `ALTER TABLE IF EXISTS runtime_training_jobs ADD COLUMN IF NOT EXISTS initialization_strategy TEXT NOT NULL DEFAULT 'random'`,
    `ALTER TABLE IF EXISTS runtime_training_jobs ADD COLUMN IF NOT EXISTS resume_from_checkpoint BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE IF EXISTS runtime_training_jobs ADD COLUMN IF NOT EXISTS save_period INT NOT NULL DEFAULT -1`,
    `DO $$
     BEGIN
       IF to_regclass('runtime_training_jobs') IS NOT NULL
          AND to_regclass('model_revisions') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname='runtime_training_jobs_generated_model_version_fk'
          ) THEN
         ALTER TABLE runtime_training_jobs
           ADD CONSTRAINT runtime_training_jobs_generated_model_version_fk
           FOREIGN KEY (generated_model_version_id) REFERENCES model_revisions(id) ON DELETE SET NULL;
       END IF;
     END $$`,
    `DO $$
     BEGIN
       IF to_regclass('runtime_training_jobs') IS NOT NULL
          AND to_regclass('model_revisions') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='runtime_training_jobs_initial_model_version_fk') THEN
         ALTER TABLE runtime_training_jobs ADD CONSTRAINT runtime_training_jobs_initial_model_version_fk
           FOREIGN KEY (initial_model_version_id) REFERENCES model_revisions(id) ON DELETE SET NULL;
       END IF;
     END $$`,
    `DELETE FROM model_files newer
       USING model_files older
       WHERE newer.model_version_id=older.model_version_id
         AND newer.path=older.path
         AND (newer.created_at, newer.id) < (older.created_at, older.id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_model_files_version_path_unique
       ON model_files (model_version_id, path)`,
  ];
  for (const sql of modelArtifactMigrationStatements) await query(sql);

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

async function cleanupLegacyHistoryProjects() {
  const legacy = (await query(
    `SELECT p.id,
       EXISTS (SELECT 1 FROM project_images pi WHERE pi.project_id=p.id) AS has_images,
       EXISTS (SELECT 1 FROM project_videos pv WHERE pv.project_id=p.id) AS has_videos,
       EXISTS (SELECT 1 FROM import_batches ib WHERE ib.project_id=p.id) AS has_imports,
       EXISTS (SELECT 1 FROM label_versions lv WHERE lv.project_id=p.id) AS has_labels
     FROM projects p
     WHERE p.name='历史项目'
       AND p.parent_id IS NULL`,
  )).rows;
  for (const row of legacy) {
    if (row.has_images || row.has_videos || row.has_imports || row.has_labels) {
      await query("UPDATE projects SET name='迁移项目', updated_at=now() WHERE id=$1", [row.id]);
    } else {
      await query("UPDATE projects SET parent_id=NULL WHERE parent_id=$1", [row.id]);
      await query("DELETE FROM projects WHERE id=$1", [row.id]);
    }
  }
}

async function ensureSplitProjects(parentProject, splitPlan, ownerUserId = parentProject.owner_user_id) {
  if (!splitPlan) return {};
  const ids = {};
  for (const split of ["train", "val", "test"]) {
    const entry = splitPlan[split];
    if (!entry.files.size && !entry.directories.size) continue;
    let row = (await query(
      "SELECT id FROM projects WHERE parent_id=$1 AND lower(name)=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
      [parentProject.id, split],
    )).rows[0];
    if (!row) row = (await query(
      "INSERT INTO projects (name, description, project_type, parent_id, owner_user_id, visibility) VALUES ($1,$2,'dataset_split',$3,$4,'private') RETURNING id",
      [split, `${parentProject.name} ${split} split`, parentProject.id, ownerUserId],
    )).rows[0];
    await accessControl.ensureAssetOwner({ id: ownerUserId }, "project", row.id);
    ids[split] = row.id;
  }
  return ids;
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

async function importPath(body, actor) {
  const projectId = body.projectId;
  if (!projectId) throw new Error("projectId is required");
  await resourceAccess.assertProjectWrite(actor, projectId);
  if (lifecycle.isShuttingDown()) {
    const error = new Error("Service is shutting down and cannot accept new imports.");
    error.statusCode = 503;
    throw error;
  }
  const rawSourcePaths = Array.isArray(body.sourcePaths)
    ? body.sourcePaths
    : String(body.sourcePath || "").split(";").map((item) => item.trim()).filter(Boolean);
  const sourcePaths = Array.from(new Set(rawSourcePaths.map((item) => toInternalDataPath(item)).filter(Boolean)));
  if (!sourcePaths.length) throw httpError(400, "No dataset folder path was selected.");
  for (const sourcePath of sourcePaths) {
    if (!fs.existsSync(sourcePath)) throw httpError(400, "Import path does not exist: " + sourcePath);
    if (!fs.statSync(sourcePath).isDirectory()) throw httpError(400, "Import path must be a folder: " + sourcePath);
  }
  body.sourcePath = sourcePaths[0];
  body.sourcePaths = sourcePaths;
  const manifestGroups = sourcePaths.map((sourceRoot) => ({ sourceRoot, files: walk(sourceRoot) }));
  const splitPlan = discoverDatasetSplitPlan(manifestGroups);
  body.splitPlan = splitPlan;

  const { project, batch } = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [String(projectId)]);
    const projectRow = (await client.query("SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL", [projectId])).rows[0];
    if (!projectRow) throw new Error("project not found");
    const active = (await client.query(
      "SELECT id FROM import_batches WHERE project_id=$1 AND deleted_at IS NULL AND status IN ('scanning','running','cancel_requested') LIMIT 1",
      [projectId],
    )).rows[0];
    if (active) {
      const error = new Error("An import task is already running for this project.");
      error.statusCode = 409;
      throw error;
    }
    const batchRow = (await client.query(
      `INSERT INTO import_batches (project_id, source_path, import_mode, source_type, status, total_files, processed_files, message)
       VALUES ($1,$2,'merge_project','server_path','scanning',0,0,$3) RETURNING *`,
      [projectId, sourcePaths.map((sourcePath) => toDisplayDataPath(sourcePath)).join(";"), "正在扫描文件"],
    )).rows[0];
    return { project: projectRow, batch: batchRow };
  });
  await resourceAccess.assignOwner("import_batches", batch.id, actor);
  const splitProjectIds = await ensureSplitProjects(project, splitPlan, actor.id);
  body.actorId = actor.id;
  body.splitProjectIds = splitProjectIds;

  const importTask = new Promise((resolve) => setImmediate(resolve))
    .then(() => runImportBatch(batch.id, project, body))
    .catch(async (error) => {
      console.error("import failed", error);
      await query(
        "UPDATE import_batches SET status='failed', message=$1, finished_at=now() WHERE id=$2",
        [error.message || "导入失败", batch.id],
      ).catch(() => {});
    });
  lifecycle.trackImport(importTask);

  return { project, batch, splitResult: serializeSplitPlan(splitPlan, splitProjectIds, toDisplayDataPath) };
}

async function importCancelled(batchId) {
  if (lifecycle.isShuttingDown()) return true;
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
  const sourceRoots = Array.from(new Set((Array.isArray(body.sourcePaths) && body.sourcePaths.length ? body.sourcePaths : [body.sourcePath])
    .map((item) => path.resolve(item || ""))
    .filter(Boolean)));
  let lastCancellationCheck = 0;
  const sourceGroups = [];
  try {
    for (const sourceRoot of sourceRoots) {
      const files = await walkAsync(sourceRoot, {
        shouldStop: async () => {
          if (lifecycle.isShuttingDown()) return true;
          const now = Date.now();
          if (now - lastCancellationCheck < 500) return false;
          lastCancellationCheck = now;
          return importCancelled(batchId);
        },
      });
      const images = files.filter((file) => IMAGE_EXTS.has(path.extname(file).toLowerCase()));
      const videos = files.filter((file) => VIDEO_EXTS.has(path.extname(file).toLowerCase()));
      const parsed = buildDatasetMatches({ files, images, sourceRoot });
      sourceGroups.push({ sourceRoot, files, images, videos, ...parsed });
    }
  } catch (error) {
    if (error.code !== "SCAN_CANCELLED") throw error;
    await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["Import cancelled", batchId]);
    return;
  }
  const images = sourceGroups.flatMap((group) => group.images.map((file) => ({ file, sourceRoot: group.sourceRoot, matches: group.matches })));
  const videos = sourceGroups.flatMap((group) => group.videos.map((file) => ({ file, sourceRoot: group.sourceRoot })));
  const unresolved = sourceGroups.flatMap((group) => group.unresolved || []);
  const usedLabelFiles = sourceGroups.flatMap((group) => (group.usedLabelFiles || []).map((file) => ({ file, sourceRoot: group.sourceRoot })));
  const formatCounts = sourceGroups.reduce((acc, group) => {
    acc.labelme += group.formatCounts?.labelme || 0;
    acc.coco += group.formatCounts?.coco || 0;
    acc.yolo += group.formatCounts?.yolo || 0;
    acc.voc += group.formatCounts?.voc || 0;
    return acc;
  }, { labelme: 0, coco: 0, yolo: 0, voc: 0 });
  const splitPlan = body.splitPlan || discoverDatasetSplitPlan(sourceGroups);
  const splitProjectIds = Object.keys(body.splitProjectIds || {}).length
    ? body.splitProjectIds
    : await ensureSplitProjects(project, splitPlan, body.actorId || project.owner_user_id);
  const splitResult = serializeSplitPlan(splitPlan, splitProjectIds, toDisplayDataPath);

  await query(
    "UPDATE import_batches SET status='running', total_files=$1, processed_files=0, message=$2 WHERE id=$3",
    [images.length + videos.length, `扫描完成：${images.length} 图片，${videos.length} 视频；LabelMe ${formatCounts.labelme}，COCO ${formatCounts.coco}，YOLO ${formatCounts.yolo}`, batchId],
  );
  if (await importCancelled(batchId)) {
    await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["Import cancelled", batchId]);
    return;
  }

  const client = { query };
  const targetProjectIds = Array.from(new Set([projectId, ...Object.values(splitProjectIds)]));
  const versionsByProject = new Map();
  for (const targetProjectId of targetProjectIds) {
    const version = (await query(
      `INSERT INTO label_versions (project_id, name, target_type, status, import_batch_id)
       VALUES ($1,$2,'image','active',$3) RETURNING *`,
      [targetProjectId, body.labelVersionName || `import_${new Date().toISOString()}`, batchId],
    )).rows[0];
    await resourceAccess.assignOwner("label_versions", version.id, { id: body.actorId || project.owner_user_id });
    versionsByProject.set(String(targetProjectId), version);
    await query("UPDATE projects SET active_label_version_id=$1, updated_at=now() WHERE id=$2", [version.id, targetProjectId]);
  }

  for (const item of usedLabelFiles) {
    const relative = path.relative(item.sourceRoot, item.file).replace(/\.\.(?:[\\/]|$)/g, "").replace(/[\\/]+/g, "__");
    for (const [targetProjectId, version] of versionsByProject) {
      await store.putFile(rawLabelObjectKey(targetProjectId, version.id, relative || path.basename(item.file)), item.file);
    }
  }

  let imageCount = 0;
  let annCount = 0;
  let unlabeledImageCount = 0;
  const actualSplitCounts = { train: 0, val: 0, test: 0 };
  for (const imageEntry of images) {
    const imageFile = imageEntry.file;
    if (imageCount % 5 === 0 && await importCancelled(batchId)) {
    await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["Import cancelled", batchId]);
      return;
    }
    const matched = imageEntry.matches.get(imageKey(imageFile));
    const split = splitForImage(imageFile, splitPlan);
    if (split && Object.prototype.hasOwnProperty.call(actualSplitCounts, split)) actualSplitCounts[split] += 1;
    const targetProjectId = splitProjectIds[split] || projectId;
    const version = versionsByProject.get(String(targetProjectId));
    const meta = matched?.meta || {};
    const scene = inferSceneFromPath(meta, imageFile, imageEntry.sourceRoot);
    const asset = await upsertImageAsset(client, imageFile, meta);
    const modality = inferModality(meta, imageFile);
    const displayName = body.rename
      ? `${cleanName(meta.view, "UnknownView")}_${cleanName(scene, "UnknownScene")}_${modality === "infrared" ? "IR" : "VIS"}_${String(imageCount + 1).padStart(6, "0")}${path.extname(imageFile).toLowerCase()}`
      : path.basename(imageFile);
    const projectImage = await upsertProjectImage(client, {
      projectId: targetProjectId,
      imageAssetId: asset.id,
      importBatchId: batchId,
      displayName,
      sourcePath: toDisplayDataPath(imageFile),
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
  for (const videoEntry of videos) {
    const videoFile = videoEntry.file;
    if (await importCancelled(batchId)) {
    await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["Import cancelled", batchId]);
      return;
    }
    const asset = await upsertVideoAsset(client, videoFile);
    await query(
      `INSERT INTO project_videos (project_id, video_asset_id, import_batch_id, display_name, source_path, label_status)
       VALUES ($1,$2,$3,$4,$5,'unlabeled')`,
      [projectId, asset.id, batchId, path.basename(videoFile), toDisplayDataPath(videoFile)],
    );
    videoCount += 1;
    await query("UPDATE import_batches SET processed_files=$1, message=$2 WHERE id=$3", [images.length + videoCount, `正在导入视频 ${videoCount} / ${videos.length}`, batchId]);
  }

  for (const [splitName, value] of Object.entries(splitResult.splits || {})) {
    value.plannedImages = value.listedImages;
    value.listedImages = actualSplitCounts[splitName] || 0;
    value.importedImages = actualSplitCounts[splitName] || 0;
  }
  const splitMessage = splitResult.detected
    ? `；划分 ${Object.entries(splitResult.splits).map(([name, value]) => `${name}:${value.listedImages}`).join("，")}`
    : "";
  const message = `导入完成：${imageCount} 图片，${unlabeledImageCount} 无目标图片，${videoCount} 视频，${annCount} 标注，${unresolved.length} 条警告；LabelMe ${formatCounts.labelme}，COCO ${formatCounts.coco}，YOLO ${formatCounts.yolo}${splitMessage}`;
  await query("UPDATE import_batches SET status='done', processed_files=$1, message=$2, finished_at=now() WHERE id=$3", [images.length + videos.length, message, batchId]);
}

async function upsertProjectImage(client, image) {
  const params = [
    image.projectId,
    image.imageAssetId,
    image.importBatchId,
    image.displayName,
    image.sourcePath || "",
    image.scene,
    image.view,
    image.modality,
    image.keyword,
  ];
  const upsertSql = `
    INSERT INTO project_images (project_id, image_asset_id, import_batch_id, display_name, source_path, scene, view, modality, keyword)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (project_id, image_asset_id, display_name)
    DO UPDATE SET
      import_batch_id=EXCLUDED.import_batch_id,
      source_path=EXCLUDED.source_path,
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
           source_path=$5,
           scene=$6,
           view=$7,
           modality=$8,
           keyword=$9,
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

async function sourceImageRows(sourceProjectIds) {
  const rows = await query(
    `SELECT pi.*, ia.sha256, ia.width AS image_width, ia.height AS image_height, ia.original_ext,
            p.name AS project_name, p.active_label_version_id
     FROM project_images pi
     JOIN projects p ON p.id=pi.project_id
     JOIN image_assets ia ON ia.id=pi.image_asset_id
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
  if (sourceProjectIds.length < 1) throw new Error("Select at least one source project.");
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

async function applyBaselineRun(runId, body = {}, actor) {
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
  const result = await transaction(async (client) => {
    const decisions = await client.query("SELECT * FROM baseline_conflicts WHERE merge_run_id=$1", [runId]);
    const decisionByAsset = new Map(decisions.rows.map((row) => [String(row.image_asset_id), row]));
    const project = (await client.query(
      "INSERT INTO projects (name, description, project_type, owner_user_id, visibility) VALUES ($1,$2,'baseline',$3,'private') RETURNING *",
      [body.name || run.name, `Baseline generated from ${sourceProjectIds.length} projects`, actor.id],
    )).rows[0];
    const version = (await client.query(
      "INSERT INTO label_versions (project_id, name, target_type, status, created_by_user_id) VALUES ($1,$2,'image','active',$3) RETURNING *",
      [project.id, "baseline_v1", actor.id],
    )).rows[0];
    let imageCount = 0;
    let annCount = 0;
    for (const group of byAsset.values()) {
      const analysis = applyConflictDecision(group, params, decisionByAsset.get(String(group[0].image_asset_id)));
      const source = analysis.chosenRow;
      const pi = (await client.query(
        `INSERT INTO project_images (project_id, image_asset_id, display_name, source_path, scene, view, modality, keyword)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (project_id, image_asset_id, display_name) DO UPDATE SET deleted_at=NULL
         RETURNING *`,
        [project.id, source.image_asset_id, source.display_name, source.source_path || "", source.scene, source.view, source.modality, source.keyword],
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
  await accessControl.ensureAssetOwner(actor, "project", result.project.id);
  return result;
}

function dateCode() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function minuteCode(date = new Date()) {
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
  return parts.map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0")).join("");
}

function inferenceJobName(taskName, datasetName, fallbackName = "inference") {
  const normalize = (value) => String(value || "").trim().replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  return [normalize(taskName) || normalize(fallbackName), normalize(datasetName) || "dataset", minuteCode()].join("_");
}

async function clearModelAssets(body = {}) {
  const confirm = String(body.confirm || "");
  const execute = confirm === "CLEAR_MODEL_ASSETS";
  const modelFiles = (await query("SELECT id, path, metadata_json FROM model_files ORDER BY created_at DESC")).rows;
  const modelVersions = (await query("SELECT id, artifact_root FROM model_revisions ORDER BY created_at DESC")).rows;
  const modelClusters = (await query("SELECT id FROM model_clusters WHERE deleted_at IS NULL")).rows;
  const objectKeys = new Set();
  for (const row of modelFiles) {
    if (row.path && String(row.path).startsWith("ml/artifacts/models/")) objectKeys.add(row.path);
    const meta = row.metadata_json || {};
    if (meta.manifestKey && String(meta.manifestKey).startsWith("ml/artifacts/models/")) objectKeys.add(meta.manifestKey);
    if (meta.weightKey && String(meta.weightKey).startsWith("ml/artifacts/models/")) objectKeys.add(meta.weightKey);
  }
  for (const key of await store.listObjectKeys("ml/artifacts/models/")) objectKeys.add(key);

  const localRoots = [
    path.join(storageRoot, "runtime", "models"),
    path.join(storageRoot, "runtime", "model-cache"),
  ];

  if (!execute) {
    return {
      dryRun: true,
      requiresConfirm: "CLEAR_MODEL_ASSETS",
      counts: {
        modelClusters: modelClusters.length,
        modelVersions: modelVersions.length,
        modelFiles: modelFiles.length,
        minioObjects: objectKeys.size,
        localRoots: localRoots.filter((root) => fs.existsSync(root)).length,
      },
      scope: {
        tables: ["model_files", "model_revisions", "model_clusters"],
        minioPrefix: "ml/artifacts/models/",
        localRoots,
        excludes: ["projects", "project_images", "project_videos", "image_assets", "image_annotations", "dataset_snapshots"],
      },
    };
  }

  for (const key of objectKeys) await store.removeObject(key);
  for (const root of localRoots) {
    const resolved = path.resolve(root);
    if (isInsideRoot(storageRoot, resolved) && fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
  }
  await query("DELETE FROM model_files");
  await query("DELETE FROM model_revisions");
  await query("UPDATE model_clusters SET deleted_at=now(), updated_at=now() WHERE deleted_at IS NULL");
  return {
    dryRun: false,
    deleted: {
      modelClusters: modelClusters.length,
      modelVersions: modelVersions.length,
      modelFiles: modelFiles.length,
      minioObjects: objectKeys.size,
      localRoots: localRoots.filter((root) => !fs.existsSync(root)).length,
    },
  };
}

async function listDatasetSnapshots(actor, scope = "mine") {
  const scoped = scopedSql("dataset_snapshots", "ds", actor, scope);
  const rows = await query(
    `SELECT ds.*, p.name AS source_project_name
     FROM dataset_snapshots ds
     LEFT JOIN projects p ON p.id=ds.source_project_id
     WHERE ${scoped.sql}
     ORDER BY ds.created_at DESC
     LIMIT 200`,
    scoped.params,
  );
  return rows.rows;
}

async function listTrainingTemplates(actor, scope = "mine") {
  try {
    const scoped = scopedSql("training_templates", "t", actor, scope);
    return (await query(`SELECT t.* FROM training_templates t WHERE ${scoped.sql} ORDER BY created_at DESC`, scoped.params)).rows;
  } catch (error) {
    if (error.code !== "42P01") throw error;
    return algorithmAssetService.getBuiltinTrainingTemplateFallbacks();
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

async function createTrainingTemplate(body = {}, actor) {
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
  return resourceAccess.assignOwner("training_templates", rows.rows[0].id, actor, { visibility: body.visibility || "private" });
}

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
      ...job, ...splits,
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
       LIMIT 200`, scoped.params,
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

function stopProcess(pid) {
  const numericPid = Number(pid);
  if (!numericPid || numericPid === process.pid) return false;
  try {
    process.kill(numericPid);
    return true;
  } catch (error) {
    if (process.platform === "win32") {
      try {
        spawn("taskkill", ["/PID", String(numericPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }
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
       LIMIT 200`, scoped.params,
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
    reason: groundTruthRows.length ? "仅对存在真值标注的图片进行评估；未标注图片的推理结果仍已保存" : "推理结果已保存，但当前数据集没有可用于评估的活动标签版本或标注",
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
async function recordRuntimeAssetLink(job, metrics = {}) {
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

async function backfillRuntimeAssetLinks() {
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
    await recordRuntimeAssetLink(job, metrics).catch(() => {});
  }
}

async function listRuntimeAssetLinks(actor, scope = "mine") {
  try {
    await backfillRuntimeAssetLinks();
    let scopedParams = [];
    const scopeConditions = [];
    for (const [table, alias] of [["algorithm_assets", "aa"], ["model_clusters", "mc"], ["runtime_envs", "re"], ["projects", "p"]]) {
      const scoped = scopedSql(table, alias, actor, scope, scopedParams);
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

async function createInferenceJob(body = {}, actor) {
  const datasetProjectId = body.datasetProjectId || body.dataset_project_id || null;
  if (datasetProjectId) await resourceAccess.assertProjectRead(actor, datasetProjectId);
  if (!datasetProjectId) throw new Error("请选择推理数据集项目");
  const project = (await query("SELECT id, name FROM projects WHERE id=$1 AND deleted_at IS NULL", [datasetProjectId])).rows[0];
  if (!project) throw new Error("推理数据集项目不存在");
  const modelVersionId = body.modelVersionId || body.model_version_id || null;
  let modelFramework = "";
  if (modelVersionId) {
    await resourceAccess.assertIndependentAccess("model_revisions", modelVersionId, actor, "read");
    const version = (await query(
      `SELECT mv.id, mc.framework
       FROM model_revisions mv
       LEFT JOIN model_clusters mc ON mc.id=mv.model_id
       WHERE mv.id=$1`,
      [modelVersionId],
    )).rows[0];
    if (!version) throw new Error("模型版本不存在");
    modelFramework = String(version.framework || "").toLowerCase();
  }
  const params = body.params || {};
  const requestedAlgorithmAssetId = body.algorithmAssetId || body.algorithm_asset_id || params.algorithmAssetId || params.templateId || null;
  const algorithmScopes = await Promise.all(["mine", "shared", "public"].map((scope) => algorithmAssetService.listAlgorithmAssets(actor, scope)));
  const algorithms = [...new Map(algorithmScopes.flat().map((item) => [String(item.id), item])).values()];
  const algorithm = requestedAlgorithmAssetId
    ? algorithms.find((item) => String(item.id) === String(requestedAlgorithmAssetId) || item.algorithm_key === requestedAlgorithmAssetId || item.template_key === requestedAlgorithmAssetId)
    : algorithms.find((item) => modelFramework && String(item.framework || "").toLowerCase() === modelFramework)
      || algorithms.find((item) => item.algorithm_key === "dummy_empty_detector")
      || algorithms[0];
  if (!algorithm) throw new Error(requestedAlgorithmAssetId ? "算法资产不存在" : "请选择算法名称：推理任务必须绑定一个算法资产");
  params.algorithmAssetId = algorithm.id;
  params.templateId = algorithm.id;
  params.algorithmKey = algorithm.algorithm_key || algorithm.template_key;
  params.templateKey = algorithm.algorithm_key || algorithm.template_key;
  params.templateName = algorithm.name;
  params.manifestKey = algorithm.manifest_key;
  params.adapterKey = algorithm.adapter_key;
  params.algorithmMinioPrefix = algorithm.minio_prefix;
  const name = inferenceJobName(body.name, project.name, algorithm.name || algorithm.algorithm_key);
  const inserted = await query(
    `INSERT INTO runtime_inference_jobs (name, model_version_id, dataset_project_id, status, params_json, message, priority)
     VALUES ($1,$2,$3,'preparing',$4,$5,(SELECT COALESCE(MAX(priority), 0) + 1 FROM runtime_inference_jobs)) RETURNING *`,
    [name, modelVersionId, datasetProjectId, JSON.stringify(params), "正在准备推理输入缓存"],
  );
  const job = inserted.rows[0];
  await resourceAccess.assignOwner("runtime_inference_jobs", job.id, actor);
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
  const where = ["pi.project_id=$1", "pi.deleted_at IS NULL", "p.deleted_at IS NULL"];

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
     JOIN projects p ON p.id=pi.project_id
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

function isDummyInferenceJob(job) {
  const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  const key = params.algorithmKey || params.templateKey;
  return key === "dummy_empty_detector";
}

function isFakeReferenceInferenceJob(job) {
  const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  const key = params.algorithmKey || params.templateKey;
  return key === "fake_reference_detector";
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
    const metrics = await computeDetectionMetrics(job, predictionRows);
    const nextParams = {
      ...params,
      output: {
        ...(params.output || {}),
        predictionsPath,
        resultCount: predictionRows.length,
        predictionCount: 0,
        completedAt: new Date().toISOString(),
        metrics,
      },
    };
    await client.query(
      "UPDATE runtime_inference_jobs SET status='done', progress=100, params_json=$1, metrics_json=$2, message=$3, finished_at=now() WHERE id=$4",
      [JSON.stringify(nextParams), JSON.stringify(metrics), `空模型推理完成：${predictionRows.length} 张图片，0 个预测框`, job.id],
    );
  });
}

function fakeReferenceConfigCandidates() {
  return uniqueExistingPaths([
    process.env.DET_DASHBOARD_REFERENCE,
    process.env.DD_REFERENCE,
    process.env.DET_DASHBOARD_RUNTIME ? path.join(process.env.DET_DASHBOARD_RUNTIME, "reference.json") : "",
    process.env.DD_RUNTIME ? path.join(process.env.DD_RUNTIME, "reference.json") : "",
    path.join(path.dirname(storageRoot), "reference.json"),
    path.join(storageRoot, "reference.json"),
    path.resolve(__dirname, "..", "..", "DD-runtime", "reference.json"),
  ]);
}

function readFakeReferenceConfig() {
  const defaults = {
    targetPrecision: 0.9,
    targetRecall: 0.8,
    targetMap50: 0.8,
    quality: "good",
    seed: 20260707,
    time: 20,
  };
  const configPath = fakeReferenceConfigCandidates()[0] || null;
  const loaded = configPath ? JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")) : {};
  const config = { ...defaults, ...(loaded || {}) };
  config.targetPrecision = clampNumber(config.targetPrecision, 0.01, 1);
  config.targetRecall = clampNumber(config.targetRecall, 0, 1);
  config.targetMap50 = clampNumber(config.targetMap50, 0, 1);
  config.seed = Number.isFinite(Number(config.seed)) ? Number(config.seed) : defaults.seed;
  config.time = Math.max(0, Number(config.time ?? defaults.time));
  config.quality = String(config.quality || defaults.quality).toLowerCase();
  config.effectiveMap50 = Math.min(config.targetMap50, config.targetRecall);
  return { config, configPath };
}

async function loadFakeReferenceGroundTruth(job, images) {
  const imageIds = images.map((image) => image.projectImageId).filter(Boolean);
  if (!imageIds.length) throw new Error("Fake GT inference requires project image ids in the input manifest.");
  const project = (await query("SELECT id, active_label_version_id FROM projects WHERE id=$1", [job.dataset_project_id])).rows[0];
  if (!project?.active_label_version_id) throw new Error("Fake GT inference requires an active label version with ground truth.");
  const gtRows = (await query(
    `SELECT project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h
     FROM image_annotations
     WHERE label_version_id=$1 AND project_image_id = ANY($2::uuid[])`,
    [project.active_label_version_id, imageIds],
  )).rows;
  if (!gtRows.length) throw new Error("Fake GT inference did not find ground-truth boxes for the selected images.");
  const gtByImage = new Map();
  for (const gt of gtRows) {
    const list = gtByImage.get(gt.project_image_id) || [];
    list.push(gt);
    gtByImage.set(gt.project_image_id, list);
  }
  return { gtRows, gtByImage };
}

function generateFakeReferenceRows(images, gtRows, gtByImage, config, seed) {
  const rng = seededRandom(seed);
  const labels = Array.from(new Set(gtRows.map((gt) => metricLabel(gt)).filter(Boolean)));
  const gtWithIndex = gtRows.map((gt, index) => ({ ...gt, metricLabel: metricLabel(gt), fakeIndex: index }));
  const targetTp = Math.min(gtWithIndex.length, Math.max(0, Math.round(gtWithIndex.length * config.targetRecall)));
  const targetFp = Math.max(0, Math.round(targetTp * (1 / Math.max(0.01, config.targetPrecision) - 1)));
  const hitSet = new Set(shuffleWithRng(gtWithIndex, rng).slice(0, targetTp).map((gt) => gt.fakeIndex));
  const rows = images.map((image) => ({
    index: image.index,
    cachedFileName: image.cachedFileName,
    projectImageId: image.projectImageId,
    imageAssetId: image.imageAssetId,
    originalFileName: image.originalFileName,
    width: image.width,
    height: image.height,
    inferenceMs: Number((config.time * (0.75 + rng() * 0.5)).toFixed(2)),
    predictions: [],
  }));
  const rowsByImage = new Map(rows.map((row) => [row.projectImageId, row]));
  const hitGts = [];
  for (const gt of gtWithIndex) {
    if (!hitSet.has(gt.fakeIndex)) continue;
    const row = rowsByImage.get(gt.project_image_id);
    if (!row) continue;
    const box = jitterBoxFromGt(gt, row, config.quality, rng, true);
    row.predictions.push({
      label: gt.metricLabel,
      score: fakeScore("tp", rng, config),
      ...box,
    });
    hitGts.push(gt);
  }

  let fpRemaining = targetFp;
  const duplicateCount = Math.min(fpRemaining, Math.round(hitGts.length * 0.08));
  for (let index = 0; index < duplicateCount; index += 1) {
    const gt = hitGts[Math.floor(rng() * hitGts.length)];
    const row = rowsByImage.get(gt.project_image_id);
    if (!gt || !row) continue;
    row.predictions.push({
      label: gt.metricLabel,
      score: fakeScore("duplicate", rng, config),
      ...jitterBoxFromGt(gt, row, config.quality, rng, true),
    });
    fpRemaining -= 1;
  }

  const confusionCount = Math.min(fpRemaining, Math.round(gtWithIndex.length * 0.03));
  for (let index = 0; index < confusionCount; index += 1) {
    const gt = gtWithIndex[Math.floor(rng() * gtWithIndex.length)];
    const row = rowsByImage.get(gt.project_image_id);
    if (!gt || !row) continue;
    const wrongLabels = labels.filter((label) => label !== gt.metricLabel);
    row.predictions.push({
      label: wrongLabels.length ? wrongLabels[Math.floor(rng() * wrongLabels.length)] : `${gt.metricLabel}_fp`,
      score: fakeScore("confusion", rng, config),
      ...jitterBoxFromGt(gt, row, config.quality, rng, true),
    });
    fpRemaining -= 1;
  }

  const imagesWithGt = images.filter((image) => (gtByImage.get(image.projectImageId) || []).length);
  while (fpRemaining > 0 && imagesWithGt.length) {
    const image = imagesWithGt[Math.floor(rng() * imagesWithGt.length)];
    const row = rowsByImage.get(image.projectImageId);
    const imageGt = gtByImage.get(image.projectImageId) || [];
    row.predictions.push({
      label: labels[Math.floor(rng() * labels.length)] || "fake",
      score: fakeScore("background", rng, config),
      ...randomBackgroundBox(row, imageGt, rng),
    });
    fpRemaining -= 1;
  }

  return rows;
}

function metricDistance(metrics, config) {
  if (!metrics?.evaluated) return Number.POSITIVE_INFINITY;
  return Math.abs(Number(metrics.precision || 0) - config.targetPrecision)
    + Math.abs(Number(metrics.recall || 0) - config.targetRecall)
    + Math.abs(Number(metrics.map50 || 0) - config.effectiveMap50);
}

async function runFakeReferenceInferenceJob(job) {
  const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  const input = params.input || {};
  const manifestPath = input.manifestPath || path.join(job.output_root, "input-cache", "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Inference input manifest does not exist.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const outputRoot = job.output_root || path.join(storageRoot, "runtime", "inference", job.id);
  const outputDir = path.join(outputRoot, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const images = Array.isArray(manifest.images) ? manifest.images : [];
  const { config, configPath } = readFakeReferenceConfig();
  const { gtRows, gtByImage } = await loadFakeReferenceGroundTruth(job, images);
  const baseSeed = (Number(config.seed) >>> 0) ^ hashToSeed(job.id);
  let bestRows = [];
  let bestMetrics = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const iterations = 12;
  for (let index = 0; index < iterations; index += 1) {
    const rows = generateFakeReferenceRows(images, gtRows, gtByImage, config, baseSeed + index * 9973);
    const metrics = await computeDetectionMetrics(job, rows);
    const distance = metricDistance(metrics, config);
    if (distance < bestDistance) {
      bestRows = rows;
      bestMetrics = metrics;
      bestDistance = distance;
    }
  }

  const predictionCount = bestRows.reduce((total, row) => total + (row.predictions || []).length, 0);
  const simulatedMs = bestRows.reduce((total, row) => total + Number(row.inferenceMs || 0), 0);
  const predictionsPath = path.join(outputDir, "predictions.json");
  const predictions = {
    format: "det-dashboard.predictions.v1",
    algorithm: "fake_reference_detector",
    jobId: job.id,
    referencePath: configPath,
    reference: config,
    imageCount: bestRows.length,
    predictionCount,
    simulatedMs: Number(simulatedMs.toFixed(2)),
    images: bestRows,
  };
  fs.writeFileSync(predictionsPath, JSON.stringify(predictions, null, 2), "utf8");
  const delayMs = Math.min(30000, Math.max(0, Math.round(simulatedMs)));
  if (delayMs > 0) {
    await query("UPDATE runtime_inference_jobs SET progress=70, message=$1 WHERE id=$2", [`Simulating fake inference latency: ${delayMs} ms`, job.id]);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  await transaction(async (client) => {
    await client.query("DELETE FROM runtime_inference_results WHERE inference_job_id=$1", [job.id]);
    for (const row of bestRows) {
      await client.query(
        `INSERT INTO runtime_inference_results (inference_job_id, project_image_id, predictions_json, artifact_path)
         VALUES ($1,$2,$3,$4)`,
        [job.id, row.projectImageId || null, JSON.stringify(row.predictions || []), predictionsPath],
      );
    }
    const nextParams = {
      ...params,
      output: {
        ...(params.output || {}),
        predictionsPath,
        resultCount: bestRows.length,
        predictionCount,
        completedAt: new Date().toISOString(),
        metrics: bestMetrics,
        fakeReference: {
          referencePath: configPath,
          target: config,
          iterations,
          simulatedMs: Number(simulatedMs.toFixed(2)),
          cappedDelayMs: delayMs,
        },
      },
    };
    await client.query(
      "UPDATE runtime_inference_jobs SET status='done', progress=100, params_json=$1, metrics_json=$2, message=$3, finished_at=now() WHERE id=$4",
      [JSON.stringify(nextParams), JSON.stringify(bestMetrics), `Fake GT inference completed: ${bestRows.length} images, ${predictionCount} boxes`, job.id],
    );
  });
  await recordRuntimeAssetLink(job, bestMetrics);
}

async function computeDetectionMetrics(job, predictionRows) {
  const imageIds = predictionRows.map((row) => row.projectImageId).filter(Boolean);
  if (!imageIds.length) return { images: predictionRows.length, predictions: 0, evaluated: false, reason: "没有可评估的图片 ID" };
  const project = (await query("SELECT id, active_label_version_id FROM projects WHERE id=$1", [job.dataset_project_id])).rows[0];
  if (!project?.active_label_version_id) return { images: predictionRows.length, predictions: 0, evaluated: false, reason: "项目没有 active_label_version_id" };
  const gtRows = (await query(
    `SELECT project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h
     FROM image_annotations
     WHERE label_version_id=$1 AND project_image_id = ANY($2::uuid[])`,
    [project.active_label_version_id, imageIds],
  )).rows.map((row) => ({
    ...row,
    metricLabel: metricLabel(row),
  }));
  if (!gtRows.length) {
    return {
      images: 0,
      inferenceImages: predictionRows.length,
      skippedUnlabeledImages: predictionRows.length,
      predictions: 0,
      groundTruth: 0,
      evaluated: false,
      reason: "推理结果已保存，但所选数据集没有可用于评估的标注图片",
    };
  }
  const gtByImage = new Map();
  for (const gt of gtRows) {
    const list = gtByImage.get(gt.project_image_id) || [];
    list.push(gt);
    gtByImage.set(gt.project_image_id, list);
  }
  const labeledImageIds = new Set(gtByImage.keys());
  const evaluationRows = predictionRows.filter((row) => labeledImageIds.has(row.projectImageId));
  const detections = [];
  for (const row of evaluationRows) {
    for (const prediction of row.predictions || []) {
      detections.push({
        ...prediction,
        projectImageId: row.projectImageId,
        metricLabel: metricLabel(prediction),
        score: Number(prediction.score ?? 0),
      });
    }
  }
  const labels = Array.from(new Set([...gtRows.map((row) => row.metricLabel), ...detections.map((row) => row.metricLabel)].filter(Boolean)));
  const thresholds = Array.from({ length: 10 }, (_, index) => Number((0.5 + index * 0.05).toFixed(2)));
  const apByThreshold = [];
  let precision50 = 0;
  let recall50 = 0;
  for (const threshold of thresholds) {
    let thresholdTp = 0;
    let thresholdFp = 0;
    let thresholdGt = 0;
    const labelAps = [];
    for (const label of labels) {
      const labelGts = gtRows.filter((gt) => gt.metricLabel === label);
      const labelPreds = detections.filter((prediction) => prediction.metricLabel === label).sort((a, b) => b.score - a.score);
      thresholdGt += labelGts.length;
      const used = new Set();
      const points = [];
      for (const prediction of labelPreds) {
        const candidates = (gtByImage.get(prediction.projectImageId) || []).filter((gt) => gt.metricLabel === label);
        let best = null;
        let bestIou = 0;
        for (const gt of candidates) {
          const key = `${gt.project_image_id}:${gt.label}:${gt.bbox_x}:${gt.bbox_y}:${gt.bbox_w}:${gt.bbox_h}`;
          if (used.has(key)) continue;
          const iou = boxIou(prediction, gt);
          if (iou > bestIou) {
            bestIou = iou;
            best = key;
          }
        }
        const matched = best && bestIou >= threshold;
        if (matched) {
          used.add(best);
          thresholdTp += 1;
        } else {
          thresholdFp += 1;
        }
        points.push({ tp: Boolean(matched) });
      }
      if (labelGts.length) {
        const ap = averagePrecision(points, labelGts.length);
        if (ap !== null) labelAps.push(ap);
      }
    }
    const map = labelAps.length ? labelAps.reduce((sum, value) => sum + value, 0) / labelAps.length : null;
    apByThreshold.push({ threshold, map });
    if (threshold === 0.5) {
      precision50 = thresholdTp / Math.max(1, thresholdTp + thresholdFp);
      recall50 = thresholdTp / Math.max(1, thresholdGt);
    }
  }
  const validMaps = apByThreshold.map((item) => item.map).filter((value) => value !== null);
  const map50 = apByThreshold.find((item) => item.threshold === 0.5)?.map ?? null;
  const map5095 = validMaps.length ? validMaps.reduce((sum, value) => sum + value, 0) / validMaps.length : null;
  return {
    images: evaluationRows.length,
    inferenceImages: predictionRows.length,
    skippedUnlabeledImages: predictionRows.length - evaluationRows.length,
    predictions: detections.length,
    groundTruth: gtRows.length,
    labels: labels.length,
    precision: precision50,
    recall: recall50,
    map50,
    map: map5095,
    evaluated: true,
    iouThreshold: 0.5,
  };
}

function runChildProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    let combined = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; combined += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; combined += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr, combined, code });
      const error = new Error((stderr || stdout || `${command} exited with code ${code}`).trim());
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      error.combined = combined;
      reject(error);
    });
  });
}

async function runUltralyticsInferenceJob(job) {
  const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  const envId = params.pythonEnvId || params.python_env_id;
  if (!envId) throw new Error("YOLO 推理缺少运行环境资产");
  let env = (await query("SELECT * FROM runtime_envs WHERE id=$1", [envId])).rows[0];
  if (!env) throw new Error("YOLO 推理运行环境不存在");
  env = await pythonEnvService.resolveRuntimePythonEnv(env);
  if (!fs.existsSync(env.python_path)) throw new Error(`YOLO 推理 Python 不存在：${env.python_path}`);  const capabilities = env.capabilities_json || {};
  if (!capabilities.ultralytics_detect) throw new Error("所选运行环境未检测到 ultralytics，不能执行 YOLO 推理");
  const weightPath = await modelService.findWeightArtifact(job.model_version_id);
  if (!weightPath) throw new Error("YOLO 推理缺少可用模型权重文件");

  const input = params.input || {};
  const manifestPath = input.manifestPath || path.join(job.output_root, "input-cache", "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("推理输入 manifest 不存在");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const outputRoot = job.output_root || path.join(storageRoot, "runtime", "inference", job.id);
  const outputDir = path.join(outputRoot, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const predictionsPath = path.join(outputDir, "predictions.json");
  const runnerPath = path.join(outputRoot, "run_ultralytics_inference.py");
  const requestedDevice = String(params.device ?? "").trim();
  const device = requestedDevice || (env.cuda_available ? "0" : "cpu");
  const runnerConfig = {
    jobId: job.id,
    weights: weightPath,
    manifestPath,
    outputPath: predictionsPath,
    conf: Number(params.conf ?? 0.25),
    iou: Number(params.iou ?? 0.7),
    imgsz: Number(params.imgsz ?? 640),
    batch: Math.max(1, Number(params.batch ?? 1)),
    device,
  };
  const runner = [
    "import json, os, sys",
    "from ultralytics import YOLO",
    `cfg = json.loads(${JSON.stringify(JSON.stringify(runnerConfig))})`,
    "with open(cfg['manifestPath'], 'r', encoding='utf-8') as f:",
    "    manifest = json.load(f)",
    "images = manifest.get('images') or []",
    "root = manifest.get('cacheRoot') or os.path.dirname(cfg['manifestPath'])",
    "image_paths = []",
    "by_abs = {}",
    "for item in images:",
    "    local_path = item.get('localPath') or item.get('cachedFileName')",
    "    abs_path = local_path if os.path.isabs(str(local_path)) else os.path.join(root, str(local_path))",
    "    abs_path = os.path.normpath(abs_path)",
    "    image_paths.append(abs_path)",
    "    by_abs[os.path.abspath(abs_path)] = item",
    "model = YOLO(cfg['weights'])",
    "rows = []",
    "names = getattr(model, 'names', {}) or {}",
    "for abs_path in image_paths:",
    "    results = model.predict(source=abs_path, conf=cfg['conf'], iou=cfg['iou'], imgsz=cfg['imgsz'], batch=1, device=cfg['device'], verbose=False, stream=True)",
    "    result = next(iter(results))",
    "    source_path = os.path.abspath(str(getattr(result, 'path', '') or ''))",
    "    item = by_abs.get(source_path) or by_abs.get(os.path.abspath(os.path.normpath(source_path))) or {}",
    "    preds = []",
    "    boxes = getattr(result, 'boxes', None)",
    "    if boxes is not None:",
    "        xyxy = boxes.xyxy.cpu().tolist() if getattr(boxes, 'xyxy', None) is not None else []",
    "        confs = boxes.conf.cpu().tolist() if getattr(boxes, 'conf', None) is not None else [None] * len(xyxy)",
    "        clss = boxes.cls.cpu().tolist() if getattr(boxes, 'cls', None) is not None else [None] * len(xyxy)",
    "        for index, coords in enumerate(xyxy):",
    "            x1, y1, x2, y2 = [float(v) for v in coords]",
    "            cls_id = int(clss[index]) if clss[index] is not None else -1",
    "            label = names.get(cls_id, str(cls_id)) if isinstance(names, dict) else str(cls_id)",
    "            preds.append({'label': label, 'score': None if confs[index] is None else float(confs[index]), 'bbox_x': x1, 'bbox_y': y1, 'bbox_w': max(0.0, x2 - x1), 'bbox_h': max(0.0, y2 - y1), 'class_id': cls_id})",
    "    rows.append({'index': item.get('index'), 'cachedFileName': item.get('cachedFileName'), 'projectImageId': item.get('projectImageId'), 'imageAssetId': item.get('imageAssetId'), 'originalFileName': item.get('originalFileName') or os.path.basename(source_path), 'width': item.get('width'), 'height': item.get('height'), 'predictions': preds})",
    "payload = {'format': 'det-dashboard.predictions.v1', 'algorithm': 'ultralytics_yolo', 'jobId': cfg['jobId'], 'imageCount': len(rows), 'predictionCount': sum(len(row['predictions']) for row in rows), 'images': rows}",
    "os.makedirs(os.path.dirname(cfg['outputPath']), exist_ok=True)",
    "with open(cfg['outputPath'], 'w', encoding='utf-8') as f:",
    "    json.dump(payload, f, ensure_ascii=False, indent=2)",
    "print(json.dumps({'imageCount': payload['imageCount'], 'predictionCount': payload['predictionCount'], 'outputPath': cfg['outputPath']}, ensure_ascii=False))",
  ].join("\n");
  fs.writeFileSync(runnerPath, runner, "utf8");
  await query("UPDATE runtime_inference_jobs SET progress=35, message=$1 WHERE id=$2", [`正在执行 YOLO 推理：${env.python_path}`, job.id]);
  const result = await runChildProcess(env.python_path, [runnerPath], { cwd: outputRoot, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  const summaryLine = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || "{}";
  let summary = {};
  try { summary = JSON.parse(summaryLine); } catch { summary = {}; }
  if (!fs.existsSync(predictionsPath)) throw new Error("YOLO 推理未生成 predictions.json");
  const predictions = JSON.parse(fs.readFileSync(predictionsPath, "utf8"));
  const rows = Array.isArray(predictions.images) ? predictions.images : [];
  const predictionCount = Number(predictions.predictionCount ?? rows.reduce((total, row) => total + (row.predictions || []).length, 0));
  const metrics = await computeDetectionMetrics(job, rows);

  await transaction(async (client) => {
    await client.query("DELETE FROM runtime_inference_results WHERE inference_job_id=$1", [job.id]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO runtime_inference_results (inference_job_id, project_image_id, predictions_json, artifact_path)
         VALUES ($1,$2,$3,$4)`,
        [job.id, row.projectImageId || null, JSON.stringify(row.predictions || []), predictionsPath],
      );
    }
    const nextParams = {
      ...params,
      output: {
        ...(params.output || {}),
        predictionsPath,
        resultCount: rows.length,
        predictionCount,
        completedAt: new Date().toISOString(),
        metrics,
        runnerSummary: summary,
        stdout: result.stdout,
        stderr: result.stderr,
        executionLog: result.combined || `${result.stdout || ""}${result.stderr || ""}`,
      },
    };
    await client.query(
      "UPDATE runtime_inference_jobs SET status='done', progress=100, params_json=$1, metrics_json=$2, message=$3, finished_at=now() WHERE id=$4",
      [JSON.stringify(nextParams), JSON.stringify(metrics), `YOLO 推理完成：${rows.length} 张图片，${predictionCount} 个预测框`, job.id],
    );
  });
  await recordRuntimeAssetLink(job, metrics);
}

function normalizeTorchDevice(value, cudaAvailable = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return cudaAvailable ? "cuda:0" : "cpu";
  if (/^\d+$/.test(raw)) return `cuda:${raw}`;
  if (raw === "-1") return cudaAvailable ? "cuda:0" : "cpu";
  if (/^cuda:\d+$/.test(raw) || ["cpu", "mps"].includes(raw)) return raw;
  return raw;
}

async function runDinoInferenceJob(job) {
  const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  const envId = params.pythonEnvId || params.python_env_id;
  if (!envId) throw new Error("DINO inference requires a registered Python environment");
  let env = (await query("SELECT * FROM runtime_envs WHERE id=$1", [envId])).rows[0];
  if (!env) throw new Error(`DINO inference environment does not exist: ${envId}`);
  env = await pythonEnvService.resolveRuntimePythonEnv(env);
  if (!env.python_path || !fs.existsSync(env.python_path)) throw new Error(`DINO inference Python does not exist: ${env.python_path || "(empty)"}`);

  const resolved = await resolveTrainingAlgorithmSource(params);
  if (!resolved) throw new Error(`DINO algorithm asset is not registered: ${params.algorithmAssetId || "(missing id)"}`);
  const { algorithm, cacheRoot } = resolved;
  const weightPath = await modelService.findWeightArtifact(job.model_version_id);
  if (!weightPath) throw new Error(`DINO inference has no real weight artifact for model version ${job.model_version_id || "(missing)"}`);

  const input = params.input || {};
  const manifestPath = input.manifestPath || path.join(job.output_root, "input-cache", "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`DINO inference input manifest does not exist: ${manifestPath}`);
  const outputRoot = job.output_root || path.join(storageRoot, "runtime", "inference", job.id);
  const outputDir = path.join(outputRoot, "output");
  const predictionsPath = path.join(outputDir, "predictions.json");
  const visualizationDir = path.join(outputDir, "visualizations");
  fs.mkdirSync(visualizationDir, { recursive: true });
  const { configPath, sourceRoot } = await resolveDinoConfigPath({ env, cacheRoot, algorithm, params, weightPath, outputRoot });
  const classNames = (await query(
    `SELECT DISTINCT a.label FROM image_annotations a JOIN projects p ON p.active_label_version_id=a.label_version_id
     WHERE p.id=$1 ORDER BY a.label`,
    [job.dataset_project_id],
  )).rows.map((row) => String(row.label));
  const runnerPath = path.join(outputRoot, "run_dino_inference.py");
  const config = {
    jobId: job.id, configPath, weightPath, manifestPath, predictionsPath, visualizationDir,
    scoreThreshold: Number(params.conf ?? params.scoreThreshold ?? 0.25),
    device: normalizeTorchDevice(params.device, env.cuda_available),
    classNames,
  };
  const runner = [
    "import json, os, sys, traceback",
    "import cv2",
    "import dino_detector",
    "from mmdet.apis import init_detector, inference_detector",
    `cfg = json.loads(${JSON.stringify(JSON.stringify(config))})`,
    "with open(cfg['manifestPath'], 'r', encoding='utf-8') as f: manifest = json.load(f)",
    "items = manifest.get('images') or []",
    "root = manifest.get('cacheRoot') or os.path.dirname(cfg['manifestPath'])",
    "model = init_detector(cfg['configPath'], cfg['weightPath'], device=cfg['device'])",
    "classes = list((getattr(model, 'dataset_meta', {}) or {}).get('classes') or cfg.get('classNames') or [])",
    "rows = []",
    "for item in items:",
    "    local_path = item.get('localPath') or item.get('cachedFileName')",
    "    image_path = local_path if os.path.isabs(str(local_path)) else os.path.join(root, str(local_path))",
    "    image_path = os.path.normpath(image_path)",
    "    result = inference_detector(model, image_path)",
    "    instances = result.pred_instances.to('cpu')",
    "    boxes = instances.bboxes.numpy().tolist() if hasattr(instances, 'bboxes') else []",
    "    scores = instances.scores.numpy().tolist() if hasattr(instances, 'scores') else [1.0] * len(boxes)",
    "    labels = instances.labels.numpy().tolist() if hasattr(instances, 'labels') else [-1] * len(boxes)",
    "    preds = []",
    "    canvas = cv2.imread(image_path)",
    "    for box, score, class_id in zip(boxes, scores, labels):",
    "        if float(score) < cfg['scoreThreshold']: continue",
    "        x1, y1, x2, y2 = [float(v) for v in box]",
    "        label = str(classes[int(class_id)]) if 0 <= int(class_id) < len(classes) else str(int(class_id))",
    "        preds.append({'label': label, 'score': float(score), 'bbox_x': x1, 'bbox_y': y1, 'bbox_w': max(0.0, x2-x1), 'bbox_h': max(0.0, y2-y1), 'class_id': int(class_id)})",
    "        if canvas is not None:",
    "            cv2.rectangle(canvas, (int(x1), int(y1)), (int(x2), int(y2)), (0, 220, 0), 2)",
    "            cv2.putText(canvas, '%s %.3f' % (label, score), (int(x1), max(14, int(y1)-4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 0), 1, cv2.LINE_AA)",
    "    visual_name = '%06d_%s' % (int(item.get('index') or len(rows)+1), os.path.basename(image_path))",
    "    visual_path = os.path.join(cfg['visualizationDir'], visual_name)",
    "    if canvas is not None: cv2.imwrite(visual_path, canvas)",
    "    rows.append({'index': item.get('index'), 'cachedFileName': item.get('cachedFileName'), 'projectImageId': item.get('projectImageId'), 'imageAssetId': item.get('imageAssetId'), 'originalFileName': item.get('originalFileName') or os.path.basename(image_path), 'width': item.get('width'), 'height': item.get('height'), 'visualizationPath': visual_path if canvas is not None and os.path.isfile(visual_path) else None, 'predictions': preds})",
    "payload = {'format': 'det-dashboard.predictions.v1', 'algorithm': 'dinov3_faster_rcnn', 'jobId': cfg['jobId'], 'imageCount': len(rows), 'predictionCount': sum(len(row['predictions']) for row in rows), 'images': rows}",
    "os.makedirs(os.path.dirname(cfg['predictionsPath']), exist_ok=True)",
    "with open(cfg['predictionsPath'], 'w', encoding='utf-8') as f: json.dump(payload, f, ensure_ascii=False, indent=2)",
    "print(json.dumps({'imageCount': payload['imageCount'], 'predictionCount': payload['predictionCount'], 'predictionsPath': cfg['predictionsPath']}))",
  ].join("\n");
  fs.writeFileSync(runnerPath, runner, "utf8");
  const commandArgs = [runnerPath];
  await query("UPDATE runtime_inference_jobs SET progress=35, message=$1 WHERE id=$2", [`Running DINO inference: ${env.python_path} ${commandArgs.join(" ")}`, job.id]);
  let result;
  try {
    result = await runChildProcess(env.python_path, commandArgs, { cwd: sourceRoot, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONPATH: [sourceRoot, cacheRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } });
  } catch (error) {
    const wrapped = new Error(`DINO inference command failed: ${env.python_path} ${commandArgs.join(" ")} (cwd=${sourceRoot})\n${error.stderr || error.message}`);
    wrapped.stdout = error.stdout || "";
    wrapped.stderr = error.stderr || "";
    wrapped.combined = error.combined || `${error.stdout || ""}${error.stderr || error.message || ""}`;
    throw wrapped;
  }
  if (!fs.existsSync(predictionsPath)) throw new Error(`DINO inference command completed without predictions.json: ${env.python_path} ${commandArgs.join(" ")}`);
  const predictions = JSON.parse(fs.readFileSync(predictionsPath, "utf8"));
  const rows = Array.isArray(predictions.images) ? predictions.images : [];
  const predictionCount = Number(predictions.predictionCount ?? rows.reduce((total, row) => total + (row.predictions || []).length, 0));
  const metrics = await computeDetectionMetrics(job, rows);
  await transaction(async (client) => {
    await client.query("DELETE FROM runtime_inference_results WHERE inference_job_id=$1", [job.id]);
    for (const row of rows) await client.query(
      "INSERT INTO runtime_inference_results (inference_job_id, project_image_id, predictions_json, artifact_path) VALUES ($1,$2,$3,$4)",
      [job.id, row.projectImageId || null, JSON.stringify(row.predictions || []), row.visualizationPath || predictionsPath],
    );
    const nextParams = { ...params, output: { ...(params.output || {}), predictionsPath, visualizationDir, resultCount: rows.length, predictionCount, completedAt: new Date().toISOString(), metrics, command: [env.python_path, ...commandArgs], stdout: result.stdout, stderr: result.stderr, executionLog: result.combined || `${result.stdout || ""}${result.stderr || ""}` } };
    await client.query(
      "UPDATE runtime_inference_jobs SET status='done', progress=100, params_json=$1, metrics_json=$2, message=$3, finished_at=now() WHERE id=$4",
      [JSON.stringify(nextParams), JSON.stringify(metrics), `DINO inference completed: ${rows.length} images, ${predictionCount} boxes`, job.id],
    );
  });
  await recordRuntimeAssetLink(job, metrics);
}

async function runInferenceJob(job, workerId) {
  try {
    const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
    const algorithmKey = params.algorithmKey || params.templateKey || "";
    if (algorithmKey === "ultralytics_yolo") {
      await runUltralyticsInferenceJob(job);
      return;
    }
    if (algorithmKey === "dinov3_faster_rcnn") {
      await runDinoInferenceJob(job);
      return;
    }
    if (isFakeReferenceInferenceJob(job)) {
      await query("UPDATE runtime_inference_jobs SET progress=35, message=$1 WHERE id=$2", ["Running Fake GT reference inference", job.id]);
      await runFakeReferenceInferenceJob(job);
      return;
    }
    if (!isDummyInferenceJob(job)) {
      const missing = [];
      if (!algorithmKey) missing.push("算法资产");
      if (!params.pythonEnvId) missing.push("运行环境资产");
      if (!job.model_version_id) missing.push("模型权重版本");
      const message = missing.length
        ? `推理任务无法执行：缺少 ${missing.join("、")}。请在推理平台选择算法、运行环境和权重后重新提交。`
        : `算法 ${params.templateName || algorithmKey} 已登记，但当前内置 worker 尚未接入该算法的执行器。请先使用“空检测模型推理”验证流程，或接入对应 Python 适配器。`;
      await query(
        "UPDATE runtime_inference_jobs SET status='failed', progress=100, message=$1, finished_at=now() WHERE id=$2",
        [message, job.id],
      );
      return;
    }
    await query("UPDATE runtime_inference_jobs SET progress=35, message=$1 WHERE id=$2", ["正在执行空模型推理", job.id]);
    await runDummyInferenceJob(job);
  } catch (error) {
    const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
    const executionLog = error.combined || `${error.stdout || ""}${error.stderr || ""}` || error.message || "";
    const nextParams = {
      ...params,
      output: {
        ...(params.output || {}),
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        executionLog,
        failedAt: new Date().toISOString(),
      },
    };
    await query(
      "UPDATE runtime_inference_jobs SET status='failed', message=$1, params_json=$2, finished_at=now() WHERE id=$3",
      [error.message || `推理 worker ${workerId} 执行失败`, JSON.stringify(nextParams), job.id],
    ).catch(() => {});
  }
}

function startInferenceWorker() {
  if (String(process.env.INFERENCE_WORKER_ENABLED || "true").toLowerCase() === "false") return;
  const workerId = `local-infer-${process.pid}`;
  let busy = false;
  let stopped = false;
  let activeTick = Promise.resolve();
  const tick = async () => {
    if (stopped || busy) return activeTick;
    busy = true;
    activeTick = (async () => {
      try {
        const job = await runtimeQueueService.claimInferenceJob(workerId);
        if (job) await runInferenceJob(job, workerId);
      } catch (error) {
        console.error("inference worker error:", error);
      } finally {
        busy = false;
      }
    })();
    return activeTick;
  };
  const interval = setInterval(tick, Number(process.env.INFERENCE_WORKER_INTERVAL_MS || 2500));
  const initialTick = setTimeout(tick, 250);
  return {
    async stop() {
      stopped = true;
      clearInterval(interval);
      clearTimeout(initialTick);
      await activeTick;
    },
  };
}

async function appendTrainingLog(jobId, stream, line) {
  const text = String(line || "").slice(0, 4000);
  if (!text) return;
  await query("INSERT INTO runtime_training_logs (job_id, stream, line) VALUES ($1,$2,$3)", [jobId, stream, text]).catch(() => {});
}

async function createLegacyDatasetSnapshotForTraining(job) {
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
  await resourceAccess.assignOwner("dataset_snapshots", snapshot.id, { id: job.created_by_user_id });
  await query("UPDATE runtime_training_jobs SET dataset_snapshot_id=$1 WHERE id=$2", [snapshot.id, job.id]);
  await appendTrainingLog(job.id, "system", `dataset snapshot created: ${snapshotRoot}`);
  return snapshot;
}

async function createDatasetSnapshotForTraining(job) {
  if (job.dataset_snapshot_id) {
    const existing = (await query("SELECT * FROM dataset_snapshots WHERE id=$1", [job.dataset_snapshot_id])).rows[0];
    if (existing) return existing;
  }
  const params = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
  const requested = normalizeTrainingDatasetSplits({}, params, job.dataset_project_id);
  const splitProjectIds = {
    train: requested.trainProjectIds,
    val: requested.valProjectIds,
    test: requested.testProjectIds,
  };
  const datasetFilters = normalizeTrainingDatasetFilters({}, params);
  if (!splitProjectIds.train.length) throw new Error("Training split project is required");
  const selectedIds = [...new Set(Object.values(splitProjectIds).flat())];
  const projects = (await query("SELECT * FROM projects WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL", [selectedIds])).rows;
  const projectById = new Map(projects.map((row) => [String(row.id), row]));
  for (const [splitName, projectIds] of Object.entries(splitProjectIds)) {
    for (const projectId of projectIds) {
      const selectedProject = projectById.get(String(projectId));
      if (!selectedProject) throw new Error(`${splitName} split project does not exist`);
      if (!selectedProject.active_label_version_id) throw new Error(`${splitName} split project has no active label version`);
    }
  }
  const rows = (await query(
    `SELECT pi.*, ia.object_key, ia.original_ext, ia.width, ia.height
     FROM project_images pi JOIN image_assets ia ON ia.id=pi.image_asset_id
     LEFT JOIN import_batches ib ON ib.id=pi.import_batch_id
     WHERE pi.project_id=ANY($1::uuid[]) AND pi.deleted_at IS NULL AND (ib.id IS NULL OR ib.deleted_at IS NULL)
     ORDER BY pi.project_id, pi.created_at, pi.id`,
    [selectedIds],
  )).rows;
  if (!rows.some((row) => splitProjectIds.train.includes(String(row.project_id)))) throw new Error("Training split has no trainable images");
  const annRows = (await query(
    `SELECT a.* FROM image_annotations a
     JOIN project_images pi ON pi.id=a.project_image_id JOIN projects p ON p.id=pi.project_id
     WHERE pi.project_id=ANY($1::uuid[]) AND a.label_version_id=p.active_label_version_id ORDER BY a.label, a.id`,
    [selectedIds],
  )).rows;
  const labels = [...new Set(annRows.map((ann) => String(ann.label || "unknown")))].sort((a, b) => a.localeCompare(b));
  if (!labels.length) throw new Error("Selected dataset splits have no annotations");
  const labelToIndex = new Map(labels.map((label, index) => [label, index]));
  const annsByImage = new Map();
  for (const ann of annRows) {
    const key = String(ann.project_image_id);
    if (!annsByImage.has(key)) annsByImage.set(key, []);
    annsByImage.get(key).push(ann);
  }
  const trainProject = projectById.get(String(splitProjectIds.train[0]));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  const snapshotName = `${cleanName(trainProject.name, "dataset")}_${stamp}`;
  const snapshotRoot = path.join(storageRoot, "runtime", "snapshots", snapshotName);
  const split = { train: 0, val: 0, test: 0, projects: splitProjectIds, filters: datasetFilters };
  fs.mkdirSync(path.join(snapshotRoot, "annotations"), { recursive: true });
  for (const part of ["train", "val", "test"]) {
    fs.mkdirSync(path.join(snapshotRoot, "images", part), { recursive: true });
    fs.mkdirSync(path.join(snapshotRoot, "labels", part), { recursive: true });
  }
  const cocoBySplit = Object.fromEntries(["train", "val", "test"].map((name) => [name, { images: [], annotations: [], categories: labels.map((label, index) => ({ id: index + 1, name: label })) }]));
  let annotationId = 1;
  const deduplicatedRows = [...rows];
  const seenAssets = new Map();
  let duplicateImageCount = 0;
  for (let index = 0; index < deduplicatedRows.length; index += 1) {
    const item = deduplicatedRows[index];
    const annotations = annsByImage.get(String(item.id)) || [];
    const matchingParts = ["train", "val", "test"].filter((part) =>
      splitProjectIds[part].includes(String(item.project_id)) && trainingImageMatchesFilter(item, annotations, datasetFilters[part]));
    if (matchingParts.length > 1) {
      throw new Error(`Dataset split filters overlap: image ${item.display_name || item.id} matches ${matchingParts.join(", ")}`);
    }
    const part = matchingParts[0];
    if (!part) continue;
    const assetKey = String(item.image_asset_id || item.object_key || item.id);
    if (seenAssets.has(assetKey)) {
      if (seenAssets.get(assetKey) !== part) throw new Error(`Dataset leakage detected: asset ${assetKey} appears in ${seenAssets.get(assetKey)} and ${part}`);
      duplicateImageCount += 1;
      continue;
    }
    seenAssets.set(assetKey, part);
    split[part] += 1;
    const ext = item.original_ext || ".jpg";
    const base = `${exportBaseName(item, index + 1)}_${String(item.id).slice(0, 8)}`;
    const imageName = `${base}${ext}`;
    await writeObjectToFile(item.object_key, path.join(snapshotRoot, "images", part, imageName));
    const lines = annotations.map((ann) => yoloClassLine(ann, item.width, item.height, labelToIndex.get(String(ann.label || "unknown")) ?? 0));
    fs.writeFileSync(path.join(snapshotRoot, "labels", part, `${base}.txt`), `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
    cocoBySplit[part].images.push({ id: String(item.id), file_name: imageName, width: Number(item.width || 0), height: Number(item.height || 0) });
    for (const ann of annotations) cocoBySplit[part].annotations.push({
      id: annotationId++, image_id: String(item.id), category_id: (labelToIndex.get(String(ann.label || "unknown")) ?? 0) + 1,
      bbox: [Number(ann.bbox_x || 0), Number(ann.bbox_y || 0), Number(ann.bbox_w || 0), Number(ann.bbox_h || 0)],
      area: Number(ann.bbox_w || 0) * Number(ann.bbox_h || 0), iscrowd: 0,
    });
  }
  for (const part of ["train", "val", "test"]) fs.writeFileSync(path.join(snapshotRoot, "annotations", `${part}.json`), JSON.stringify(cocoBySplit[part], null, 2), "utf8");
  const dataYaml = [
    `path: ${yamlScalar(snapshotRoot.replace(/\\/g, "/"))}`, "train: images/train", "val: images/val", "test: images/test",
    `nc: ${labels.length}`, "names:", ...labels.map((label, index) => `  ${index}: ${yamlScalar(label)}`), "",
  ].join("\n");
  fs.writeFileSync(path.join(snapshotRoot, "data.yaml"), dataYaml, "utf8");
  const imageCount = split.train + split.val + split.test;
  const includedImageIds = new Set(Object.values(cocoBySplit).flatMap((coco) => coco.images.map((image) => String(image.id))));
  const annotationCount = annRows.filter((ann) => includedImageIds.has(String(ann.project_image_id))).length;
  if (!split.train) throw new Error("Training filters produced an empty train split");
  fs.writeFileSync(path.join(snapshotRoot, "snapshot.json"), JSON.stringify({ projectId: trainProject.id, datasetSplits: splitProjectIds, datasetFilters, labels, split, imageCount, annotationCount, duplicateImageCount }, null, 2), "utf8");
  const snapshot = (await query(
    `INSERT INTO dataset_snapshots (name, source_project_id, label_version_id, format, split_json, path, image_count, annotation_count, metadata_json)
     VALUES ($1,$2,$3,'yolo+coco',$4,$5,$6,$7,$8) RETURNING *`,
    [snapshotName, trainProject.id, trainProject.active_label_version_id, JSON.stringify(split), snapshotRoot, imageCount, annotationCount,
      JSON.stringify({ labels, dataYaml: path.join(snapshotRoot, "data.yaml"), cocoAnnotations: path.join(snapshotRoot, "annotations"), datasetSplits: splitProjectIds, datasetFilters, duplicateImageCount })],
  )).rows[0];
  await resourceAccess.assignOwner("dataset_snapshots", snapshot.id, { id: job.created_by_user_id });
  await query("UPDATE runtime_training_jobs SET dataset_snapshot_id=$1 WHERE id=$2", [snapshot.id, job.id]);
  await appendTrainingLog(job.id, "system", `dataset snapshot created: train=${split.train}, val=${split.val}, test=${split.test}, duplicates=${duplicateImageCount}`);
  return snapshot;
}

async function resolveTrainingAlgorithmSource(params = {}) {
  const algorithmId = params.algorithmAssetId || null;
  let algorithm = null;
  if (algorithmId) algorithm = (await query("SELECT * FROM algorithm_assets WHERE id=$1 AND deleted_at IS NULL", [algorithmId])).rows[0];
  if (!algorithm && params.algorithmKey) algorithm = (await query(
    "SELECT * FROM algorithm_assets WHERE algorithm_key=$1 AND deleted_at IS NULL ORDER BY source_type='builtin' DESC, updated_at DESC LIMIT 1",
    [params.algorithmKey],
  )).rows[0];
  if (!algorithm) return null;
  const cacheRoot = path.join(storageRoot, "runtime", "algorithm-cache", algorithm.id, assetPathSegmentForCache(algorithm.version || "current"));
  const sourcePrefixes = [...new Set([
    algorithm.source_prefix,
    `${algorithm.minio_prefix || ""}/source/`,
    `code-assets/algorithms/${algorithm.algorithm_key}/source/`,
  ].map((value) => String(value || "").replace(/\\/g, "/").replace(/\/*$/, "/")).filter(Boolean))];
  for (const sourcePrefix of sourcePrefixes) {
    const keys = await store.listObjectKeys(sourcePrefix);
    for (const objectKey of keys) {
      const relative = objectKey.slice(sourcePrefix.length).replace(/^\/+/, "");
      if (!relative || relative.includes("..")) continue;
      const target = path.join(cacheRoot, relative.split("/").join(path.sep));
      if (!fs.existsSync(target) || Number(fs.statSync(target).size) !== Number(await store.objectSize(objectKey).catch(() => -1))) await writeObjectToFile(objectKey, target);
    }
  }
  return { algorithm, cacheRoot };
}

function assetPathSegmentForCache(value) {
  return cleanName(String(value || "asset"), "asset").replace(/[. ]+$/g, "") || "asset";
}

function findFileUnder(root, predicate) {
  if (!root || !fs.existsSync(root)) return "";
  return walk(root).find((file) => fs.statSync(file).isFile() && predicate(file)) || "";
}

function ensureAlgorithmSourceArchiveExtracted(cacheRoot) {
  const archive = findFileUnder(cacheRoot, (file) => /[\\/]ZBH2FWQ[\\/]archives[\\/]dinov3-faster-rcnn-code\.tar\.zst$/i.test(file));
  if (!archive) return cacheRoot;
  const extractRoot = path.join(path.dirname(archive), "dinov3-faster-rcnn-code");
  const marker = path.join(extractRoot, ".det-dashboard-extracted");
  if (!fs.existsSync(marker)) {
    fs.mkdirSync(extractRoot, { recursive: true });
    const listing = spawnSync("tar", ["-tf", archive], { encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    if (listing.status !== 0) throw new Error(`Cannot inspect DINO source archive ${archive}: ${listing.stderr || listing.error?.message || "tar failed"}`);
    const unsafe = String(listing.stdout || "").split(/\r?\n/).filter(Boolean).find((entry) => path.isAbsolute(entry) || entry.split(/[\\/]/).includes(".."));
    if (unsafe) throw new Error(`DINO source archive contains an unsafe path: ${unsafe}`);
    const extracted = spawnSync("tar", [
      "-xf", archive, "-C", extractRoot,
      "dinov3-faster-rcnn/configs",
      "dinov3-faster-rcnn/dino_detector",
      "dinov3-faster-rcnn/tools",
    ], { encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
    if (extracted.status !== 0) throw new Error(`Cannot extract DINO source archive ${archive}: ${extracted.stderr || extracted.error?.message || "tar failed"}`);
    fs.writeFileSync(marker, new Date().toISOString(), "utf8");
  }
  const packagedRoot = path.join(extractRoot, "dinov3-faster-rcnn");
  return fs.existsSync(packagedRoot) ? packagedRoot : extractRoot;
}

async function resolveDinoConfigPath({ env, cacheRoot, algorithm, params, weightPath, outputRoot }) {
  const sourceRoot = ensureAlgorithmSourceArchiveExtracted(cacheRoot);
  const generatedPath = path.join(outputRoot, "checkpoint_config.py");
  const extractorPath = path.join(outputRoot, "extract_checkpoint_config.py");
  const extractor = [
    "import os, sys, torch",
    "from mmengine.config import Config",
    "checkpoint, output = sys.argv[1:3]",
    "payload = torch.load(checkpoint, map_location='cpu')",
    "meta = payload.get('meta') or {} if isinstance(payload, dict) else {}",
    "cfg = meta.get('cfg') or meta.get('config')",
    "if cfg is None: raise RuntimeError('checkpoint meta.cfg is missing')",
    "if isinstance(cfg, Config): cfg.dump(output)",
    "elif isinstance(cfg, dict): Config(cfg).dump(output)",
    "elif isinstance(cfg, str) and os.path.isfile(cfg): open(output, 'w', encoding='utf-8').write(open(cfg, 'r', encoding='utf-8').read())",
    "elif isinstance(cfg, str): open(output, 'w', encoding='utf-8').write(cfg)",
    "else: raise TypeError('unsupported checkpoint meta.cfg type: %s' % type(cfg).__name__)",
  ].join("\n");
  fs.writeFileSync(extractorPath, extractor, "utf8");
  try {
    await runChildProcess(env.python_path, [extractorPath, weightPath, generatedPath], { cwd: sourceRoot, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONPATH: [sourceRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } });
    if (fs.existsSync(generatedPath)) {
      const checkpointConfig = fs.readFileSync(generatedPath, "utf8")
        .replace(/pretrained\s*=\s*checkpoint_file/g, "pretrained=None")
        .replace(/pretrained\s*=\s*['\"][^'\"]+['\"]/g, "pretrained=None");
      fs.writeFileSync(generatedPath, checkpointConfig, "utf8");
      return { configPath: generatedPath, sourceRoot };
    }
  } catch (error) {
    console.warn(`Checkpoint config extraction failed for ${weightPath}: ${error.message}`);
  }

  const requested = String(params.config_path || params.configPath || algorithm.default_params_json?.config_path || "configs/alashan_full_multiclass_200e.py").trim();
  const candidates = [
    requested && path.isAbsolute(requested) ? requested : "",
    requested ? path.join(sourceRoot, requested) : "",
    requested ? findFileUnder(sourceRoot, (file) => file.replace(/\\/g, "/").endsWith(`/${requested.replace(/\\/g, "/")}`)) : "",
    findFileUnder(sourceRoot, (file) => path.basename(file).toLowerCase() === "alashan_full_multiclass_200e.py"),
  ].filter(Boolean);
  const existing = candidates.find((file) => fs.existsSync(file));
  if (existing) return { configPath: existing, sourceRoot };
  throw new Error(`DINO config is unavailable in source and checkpoint meta.cfg: ${weightPath}`);
}

async function buildDinoTrainingCommand(job, snapshot, params) {
  const resolved = await resolveTrainingAlgorithmSource(params);
  if (!resolved) throw new Error("DINOv3 algorithm asset is not registered");
  const { algorithm, cacheRoot } = resolved;
  const sourceRoot = ensureAlgorithmSourceArchiveExtracted(cacheRoot);
  const trainScript = [
    path.join(sourceRoot, "tools", "train.py"),
    findFileUnder(sourceRoot, (file) => /[\\/]tools[\\/]train\.py$/i.test(file)),
  ].find((file) => file && fs.existsSync(file));
  if (!trainScript) throw new Error(`DINOv3 algorithm source cache has no tools/train.py: ${cacheRoot}`);
  const requestedConfig = String(params.config_path || params.configPath || algorithm.default_params_json?.config_path || "configs/alashan_full_multiclass_200e.py").trim();
  const configCandidates = [
    requestedConfig && path.isAbsolute(requestedConfig) ? requestedConfig : "",
    requestedConfig ? path.join(sourceRoot, requestedConfig) : "",
    findFileUnder(sourceRoot, (file) => path.basename(file).toLowerCase() === "alashan_full_multiclass_200e.py"),
  ].filter(Boolean);
  const configPath = configCandidates.find((file) => fs.existsSync(file));
  if (!configPath) throw new Error("DINOv3 training config was not found; set config_path in the algorithm parameters");
  const python = params.python || process.env.PYTHON || "python";
  const workDir = path.join(job.output_root, "run");
  const cfgOptions = [
    `train_cfg.max_epochs=${Number(params.max_epochs || params.epochs || job.total_epochs || 200)}`,
    `train_cfg.val_interval=${Math.max(1, Number(params.val_interval || 1))}`,
    `train_dataloader.batch_size=${Number(params.batch_size || params.batch || 2)}`,
    `train_dataloader.num_workers=${Number(params.num_workers ?? 4)}`,
    `train_dataloader.dataset.data_root=${snapshot.path.replace(/\\/g, "/")}/`,
    "train_dataloader.dataset.ann_file=annotations/train.json",
    "train_dataloader.dataset.data_prefix.img=images/train/",
    `val_dataloader.dataset.data_root=${snapshot.path.replace(/\\/g, "/")}/`,
    "val_dataloader.dataset.ann_file=annotations/val.json",
    "val_dataloader.dataset.data_prefix.img=images/val/",
    `test_dataloader.dataset.data_root=${snapshot.path.replace(/\\/g, "/")}/`,
    "test_dataloader.dataset.ann_file=annotations/test.json",
    "test_dataloader.dataset.data_prefix.img=images/test/",
    `optim_wrapper.optimizer.lr=${Number(params.base_lr || params.learning_rate || params.lr0 || 0.0001)}`,
    `default_hooks.checkpoint.interval=${Math.max(1, Number(params.save_period || 1))}`,
  ];
  if (params.amp === true) cfgOptions.push("optim_wrapper.type=AmpOptimWrapper");
  if (params.auto_scale_lr != null) cfgOptions.push(`auto_scale_lr.enable=${Boolean(params.auto_scale_lr)}`);
  if (params.resolvedWeights) cfgOptions.push(`load_from=${String(params.resolvedWeights).replace(/\\/g, "/")}`);
  const args = [trainScript, configPath, "--work-dir", workDir, "--cfg-options", ...cfgOptions];
  if (params.resume) args.push("--resume");
  return { command: python, args, cwd: sourceRoot };
}

async function buildTrainingCommand(job, snapshot) {
  const params = job.params_json || {};
  if (Array.isArray(params.command) && params.command.length) {
    return { command: params.command[0], args: params.command.slice(1) };
  }
  const python = params.python || process.env.PYTHON || "python";
  if (String(params.algorithmKey || params.templateKey || "").toLowerCase() === "dinov3_faster_rcnn") return buildDinoTrainingCommand(job, snapshot, params);
  const initializationStrategy = params.initializationStrategy || (params.resolvedWeights ? "pretrained" : "random");
  const yoloVersion = String(params.yolo_version || "yolov8").replace(/[^a-zA-Z0-9_-]/g, "") || "yolov8";
  const model = params.resolvedWeights || params.weights || params.model || `${yoloVersion}n.yaml`;
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
  args.push(`save_period=${Number.isFinite(Number(params.save_period)) ? Number(params.save_period) : -1}`);
  if (params.optimizer) args.push(`optimizer=${params.optimizer}`);
  if (params.lr0 != null) args.push(`lr0=${Number(params.lr0)}`);
  if (params.resume && params.resolvedWeights) args.push("resume=True");
  if (params.device !== "" && params.device != null) args.push(`device=${params.device}`);
  const yoloForwardParams = ["workers", "lrf", "momentum", "weight_decay", "patience", "amp", "cos_lr", "seed", "deterministic", "val", "warmup_epochs", "warmup_momentum", "warmup_bias_lr", "close_mosaic", "multi_scale", "freeze", "cache", "rect", "single_cls", "mosaic", "mixup", "cutmix", "degrees", "translate", "scale", "shear", "flipud", "fliplr"];
  for (const key of yoloForwardParams) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== "") args.push(`${key}=${params[key]}`);
  }
  if (initializationStrategy === "zero") {
    const trainOptions = {
      data: path.join(snapshot.path, "data.yaml"), epochs: Number(params.epochs || job.total_epochs || 100),
      imgsz: Number(params.imgsz || 640), batch: Number(params.batch || 16), project: job.output_root,
      name: "run", exist_ok: true, save_period: Number.isFinite(Number(params.save_period)) ? Number(params.save_period) : -1,
    };
    if (params.device !== "" && params.device != null) trainOptions.device = params.device;
    if (params.optimizer) trainOptions.optimizer = params.optimizer;
    if (params.lr0 != null) trainOptions.lr0 = Number(params.lr0);
    const script = "import json,sys,torch; from ultralytics import YOLO; c=json.loads(sys.argv[1]); m=YOLO(c.pop('model')); [torch.nn.init.zeros_(p) for p in m.model.parameters()]; m.train(**c)";
    return { command: python, args: ["-c", script, JSON.stringify({ model, ...trainOptions })] };
  }
  return { command: python, args };
}

async function ensureTrainingModelRevision(job) {
  if (job.generated_model_version_id) {
    const generated = (await query("SELECT * FROM model_revisions WHERE id=$1", [job.generated_model_version_id])).rows[0];
    if (generated) return generated;
  }
  const existing = (await query(
    "SELECT * FROM model_revisions WHERE training_job_id=$1 ORDER BY created_at, id LIMIT 1",
    [job.id],
  )).rows[0];
  if (existing) {
    await query(
      "UPDATE runtime_training_jobs SET model_id=$1, generated_model_version_id=$2 WHERE id=$3",
      [existing.model_id, existing.id, job.id],
    );
    return existing;
  }
  const modelId = job.model_id || (await modelService.createMlModel({
    name: `${job.name}_model`,
    taskType: "detect",
    framework: "ultralytics",
    description: "Auto-created from training job",
  }, { id: job.created_by_user_id })).id;
  const project = (await query("SELECT name FROM projects WHERE id=$1", [job.dataset_project_id])).rows[0];
  const params = job.params_json || {};
  const prefix = `detect_${project?.name || "dataset"}_yolo_ep${Number(params.epochs || job.total_epochs || 0) || "x"}_${dateCode()}`;
  const versionName = await modelService.nextModelVersionName(prefix, modelId);
  const version = (await query(
    `INSERT INTO model_revisions (model_id, version_name, training_job_id, dataset_project_id, dataset_snapshot_id, stage, params_json, artifact_root)
     VALUES ($1,$2,$3,$4,$5,'training',$6,$7) RETURNING *`,
    [modelId, versionName, job.id, job.dataset_project_id, job.dataset_snapshot_id, JSON.stringify({ ...params, assetCategory: "training" }), job.output_root],
  )).rows[0];
  await resourceAccess.assignOwner("model_revisions", version.id, { id: job.created_by_user_id });
  await query(
    "UPDATE runtime_training_jobs SET model_id=$1, generated_model_version_id=$2 WHERE id=$3",
    [modelId, version.id, job.id],
  );
  await appendTrainingLog(job.id, "system", `model version created: ${version.version_name}`);
  return version;
}

async function syncTrainingWeightArtifacts(job, modelVersionId) {
  const root = job.output_root;
  if (!root || !fs.existsSync(root)) return [];
  const files = walk(root).filter((file) => {
    if (!fs.statSync(file).isFile()) return false;
    const parts = path.relative(root, file).split(path.sep).map((part) => part.toLowerCase());
    const extension = path.extname(file).toLowerCase();
    const checkpointName = path.basename(file).toLowerCase();
    return [".pt", ".pth", ".onnx"].includes(extension)
      && (parts.includes("weights") || /^(?:epoch[_-]?\d+|best|last)(?:[_-].*)?\.(?:pt|pth|onnx)$/.test(checkpointName));
  });
  const saved = [];
  const version = (await query(
    `SELECT mv.*, mc.name, mc.framework, mc.task_type FROM model_revisions mv JOIN model_clusters mc ON mc.id=mv.model_id WHERE mv.id=$1`,
    [modelVersionId],
  )).rows[0];
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const objectKey = `ml/artifacts/training/${job.id}/${rel}`;
    const stat = fs.statSync(file);
    const previous = (await query(
      "SELECT * FROM model_files WHERE model_version_id=$1 AND path=$2",
      [modelVersionId, objectKey],
    )).rows[0];
    const previousMeta = previous?.metadata_json || {};
    if (previous && Number(previous.size) === stat.size && Number(previousMeta.sourceMtimeMs) === stat.mtimeMs) {
      saved.push(previous);
      continue;
    }
    await store.putFile(objectKey, file);
    const sha = stat.size < 1024 * 1024 * 1024 ? await hashFile(file).catch(() => null) : null;
    const baseName = path.basename(file).toLowerCase();
    const epochMatch = baseName.match(/^epoch[_-]?(\d+)(?:[_-].*)?\.(?:pt|pth|onnx)$/);
    const weightRole = baseName.startsWith("best.") ? "best" : baseName.startsWith("last.") ? "last" : epochMatch ? "epoch" : "other";
    const metadata = {
      localPath: file,
      relativePath: rel,
      weightRole,
      epoch: epochMatch ? Number(epochMatch[1]) : null,
      sourceMtimeMs: stat.mtimeMs,
      uploadedAt: new Date().toISOString(),
    };
    const row = (await query(
      `INSERT INTO model_files (model_version_id, training_job_id, artifact_type, path, size, sha256, metadata_json)
       VALUES ($1,$2,'weights',$3,$4,$5,$6)
       ON CONFLICT (model_version_id, path) DO UPDATE SET
         training_job_id=EXCLUDED.training_job_id,
         artifact_type=EXCLUDED.artifact_type,
         size=EXCLUDED.size,
         sha256=EXCLUDED.sha256,
         metadata_json=EXCLUDED.metadata_json
       RETURNING *`,
      [modelVersionId, job.id, objectKey, stat.size, sha, JSON.stringify(metadata)],
    )).rows[0];
    saved.push(row);
  }
  return saved;
}

async function finalizeTrainingModelRevision(job, version) {
  const artifacts = await syncTrainingWeightArtifacts(job, version.id);
  const successfulArtifact = artifacts.find((item) => item.metadata_json?.weightRole === "best") || artifacts.find((item) => item.metadata_json?.weightRole === "last") || artifacts[0];
  await query(
    `UPDATE model_revisions SET stage='training', params_json=params_json || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ assetCategory: "training", completed: true, primaryArtifactId: successfulArtifact?.id || null }), version.id],
  );
  await query(
    `UPDATE runtime_training_jobs
     SET model_id=$1, generated_model_version_id=$2, status='done', progress=100,
         message=$3, finished_at=now(), heartbeat_at=now()
     WHERE id=$4`,
    [version.model_id, version.id, `Training completed; model version ${version.version_name}; registered ${artifacts.length} weight artifacts`, job.id],
  );
  await appendTrainingLog(job.id, "system", `model version finalized: ${version.version_name}; weight artifacts=${artifacts.length}`);
  await recordTrainingAssetLink(job, version, successfulArtifact).catch((error) => appendTrainingLog(job.id, "error", `asset relation update failed: ${error.message}`));
}

async function recordTrainingAssetLink(job, version, artifact) {
  const params = job.params_json || {};
  let algorithmAssetId = params.algorithmAssetId || null;
  if (!algorithmAssetId && params.templateKey) {
    algorithmAssetId = (await query("SELECT id FROM algorithm_assets WHERE algorithm_key=$1 AND deleted_at IS NULL ORDER BY source_type='builtin' DESC LIMIT 1", [params.templateKey])).rows[0]?.id || null;
  }
  const pythonEnvId = params.pythonEnvId || null;
  const datasetProjectId = job.dataset_project_id || null;
  const metricsRows = (await query(
    `SELECT DISTINCT ON (key) key, value FROM runtime_training_metrics WHERE job_id=$1 ORDER BY key, created_at DESC`,
    [job.id],
  )).rows;
  const metrics = Object.fromEntries(metricsRows.map((row) => [row.key, Number(row.value)]));
  const relationParams = {
    ...params,
    algorithmAssetId,
    pythonEnvId,
    modelId: version.model_id,
    output: { metrics, primaryArtifactId: artifact?.id || null },
  };
  await recordRuntimeAssetLink({ ...job, params_json: relationParams, model_version_id: version.id }, metrics);
}

async function runTrainingJob(job, workerId) {
  let version = null;
  let artifactTimer = null;
  let artifactSyncPromise = null;
  const syncWeights = async () => {
    if (!version) return [];
    if (artifactSyncPromise) return artifactSyncPromise;
    artifactSyncPromise = syncTrainingWeightArtifacts(job, version.id).finally(() => {
      artifactSyncPromise = null;
    });
    return artifactSyncPromise;
  };
  try {
    fs.mkdirSync(job.output_root, { recursive: true });
    const snapshot = await createDatasetSnapshotForTraining(job);
    job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [job.id])).rows[0];
    version = await ensureTrainingModelRevision(job);
    job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [job.id])).rows[0];
    if (["pretrained", "training"].includes(job.params_json?.initializationStrategy) && job.params_json?.initialModelVersionId && !job.params_json?.resolvedWeights) {
      const weightPath = await modelService.findWeightArtifact(job.params_json.initialModelVersionId);
      if (!weightPath) throw new Error("选择的初始化模型版本没有可用权重 artifact");
      job.params_json = { ...(job.params_json || {}), resolvedWeights: weightPath };
      await query("UPDATE runtime_training_jobs SET params_json=$1 WHERE id=$2", [JSON.stringify(job.params_json), job.id]);
      await appendTrainingLog(job.id, "system", `resolved initial weights: ${weightPath}`);
    }
    if (job.params_json?.pythonEnvId) {
      let runtimeEnv = (await query("SELECT * FROM runtime_envs WHERE id=$1", [job.params_json.pythonEnvId])).rows[0];
      if (!runtimeEnv) throw new Error("Training Python environment no longer exists");
      runtimeEnv = await pythonEnvService.resolveRuntimePythonEnv(runtimeEnv);
      job.params_json = { ...(job.params_json || {}), python: runtimeEnv.python_path };
      await query("UPDATE runtime_training_jobs SET params_json=$1 WHERE id=$2", [JSON.stringify(job.params_json), job.id]);
    }
    const { command, args, cwd } = await buildTrainingCommand(job, snapshot);
    await query("UPDATE runtime_training_jobs SET status='running', message=$1, heartbeat_at=now() WHERE id=$2", [`正在执行: ${command} ${args.join(" ")}`, job.id]);
    await appendTrainingLog(job.id, "system", `command: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, { cwd: cwd || job.output_root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    await query("UPDATE runtime_training_jobs SET process_pid=$1 WHERE id=$2", [child.pid || null, job.id]);
    artifactTimer = setInterval(() => {
      syncWeights().catch((error) => console.warn(`training artifact sync failed for ${job.id}:`, error.message));
    }, Number(process.env.TRAINING_ARTIFACT_SYNC_INTERVAL_MS || 2000));
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
    clearInterval(artifactTimer);
    artifactTimer = null;
    await syncWeights();
    job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [job.id])).rows[0];
    if (!job || job.status === "paused") return;
    if (exitCode !== 0) throw new Error(`训练命令退出码 ${exitCode}`);
    await finalizeTrainingModelRevision(job, version);
  } catch (error) {
    if (artifactTimer) clearInterval(artifactTimer);
    await syncWeights().catch((syncError) => appendTrainingLog(job.id, "error", `final artifact sync failed: ${syncError.message}`));
    await appendTrainingLog(job.id, "error", error.stack || error.message);
    await query("UPDATE runtime_training_jobs SET status='failed', message=$1, finished_at=now(), heartbeat_at=now() WHERE id=$2", [error.message || "训练失败", job.id]).catch(() => {});
  }
}

function startTrainingWorker() {
  if (String(process.env.TRAINING_WORKER_ENABLED || "true").toLowerCase() === "false") return;
  const workerId = `local-${process.pid}`;
  let busy = false;
  let stopped = false;
  let activeTick = Promise.resolve();
  const tick = async () => {
    if (stopped || busy) return activeTick;
    busy = true;
    activeTick = (async () => {
      try {
        const job = await runtimeQueueService.claimTrainingJob(workerId);
        if (job) await runTrainingJob(job, workerId);
      } catch (error) {
        console.error("training worker error:", error);
      } finally {
        busy = false;
      }
    })();
    return activeTick;
  };
  const interval = setInterval(tick, Number(process.env.TRAINING_WORKER_INTERVAL_MS || 3000));
  const initialTick = setTimeout(tick, 250);
  return {
    async stop() {
      stopped = true;
      clearInterval(interval);
      clearTimeout(initialTick);
      await activeTick;
    },
  };
}

async function route(req, res) {
  const parsed = url.parse(req.url, true);
  const method = req.method;
  if (method === "GET" && parsed.pathname === "/api/health/live") {
    return sendJson(res, { status: "ok" });
  }
  if (method === "GET" && parsed.pathname === "/api/health/ready") {
    await query("SELECT 1");
    const shuttingDown = lifecycle.isShuttingDown();
    return sendJson(res, { status: shuttingDown ? "stopping" : "ok" }, shuttingDown ? 503 : 200);
  }
  if (multiUserRouter && await multiUserRouter.handle(req, res)) return;
  const actor = parsed.pathname.startsWith("/api/")
    ? await accessControl.authenticateRequest(req)
    : null;
  if (method === "GET" && parsed.pathname === "/api/settings") return sendJson(res, { settings: await getAppSettings() });
  if (method === "PUT" && parsed.pathname === "/api/settings") return sendJson(res, { settings: await saveAppSettings(await readBody(req)) });
  if (method === "GET" && parsed.pathname === "/api/config") {
    const settings = await getAppSettings();
    return sendJson(res, {
      dataRoot,
      dataRootDisplay,
      browseRoot,
      browseRootDisplay,
      browseAllDrives,
      hostPathMode,
      hostDialogUrl,
      nativeDialogMode,
      storageRoot,
      exportRoot: exportRootDisplay,
      platform: process.platform,
      settings,
      postgres: settings.postgres,
      minio: { endPoint: minio.endPoint, port: minio.port, bucket: minio.bucket, dataDir: minio.dataDir },
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
  if (method === "GET" && parsed.pathname === "/api/projects") return sendJson(res, { projects: await projectService.listProjects(false, actor, requestedScope(parsed, actor)) });
  if (method === "GET" && parsed.pathname === "/api/projects/trash") return sendJson(res, { projects: await projectService.listProjects(true, actor, requestedScope(parsed, actor)) });
  if (method === "DELETE" && parsed.pathname === "/api/projects/trash/empty") { accessControl.requireAdmin(actor); return sendJson(res, await trashService.emptyProjectTrash()); }
  if (method === "POST" && parsed.pathname === "/api/projects") return sendJson(res, { project: await projectService.createProject(await readBody(req), actor) });
  const deleteProject = parsed.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === "PATCH" && deleteProject) { await resourceAccess.assertProjectWrite(actor, deleteProject[1]); return sendJson(res, { project: await projectService.renameProject(deleteProject[1], await readBody(req)) }); }
  if (method === "DELETE" && deleteProject) {
    await resourceAccess.assertProjectDelete(actor, deleteProject[1]);
    await trashService.softDeleteProjectTree(deleteProject[1]);
    return sendJson(res, { ok: true });
  }
  const permanentDeleteProject = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/permanent$/);
  if (method === "DELETE" && permanentDeleteProject) { await resourceAccess.assertProjectDelete(actor, permanentDeleteProject[1]); return sendJson(res, await trashService.deleteProjectPermanently(permanentDeleteProject[1])); }
  const restoreProject = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/restore$/);
  if (method === "POST" && restoreProject) {
    await resourceAccess.assertProjectWrite(actor, restoreProject[1]);
    await trashService.restoreProjectTree(restoreProject[1]);
    return sendJson(res, { ok: true });
  }
  if (method === "POST" && parsed.pathname === "/api/imports") return sendJson(res, await importPath(await readBody(req), actor));
  if (method === "GET" && parsed.pathname === "/api/ml/models") return sendJson(res, { models: await modelService.listMlModels(actor, requestedScope(parsed, actor)) });
  if (method === "POST" && parsed.pathname === "/api/ml/models") return sendJson(res, { model: await modelService.createMlModel(await readBody(req), actor) });
  if (method === "GET" && parsed.pathname === "/api/ml/model-versions") return sendJson(res, { versions: await modelService.listModelVersions(parsed.query.modelId || parsed.query.model_id, actor, requestedScope(parsed, actor)) });
  if (method === "POST" && parsed.pathname === "/api/ml/model-versions") return sendJson(res, { version: await modelService.createModelVersion(await readBody(req), actor) });
  if (method === "POST" && parsed.pathname === "/api/ml/model-assets/clear") { accessControl.requireAdmin(actor); return sendJson(res, await clearModelAssets(await readBody(req))); }
  if (method === "GET" && parsed.pathname === "/api/ml/algorithm-assets") return sendJson(res, { algorithms: await algorithmAssetService.listAlgorithmAssets(actor, requestedScope(parsed, actor)) });
  if (method === "GET" && parsed.pathname === "/api/ml/asset-links") return sendJson(res, { links: await listRuntimeAssetLinks(actor, requestedScope(parsed, actor)) });
  if (method === "GET" && parsed.pathname === "/api/ml/training-templates") return sendJson(res, { templates: await listTrainingTemplates(actor, requestedScope(parsed, actor)) });
  if (method === "POST" && parsed.pathname === "/api/ml/training-templates") return sendJson(res, { template: await createTrainingTemplate(await readBody(req), actor) });
  if (method === "GET" && parsed.pathname === "/api/ml/python-envs") return sendJson(res, { envs: await pythonEnvService.listPythonEnvs(actor, requestedScope(parsed, actor)) });
  if (method === "POST" && parsed.pathname === "/api/ml/python-envs") return sendJson(res, { env: await pythonEnvService.createPythonEnv(await readBody(req), actor) });
  const pythonEnvDownload = parsed.pathname.match(/^\/api\/ml\/python-envs\/([^/]+)\/download$/);
  if (method === "GET" && pythonEnvDownload) { await resourceAccess.assertIndependentAccess("runtime_envs", pythonEnvDownload[1], actor, "read"); return pythonEnvService.streamPythonEnvArtifact(res, pythonEnvDownload[1]); }
  const renameModelVersionMatch = parsed.pathname.match(/^\/api\/ml\/model-versions\/([^/]+)$/);
  if (method === "PATCH" && renameModelVersionMatch) { await resourceAccess.assertIndependentAccess("model_revisions", renameModelVersionMatch[1], actor, "write"); return sendJson(res, { version: await modelService.renameModelVersion(renameModelVersionMatch[1], await readBody(req)) }); }
  const modelVersionDownload = parsed.pathname.match(/^\/api\/ml\/model-versions\/([^/]+)\/download$/);
  if (method === "GET" && modelVersionDownload) { await resourceAccess.assertIndependentAccess("model_revisions", modelVersionDownload[1], actor, "read"); return modelService.streamModelArtifact(res, modelVersionDownload[1], parsed.query.artifactId || parsed.query.artifact_id); }
  if (method === "GET" && parsed.pathname === "/api/ml/dataset-snapshots") return sendJson(res, { snapshots: await listDatasetSnapshots(actor, requestedScope(parsed, actor)) });
  if (method === "GET" && parsed.pathname === "/api/ml/training-jobs") return sendJson(res, { jobs: await listTrainingJobs(actor, requestedScope(parsed, actor)) });
  if (method === "POST" && parsed.pathname === "/api/ml/training-jobs") return sendJson(res, { job: await createTrainingJob(await readBody(req), actor) });
  const trainingPriorityMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/priority$/);
  if (method === "PATCH" && trainingPriorityMatch) { await resourceAccess.assertTrainingJobWrite(actor, trainingPriorityMatch[1]); return sendJson(res, { job: await runtimeQueueService.moveRuntimeJobPriority("runtime_training_jobs", trainingPriorityMatch[1], (await readBody(req)).direction, actor) }); }
  const requeueTrainingMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/requeue$/);
  if (method === "POST" && requeueTrainingMatch) { await resourceAccess.assertTrainingJobWrite(actor, requeueTrainingMatch[1]); return sendJson(res, { job: await requeueTrainingJob(requeueTrainingMatch[1], await readBody(req)) }); }
  const pauseTrainingMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/pause$/);
  if (method === "POST" && pauseTrainingMatch) { await resourceAccess.assertTrainingJobWrite(actor, pauseTrainingMatch[1]); return sendJson(res, { job: await pauseTrainingJob(pauseTrainingMatch[1]) }); }
  const resumeTrainingMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/resume$/);
  if (method === "POST" && resumeTrainingMatch) { await resourceAccess.assertTrainingJobWrite(actor, resumeTrainingMatch[1]); return sendJson(res, { job: await resumeTrainingJob(resumeTrainingMatch[1]) }); }
  const deleteTrainingMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)$/);
  if (method === "DELETE" && deleteTrainingMatch) { await resourceAccess.assertTrainingJobWrite(actor, deleteTrainingMatch[1]); return sendJson(res, await deleteTrainingJob(deleteTrainingMatch[1])); }
  const trainingLogsMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/logs$/);
  if (method === "GET" && trainingLogsMatch) {
    await resourceAccess.assertTrainingJobRead(actor, trainingLogsMatch[1]);
    const rows = await query("SELECT * FROM runtime_training_logs WHERE job_id=$1 ORDER BY id DESC LIMIT 300", [trainingLogsMatch[1]]);
    return sendJson(res, { logs: rows.rows.reverse() });
  }
  const trainingMetricsMatch = parsed.pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/metrics$/);
  if (method === "GET" && trainingMetricsMatch) {
    await resourceAccess.assertTrainingJobRead(actor, trainingMetricsMatch[1]);
    const rows = await query("SELECT * FROM runtime_training_metrics WHERE job_id=$1 ORDER BY id DESC LIMIT 500", [trainingMetricsMatch[1]]);
    return sendJson(res, { metrics: rows.rows.reverse() });
  }
  if (method === "GET" && parsed.pathname === "/api/ml/inference-jobs") return sendJson(res, { jobs: await listInferenceJobs(actor, requestedScope(parsed, actor)) });
  if (method === "POST" && parsed.pathname === "/api/ml/inference-jobs") return sendJson(res, { job: await createInferenceJob(await readBody(req), actor) });
  const inferencePriorityMatch = parsed.pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/priority$/);
  if (method === "PATCH" && inferencePriorityMatch) { await resourceAccess.assertInferenceJobWrite(actor, inferencePriorityMatch[1]); return sendJson(res, { job: await runtimeQueueService.moveRuntimeJobPriority("runtime_inference_jobs", inferencePriorityMatch[1], (await readBody(req)).direction, actor) }); }
  const requeueInferenceMatch = parsed.pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/requeue$/);
  if (method === "POST" && requeueInferenceMatch) { await resourceAccess.assertInferenceJobWrite(actor, requeueInferenceMatch[1]); return sendJson(res, { job: await requeueInferenceJob(requeueInferenceMatch[1]) }); }
  const deleteInferenceMatch = parsed.pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)$/);
  if (method === "DELETE" && deleteInferenceMatch) { await resourceAccess.assertInferenceJobWrite(actor, deleteInferenceMatch[1]); return sendJson(res, await deleteInferenceJob(deleteInferenceMatch[1])); }
  const inferenceEvaluationMatch = parsed.pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/evaluation$/);
  if (method === "GET" && inferenceEvaluationMatch) { await resourceAccess.assertInferenceJobRead(actor, inferenceEvaluationMatch[1]); return sendJson(res, { evaluation: await getInferenceEvaluation(inferenceEvaluationMatch[1]) }); }
  const inferenceResultsMatch = parsed.pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/results$/);
  if (method === "GET" && inferenceResultsMatch) { await resourceAccess.assertInferenceJobRead(actor, inferenceResultsMatch[1]); return sendJson(res, { results: await listInferenceResults(inferenceResultsMatch[1]) }); }
  if (method === "POST" && parsed.pathname === "/api/baselines/preview") { accessControl.requireAdmin(actor); return sendJson(res, await createBaselinePreview(await readBody(req))); }
  const baselineConflicts = parsed.pathname.match(/^\/api\/baselines\/([^/]+)\/conflicts$/);
  if (method === "GET" && baselineConflicts) { accessControl.requireAdmin(actor); return sendJson(res, { conflicts: await listBaselineConflicts(baselineConflicts[1]) }); }
  if (method === "POST" && baselineConflicts) { accessControl.requireAdmin(actor); return sendJson(res, await resolveBaselineConflicts(baselineConflicts[1], await readBody(req))); }
  const applyBaseline = parsed.pathname.match(/^\/api\/baselines\/([^/]+)\/apply$/);
  if (method === "POST" && applyBaseline) { accessControl.requireAdmin(actor); return sendJson(res, await applyBaselineRun(applyBaseline[1], await readBody(req), actor)); }
  const imports = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/imports$/);
  if (method === "GET" && imports) { await resourceAccess.assertProjectRead(actor, imports[1]); return sendJson(res, { imports: await listImports(imports[1], parsed.query.trash === "1") }); }
  const emptyImportsTrash = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/imports\/trash\/empty$/);
  if (method === "DELETE" && emptyImportsTrash) { await resourceAccess.assertProjectWrite(actor, emptyImportsTrash[1]); return sendJson(res, await trashService.emptyImportTrash(emptyImportsTrash[1])); }
  const deleteImport = parsed.pathname.match(/^\/api\/imports\/([^/]+)$/);
  if (method === "DELETE" && deleteImport) {
    await resourceAccess.assertProjectWrite(actor, await projectForImport(deleteImport[1]));
    await trashService.softDeleteImport(deleteImport[1]);
    return sendJson(res, { ok: true });
  }
  const cancelImportMatch = parsed.pathname.match(/^\/api\/imports\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelImportMatch) {
    await resourceAccess.assertProjectWrite(actor, await projectForImport(cancelImportMatch[1]));
    await cancelImport(cancelImportMatch[1]);
    return sendJson(res, { ok: true });
  }
  const restoreImportMatch = parsed.pathname.match(/^\/api\/imports\/([^/]+)\/restore$/);
  if (method === "POST" && restoreImportMatch) {
    await resourceAccess.assertProjectWrite(actor, await projectForImport(restoreImportMatch[1]));
    await trashService.restoreImport(restoreImportMatch[1]);
    return sendJson(res, { ok: true });
  }
  const summary = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/summary$/);
  if (method === "GET" && summary) { await resourceAccess.assertProjectRead(actor, summary[1]); return sendJson(res, { summary: await projectService.projectSummary(summary[1]) }); }
  const imageList = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/images$/);
  if (method === "GET" && imageList) { await resourceAccess.assertProjectRead(actor, imageList[1]); return sendJson(res, await datasetContentService.listProjectImages(imageList[1], parsed.query)); }
  const deleteImagesMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/images\/delete$/);
  if (method === "POST" && deleteImagesMatch) {
    await resourceAccess.assertProjectWrite(actor, deleteImagesMatch[1]);
    return sendJson(res, await softDeleteProjectImages(deleteImagesMatch[1], (await readBody(req)).ids));
  }
  const exportMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
  if (method === "POST" && exportMatch) { await resourceAccess.assertProjectRead(actor, exportMatch[1]); return sendJson(res, await datasetContentService.exportProject(exportMatch[1], await readBody(req), actor)); }
  const thumb = parsed.pathname.match(/^\/api\/project-images\/([^/]+)\/thumb$/);
  if (method === "GET" && thumb) { await resourceAccess.assertProjectRead(actor, await projectForImage(thumb[1])); return datasetContentService.streamProjectImage(res, thumb[1], true); }
  const full = parsed.pathname.match(/^\/api\/project-images\/([^/]+)\/full$/);
  if (method === "GET" && full) { await resourceAccess.assertProjectRead(actor, await projectForImage(full[1])); return datasetContentService.streamProjectImage(res, full[1], false); }
  const saveAnnotationsMatch = parsed.pathname.match(/^\/api\/project-images\/([^/]+)\/annotations\/save$/);
  if (method === "POST" && saveAnnotationsMatch) { await resourceAccess.assertProjectWrite(actor, await projectForImage(saveAnnotationsMatch[1])); return sendJson(res, await datasetContentService.saveImageAnnotations(saveAnnotationsMatch[1], await readBody(req), actor)); }
  if (method === "GET" && parsed.pathname === "/api/jobs") {
    const scoped = scopedSql("jobs", "j", actor, requestedScope(parsed, actor));
    const rows = await query(`SELECT j.* FROM jobs j WHERE ${scoped.sql} ORDER BY created_at DESC LIMIT 50`, scoped.params);
    return sendJson(res, { jobs: rows.rows });
  }
  if (method === "GET" && parsed.pathname === "/api/imports/latest") {
    const projectId = parsed.query.projectId || parsed.query.project_id;
    if (!projectId) throw httpError(400, "projectId is required");
    await resourceAccess.assertProjectRead(actor, projectId);
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

  if (staticHandler.handle(req, res, parsed)) return;
  sendError(res, 404, "not found");
}

async function main() {
  console.log("Boot: ensureRuntimeSchema start");
  await ensureRuntimeSchema();
  console.log("Boot: ensureRuntimeSchema done");
  accessControl = createAccessControl({
    query,
    transaction,
    httpError,
    onPublicationStatus: async (resourceType, resourceId, published) => {
      const tables = {
        project: "projects",
        model: "model_clusters",
        runtime_env: "runtime_envs",
        algorithm: "algorithm_assets",
        training_template: "training_templates",
      };
      const table = tables[resourceType];
      if (!table) throw httpError(400, `resource type cannot be published: ${resourceType}`);
      await query(`UPDATE ${table} SET visibility=$1 WHERE id=$2`, [published ? "public" : "private", resourceId]);
    },
  });
  await accessControl.ensureSchema();
  runtimeQueueService = createRuntimeQueueService({ query, transaction, accessControl });
  resourceAccess = createResourceAccess({ query, transaction, httpError, accessControl });
  await resourceAccess.initializeSchema();
  algorithmAssetService = createAlgorithmAssetService({
    query,
    resourceAccess,
    store,
    cleanName,
    algorithmAssetPrefix,
    algorithmManifestKey,
    algorithmAdapterKey,
  });
  modelService = createModelService({
    query,
    resourceAccess,
    fs,
    path,
    storageRoot,
    store,
    cleanName,
    dateCode,
    hashFile,
    modelWeightManifestKey,
    writeObjectToFile,
    sendError,
  });
  projectService = createProjectService({ query, transaction, httpError, resourceAccess });
  datasetContentService = createDatasetContentService({
    query,
    transaction,
    store,
    resourceAccess,
    lifecycle,
    fs,
    path,
    sharp,
    storageRoot,
    exportRoot,
    exportRootDisplay,
    cleanName,
    exportBaseName,
    normalizeExportFormat,
    labelmeDocument,
    cocoDocument,
    yoloDocuments,
    sendError,
  });
  collaborationService = createCollaborationService({
    query,
    transaction,
    httpError,
    taskScope: async (actor, { params = [] } = {}) => {
      if (accessControl.isAdmin(actor)) return { sql: "TRUE", params };
      const scopedParams = [...params, actor.id];
      const actorParam = scopedParams.length;
      return {
        sql: `EXISTS (
          SELECT 1 FROM projects task_project
          WHERE task_project.id=dv.project_id AND task_project.deleted_at IS NULL AND (
            task_project.owner_user_id=$${actorParam}
            OR task_project.visibility='public'
            OR EXISTS (
              SELECT 1 FROM asset_acl task_acl
              WHERE task_acl.resource_type='project'
                AND task_acl.resource_id=task_project.id
                AND task_acl.user_id=$${actorParam}
                AND (task_acl.expires_at IS NULL OR task_acl.expires_at>now())
            )
            OR EXISTS (
              SELECT 1 FROM annotation_assignments task_assignment
              JOIN annotation_items assigned_item ON assigned_item.id=task_assignment.item_id
              WHERE assigned_item.task_id=t.id AND task_assignment.assignee_id=$${actorParam}
            )
          )
        )`,
        params: scopedParams,
      };
    },
    checkPermission: async (action, { actor, resource }) => {
      if (!actor?.id) return false;
      if (action === "review:create") return accessControl.isAdmin(actor);
      let projectId = resource.projectId || resource.project_id || null;
      if (!projectId && resource.taskId) {
        projectId = (await query(
          `SELECT dv.project_id FROM annotation_tasks t JOIN dataset_versions dv ON dv.id=t.dataset_version_id WHERE t.id=$1`,
          [resource.taskId],
        )).rows[0]?.project_id;
      }
      if (!projectId && resource.itemId) {
        projectId = (await query(
          `SELECT dv.project_id FROM annotation_items i JOIN annotation_tasks t ON t.id=i.task_id JOIN dataset_versions dv ON dv.id=t.dataset_version_id WHERE i.id=$1`,
          [resource.itemId],
        )).rows[0]?.project_id;
      }
      if (!projectId && resource.lockToken) {
        projectId = (await query(
          `SELECT dv.project_id FROM annotation_locks l JOIN annotation_tasks t ON t.id=l.task_id JOIN dataset_versions dv ON dv.id=t.dataset_version_id WHERE l.token=$1`,
          [resource.lockToken],
        )).rows[0]?.project_id;
      }
      if (projectId) await resourceAccess.assertProjectWrite(actor, projectId);
      return true;
    },
    audit: ({ action, actor, entityType, entityId, details }) => accessControl.writeAudit({
      actorUserId: actor.id,
      action: `collaboration.${action}`,
      resourceType: entityType,
      resourceId: entityId,
      details,
    }),
  });
  await collaborationService.ensureSchema();
  multiUserRouter = createMultiUserRouter({
    accessControl,
    collaborationService,
    loginUser: authService.login,
    registerUser: authService.register,
    listUsers: accessControl.listUsers,
    updateUser: async (userId, body, actor) => {
      accessControl.requireAdmin(actor);
      if (body.status) await accessControl.setUserStatus(userId, body.status, actor);
      const role = body.role === undefined ? null : String(body.role).toLowerCase();
      if (role !== null && !["admin", "user"].includes(role)) throw httpError(400, "role must be admin or user");
      const displayName = body.displayName ?? body.display_name ?? null;
      if (!body.status && role === null && displayName === null) throw httpError(400, "no user fields to update");
      const row = (await query(
        `UPDATE app_users SET role=COALESCE($1,role), display_name=COALESCE($2,display_name), updated_at=now()
         WHERE id=$3 RETURNING *`,
        [role, displayName === null ? null : String(displayName).trim(), userId],
      )).rows[0];
      if (!row) throw httpError(404, "user not found");
      await accessControl.writeAudit({ actorUserId: actor.id, action: "user.update", resourceType: "user", resourceId: userId, details: { role, displayName } });
      return accessControl.publicUser(row);
    },
    getUserPermissions: async (userId, actor) => {
      if (String(userId) !== String(actor.id)) accessControl.requireAdmin(actor);
      const row = (await query("SELECT role FROM app_users WHERE id=$1", [userId])).rows[0];
      if (!row) throw httpError(404, "user not found");
      if (row.role === "admin") return ["*"];
      return (await query("SELECT permission FROM user_permissions WHERE user_id=$1 ORDER BY permission", [userId])).rows.map((item) => item.permission);
    },
    updateUserPermissions: accessControl.setUserPermissions,
  });
  await cleanupLegacyHistoryProjects();
  await backfillUnknownScenes();
  console.log("Boot: ensureBucketSafe start");

  await store.ensureBucketSafe();
  console.log("Boot: ensureBucketSafe done");
  await algorithmAssetService.ensureBuiltinAlgorithmAssets().catch((error) => console.warn("Algorithm asset seed skipped:", error.message));
  await resourceAccess.initializeSchema();
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      const statusCode = error.statusCode || 500;
      if (statusCode >= 500) console.error(error);
      if (!res.headersSent) sendError(res, statusCode, error.message);
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
    console.log(`HOST_PATH_MODE=${hostPathMode}`);
    console.log(`STORAGE_ROOT=${storageRoot}`);
  });
  const trainingWorker = startTrainingWorker();
  const inferenceWorker = startInferenceWorker();
  if (trainingWorker) lifecycle.registerWorker(trainingWorker);
  if (inferenceWorker) lifecycle.registerWorker(inferenceWorker);
  return server;
}

let httpServer;

async function shutdown(signal) {
  if (!lifecycle.beginShutdown()) return;
  console.log(`Received ${signal}; stopping gracefully`);
  const serverClosed = new Promise((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(resolve);
  });
  const workersStopped = lifecycle.stopWorkers();
  const backgroundTasksStopped = lifecycle.waitForBackgroundTasks();
  const timeout = new Promise((resolve) => setTimeout(resolve, 25000));
  await Promise.race([Promise.all([serverClosed, workersStopped, backgroundTasksStopped]), timeout]);
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
