const builtinAlgorithmAssets = [
  {
    name: "Ultralytics YOLO",
    algorithmKey: "ultralytics_yolo",
    framework: "ultralytics",
    taskType: "detect",
    version: "builtin",
    tasks: ["detect", "segment", "classify"],
    description: "Ultralytics YOLO training and inference adapter.",
    params: { epochs: 100, batch: 16, imgsz: 640, device: "0", workers: 8, optimizer: "auto", lr0: 0.01, lrf: 0.01, momentum: 0.937, weight_decay: 0.0005, patience: 100, amp: true, cos_lr: false, seed: 0, deterministic: true, val: true, save_period: -1 },
    parameterSchema: { groups: [
      { key: "model", label: "模型参数", fields: [
        { key: "yolo_version", type: "select", label: "YOLO 版本", options: ["yolov8", "yolov9", "yolov10", "yolo11"], default: "yolov8" },
        { key: "taskType", type: "select", label: "任务类型", options: ["detect", "segment", "classify"], default: "detect" },
      ] },
      { key: "dataset", label: "数据集参数", fields: [
        { key: "imgsz", type: "number", label: "图像尺寸", min: 32, step: 32, default: 640 },
        { key: "batch", type: "number", label: "Batch", min: -1, default: 16 },
      ] },
      { key: "training", label: "训练参数", fields: [
        { key: "epochs", type: "number", label: "Epochs", min: 1, default: 100 },
        { key: "optimizer", type: "select", label: "优化器", options: ["auto", "SGD", "Adam", "AdamW"], default: "auto" },
        { key: "lr0", type: "number", label: "初始学习率", min: 0, step: 0.0001, default: 0.01 },
        { key: "save_period", type: "number", label: "间隔保存 Epoch", min: -1, default: -1 },
        { key: "device", type: "text", label: "设备", default: "0" },
        { key: "workers", type: "number", label: "Workers", min: 0, default: 8 },
        { key: "lrf", type: "number", label: "Final LR fraction", min: 0, step: 0.001, default: 0.01 },
        { key: "momentum", type: "number", label: "Momentum", min: 0, max: 1, step: 0.001, default: 0.937 },
        { key: "weight_decay", type: "number", label: "Weight decay", min: 0, step: 0.0001, default: 0.0005 },
        { key: "patience", type: "number", label: "Patience", min: 0, default: 100 },
        { key: "amp", type: "boolean", label: "AMP", default: true },
        { key: "cos_lr", type: "boolean", label: "Cosine LR", default: false },
        { key: "seed", type: "number", label: "Seed", min: 0, default: 0 },
        { key: "deterministic", type: "boolean", label: "Deterministic", default: true },
        { key: "val", type: "boolean", label: "Validation", default: true },
      ] },
      { key: "advanced", label: "Advanced", fields: [
        ...["warmup_epochs", "warmup_momentum", "warmup_bias_lr", "close_mosaic", "mosaic", "mixup", "cutmix", "degrees", "translate", "scale", "shear", "flipud", "fliplr"].map((key) => ({ key, type: "number", label: key })),
        ...["multi_scale", "cache", "rect", "single_cls"].map((key) => ({ key, type: "boolean", label: key })),
        { key: "freeze", type: "text", label: "freeze", default: "" },
      ] },
    ] },
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
    description: "DINOv3 + Faster R-CNN inference adapter.",
    params: { max_epochs: 200, freeze_epochs: 10, unfreeze_last_n: 2, batch_size: 2, num_workers: 4, image_width: 1920, image_height: 1080, val_interval: 1, base_lr: 0.0001, amp: true, auto_scale_lr: false, config_path: "configs/alashan_full_multiclass_200e.py" },
    parameterSchema: { groups: [
      { key: "dataset", label: "数据集参数", fields: [
        { key: "batch_size", type: "number", label: "Batch", min: 1, default: 2 },
        { key: "num_workers", type: "number", label: "数据线程", min: 0, default: 4 },
        { key: "image_width", type: "number", label: "Image width", min: 32, default: 1920 },
        { key: "image_height", type: "number", label: "Image height", min: 32, default: 1080 },
      ] },
      { key: "training", label: "训练参数", fields: [
        { key: "max_epochs", type: "number", label: "Max epochs", min: 1, default: 200 },
        { key: "freeze_epochs", type: "number", label: "Freeze epochs", min: 0, default: 10 },
        { key: "unfreeze_last_n", type: "number", label: "Unfreeze last stages", min: 0, default: 2 },
        { key: "val_interval", type: "number", label: "Validation interval", min: 1, default: 1 },
        { key: "base_lr", type: "number", label: "Base LR", min: 0, step: 0.000001, default: 0.0001 },
        { key: "amp", type: "boolean", label: "混合精度", default: true },
        { key: "auto_scale_lr", type: "boolean", label: "Auto scale LR", default: false },
        { key: "config_path", type: "text", label: "训练配置", default: "configs/alashan_full_multiclass_200e.py" },
      ] },
    ] },
    adapter: "# Platform adapter placeholder for DINOv3 Faster R-CNN.\n",
  },
  {
    name: "RT-DETR",
    algorithmKey: "rtdetr",
    framework: "pytorch",
    taskType: "detect",
    version: "builtin",
    tasks: ["detect"],
    description: "RT-DETR detection adapter.",
    params: { conf: 0.25, imgsz: 640, device: "0" },
    adapter: "# Platform adapter placeholder for RT-DETR.\n",
  },
  {
    name: "Fake GT Reference Detector",
    algorithmKey: "fake_reference_detector",
    framework: "builtin",
    taskType: "detect",
    version: "builtin",
    tasks: ["detect"],
    description: "Reads DD-runtime/reference.json and generates calibrated fake detections from ground truth.",
    params: {},
    adapter: "# Platform adapter placeholder for fake reference detector.\n",
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

const supportedBuiltinKeys = ["ultralytics_yolo", "dinov3_faster_rcnn"];

function createAlgorithmAssetService({
  query,
  resourceAccess,
  store,
  cleanName,
  algorithmAssetPrefix,
  algorithmManifestKey,
  algorithmAdapterKey,
  logger = console,
}) {
  if (typeof query !== "function") throw new TypeError("createAlgorithmAssetService requires query");
  if (!resourceAccess || typeof resourceAccess.scopeSql !== "function" || typeof resourceAccess.getAdminId !== "function") {
    throw new TypeError("createAlgorithmAssetService requires resourceAccess");
  }
  if (!store || typeof store.objectExists !== "function" || typeof store.putJson !== "function" || typeof store.putText !== "function" || typeof store.getStream !== "function" || typeof store.listObjectKeys !== "function") {
    throw new TypeError("createAlgorithmAssetService requires store");
  }
  if (typeof cleanName !== "function") throw new TypeError("createAlgorithmAssetService requires cleanName");
  if (typeof algorithmAssetPrefix !== "function" || typeof algorithmManifestKey !== "function" || typeof algorithmAdapterKey !== "function") {
    throw new TypeError("createAlgorithmAssetService requires algorithm key builders");
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
      parameterSchema: asset.parameterSchema || { groups: [] },
      description: asset.description || "",
    };
  }

  function supportedBuiltinAssets() {
    return builtinAlgorithmAssets.filter((asset) => supportedBuiltinKeys.includes(asset.algorithmKey));
  }

  function getBuiltinTrainingTemplateFallbacks() {
    return supportedBuiltinAssets().map((asset) => ({
      id: `builtin-${asset.algorithmKey}`,
      name: asset.name,
      template_key: asset.algorithmKey,
      framework: asset.framework,
      task_type: asset.taskType,
      capabilities_json: { tasks: asset.tasks, builtin: true, parameterSchema: asset.parameterSchema || { groups: [] } },
    }));
  }

  function getBuiltinAlgorithmAssetFallbacks() {
    return supportedBuiltinAssets().map((asset) => ({
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
      capabilities_json: { tasks: asset.tasks, builtin: true, parameterSchema: asset.parameterSchema || { groups: [] } },
      default_params_json: asset.params || {},
      description: asset.description,
      status: "ready",
    }));
  }

  async function ensureBuiltinAlgorithmAssets() {
    for (const asset of supportedBuiltinAssets()) {
      const version = asset.version || "builtin";
      const minioPrefix = algorithmAssetPrefix(asset.algorithmKey, version);
      const manifestKey = algorithmManifestKey(asset.algorithmKey, version);
      const adapterKey = algorithmAdapterKey(asset.algorithmKey, version);
      if (!(await store.objectExists(manifestKey))) await store.putJson(manifestKey, algorithmManifest(asset));
      if (!(await store.objectExists(adapterKey))) await store.putText(adapterKey, asset.adapter || "", "text/x-python");
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
          JSON.stringify({ tasks: asset.tasks || [asset.taskType || "detect"], builtin: true, parameterSchema: asset.parameterSchema || { groups: [] } }),
          JSON.stringify(asset.params || {}),
          asset.description || "",
        ],
      );
      await query(
        `UPDATE training_templates
         SET default_params_json=$1,
             capabilities_json=COALESCE(capabilities_json, '{}'::jsonb) || $2::jsonb,
             updated_at=now()
         WHERE template_key=$3`,
        [JSON.stringify(asset.params || {}), JSON.stringify({ tasks: asset.tasks || [asset.taskType || "detect"], parameterSchema: asset.parameterSchema || { groups: [] } }), asset.algorithmKey],
      ).catch((error) => {
        if (error.code !== "42P01") throw error;
      });
    }
    await query(
      `UPDATE algorithm_assets
       SET deleted_at=COALESCE(deleted_at, now()), status='retired', updated_at=now()
       WHERE source_type='builtin' AND algorithm_key <> ALL($1::text[])`,
      [supportedBuiltinKeys],
    ).catch((error) => {
      if (error.code !== "42P01") throw error;
    });
    await query(
      `DELETE FROM training_templates
       WHERE template_key IN ('rtdetr', 'fake_reference_detector', 'dummy_empty_detector')`,
    ).catch((error) => {
      if (error.code !== "42P01") throw error;
    });
  }

  async function objectText(objectKey) {
    const stream = await store.getStream(objectKey);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  }

  async function readAlgorithmManifest(objectKey) {
    try {
      return JSON.parse(await objectText(objectKey));
    } catch (error) {
      logger.error(`Invalid algorithm manifest ${objectKey}:`, error.message);
      return null;
    }
  }

  function algorithmKeyFromManifestKey(manifestKey) {
    const parts = String(manifestKey || "").split("/");
    const index = parts.indexOf("algorithms");
    return {
      algorithmKey: parts[index + 1] || "custom_algorithm",
      version: parts[index + 2] || "custom",
    };
  }

  async function syncMinioAlgorithmAssets() {
    const manifestKeys = (await store.listObjectKeys("code-assets/algorithms/"))
      .filter((key) => key.endsWith("/manifest.json"));
    for (const manifestKey of manifestKeys) {
      const manifest = await readAlgorithmManifest(manifestKey);
      if (!manifest) continue;
      const fallback = algorithmKeyFromManifestKey(manifestKey);
      const algorithmKey = cleanName(manifest.algorithmKey || manifest.algorithm_key || fallback.algorithmKey, "algorithm").toLowerCase();
      const version = cleanName(manifest.version || fallback.version || "custom", "version").toLowerCase();
      if (version === "builtin" && !supportedBuiltinKeys.includes(algorithmKey)) continue;
      const minioPrefix = manifestKey.replace(/\/manifest\.json$/, "");
      const adapterKey = manifest.adapterKey || manifest.adapter_key || manifest.entry?.adapterKey || `${minioPrefix}/${manifest.entry?.adapter || "adapter.py"}`;
      const taskType = manifest.task_type || manifest.taskType || manifest.tasks?.[0] || "detect";
      const builtinDefinition = version === "builtin"
        ? builtinAlgorithmAssets.find((item) => item.algorithmKey === algorithmKey)
        : null;
      const parameterSchema = builtinDefinition?.parameterSchema
        || manifest.parameterSchema
        || manifest.capabilities?.parameterSchema
        || { groups: [] };
      const defaultParams = builtinDefinition?.params
        || manifest.params
        || manifest.defaultParams
        || manifest.default_params
        || {};
      await query(
        `INSERT INTO algorithm_assets
         (name, algorithm_key, framework, task_type, version, source_type, minio_prefix, manifest_key, adapter_key, source_prefix, capabilities_json, default_params_json, description, status)
         VALUES ($1,$2,$3,$4,$5,'minio',$6,$7,$8,$9,$10,$11,$12,'ready')
         ON CONFLICT (algorithm_key, version) DO UPDATE SET
           name=EXCLUDED.name,
           framework=EXCLUDED.framework,
           task_type=EXCLUDED.task_type,
           source_type=CASE WHEN algorithm_assets.source_type='builtin' THEN algorithm_assets.source_type ELSE EXCLUDED.source_type END,
           minio_prefix=EXCLUDED.minio_prefix,
           manifest_key=EXCLUDED.manifest_key,
           adapter_key=EXCLUDED.adapter_key,
           source_prefix=EXCLUDED.source_prefix,
           capabilities_json=EXCLUDED.capabilities_json,
           default_params_json=EXCLUDED.default_params_json,
           description=EXCLUDED.description,
           status='ready',
           deleted_at=NULL,
           updated_at=now()`,
        [
          manifest.name || algorithmKey,
          algorithmKey,
          manifest.framework || "custom",
          taskType,
          version,
          minioPrefix,
          manifestKey,
          adapterKey,
          `${minioPrefix}/source/`,
          JSON.stringify({
            ...(manifest.capabilities || {}),
            tasks: manifest.tasks || manifest.capabilities?.tasks || [taskType],
            parameterSchema,
            minioSynced: true,
          }),
          JSON.stringify(defaultParams),
          manifest.description || "从 MinIO 算法资产 manifest 自动登记",
        ],
      );
    }
  }

  async function listAlgorithmAssets(actor, scope = "mine") {
    try {
      await ensureBuiltinAlgorithmAssets();
      await syncMinioAlgorithmAssets();
      const adminId = await resourceAccess.getAdminId();
      await query("UPDATE algorithm_assets SET owner_user_id=$1 WHERE owner_user_id IS NULL", [adminId]);
      await query("UPDATE algorithm_assets SET visibility='public' WHERE source_type='builtin' OR version='builtin'");
      const scoped = resourceAccess.scopeSql({ table: "algorithm_assets", alias: "a", actor, scope, params: [] });
      const rows = await query(
        `SELECT a.* FROM algorithm_assets a
         WHERE a.deleted_at IS NULL AND ${scoped.sql}
         ORDER BY source_type='builtin' DESC, name, version`,
        scoped.params,
      );
      return rows.rows;
    } catch (error) {
      if (!["42P01", "XX002", "57014"].includes(error.code)) throw error;
      return getBuiltinAlgorithmAssetFallbacks();
    }
  }

  return {
    ensureBuiltinAlgorithmAssets,
    syncMinioAlgorithmAssets,
    listAlgorithmAssets,
    getBuiltinTrainingTemplateFallbacks,
  };
}

module.exports = { createAlgorithmAssetService };
