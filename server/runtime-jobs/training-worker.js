const {
  normalizeTrainingDatasetSplits,
  normalizeTrainingDatasetFilters,
  trainingImageMatchesFilter,
  yamlScalar,
  yoloClassLine,
  parseMetricLine,
} = require("../training-format");
const { exportBaseName, cleanName } = require("../utils");

function createTrainingWorker({
  query,
  fs,
  path,
  storageRoot,
  store,
  resourceAccess,
  modelService,
  pythonEnvService,
  runtimeAssetLinkService,
  runtimeQueueService,
  algorithmRuntimeSource,
  walk,
  hashFile,
  writeObjectToFile,
  appendTrainingLog,
  spawn,
  processRef,
  logger,
  clock,
  dateCode,
}) {
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
    const stamp = new Date(clock.now()).toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
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

  async function buildDinoTrainingCommand(job, snapshot, params) {
    const resolved = await algorithmRuntimeSource.resolveTrainingAlgorithmSource(params);
    if (!resolved) throw new Error("DINOv3 algorithm asset is not registered");
    const { algorithm, cacheRoot } = resolved;
    const sourceRoot = algorithmRuntimeSource.ensureAlgorithmSourceArchiveExtracted(cacheRoot);
    const trainScript = [
      path.join(sourceRoot, "tools", "train.py"),
      algorithmRuntimeSource.findFileUnder(sourceRoot, (file) => /[\\/]tools[\\/]train\.py$/i.test(file)),
    ].find((file) => file && fs.existsSync(file));
    if (!trainScript) throw new Error(`DINOv3 algorithm source cache has no tools/train.py: ${cacheRoot}`);
    const requestedConfig = String(params.config_path || params.configPath || algorithm.default_params_json?.config_path || "configs/alashan_full_multiclass_200e.py").trim();
    const configCandidates = [
      requestedConfig && path.isAbsolute(requestedConfig) ? requestedConfig : "",
      requestedConfig ? path.join(sourceRoot, requestedConfig) : "",
      algorithmRuntimeSource.findFileUnder(sourceRoot, (file) => path.basename(file).toLowerCase() === "alashan_full_multiclass_200e.py"),
    ].filter(Boolean);
    const configPath = configCandidates.find((file) => fs.existsSync(file));
    if (!configPath) throw new Error("DINOv3 training config was not found; set config_path in the algorithm parameters");
    const python = params.python || processRef.env.PYTHON || "python";
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
    const python = params.python || processRef.env.PYTHON || "python";
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
        uploadedAt: new Date(clock.now()).toISOString(),
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
    await runtimeAssetLinkService.recordSuccess({ ...job, params_json: relationParams, model_version_id: version.id }, metrics);
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
      const child = spawn(command, args, { cwd: cwd || job.output_root, windowsHide: true, env: { ...processRef.env, PYTHONIOENCODING: "utf-8" } });
      await query("UPDATE runtime_training_jobs SET process_pid=$1 WHERE id=$2", [child.pid || null, job.id]);
      artifactTimer = clock.setInterval(() => {
        syncWeights().catch((error) => logger.warn(`training artifact sync failed for ${job.id}:`, error.message));
      }, Number(processRef.env.TRAINING_ARTIFACT_SYNC_INTERVAL_MS || 2000));
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
      clock.clearInterval(artifactTimer);
      artifactTimer = null;
      await syncWeights();
      job = (await query("SELECT * FROM runtime_training_jobs WHERE id=$1", [job.id])).rows[0];
      if (!job || job.status === "paused") return;
      if (exitCode !== 0) throw new Error(`训练命令退出码 ${exitCode}`);
      await finalizeTrainingModelRevision(job, version);
    } catch (error) {
      if (artifactTimer) clock.clearInterval(artifactTimer);
      await syncWeights().catch((syncError) => appendTrainingLog(job.id, "error", `final artifact sync failed: ${syncError.message}`));
      await appendTrainingLog(job.id, "error", error.stack || error.message);
      await query("UPDATE runtime_training_jobs SET status='failed', message=$1, finished_at=now(), heartbeat_at=now() WHERE id=$2", [error.message || "训练失败", job.id]).catch(() => {});
    }
  }

  function startTrainingWorker() {
    if (String(processRef.env.TRAINING_WORKER_ENABLED || "true").toLowerCase() === "false") return;
    const workerId = `local-${processRef.pid}`;
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
          logger.error("training worker error:", error);
        } finally {
          busy = false;
        }
      })();
      return activeTick;
    };
    const interval = clock.setInterval(tick, Number(processRef.env.TRAINING_WORKER_INTERVAL_MS || 3000));
    const initialTick = clock.setTimeout(tick, 250);
    return {
      async stop() {
        stopped = true;
        clock.clearInterval(interval);
        clock.clearTimeout(initialTick);
        await activeTick;
      },
    };
  }

  return {
    createDatasetSnapshotForTraining,
    buildDinoTrainingCommand,
    buildTrainingCommand,
    ensureTrainingModelRevision,
    syncTrainingWeightArtifacts,
    finalizeTrainingModelRevision,
    recordTrainingAssetLink,
    runTrainingJob,
    startTrainingWorker,
  };
}

module.exports = { createTrainingWorker };
