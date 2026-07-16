async function seedMlRuntimeConfig({ query, path, storageRoot, pythonEnvService, uniqueExistingPaths }) {
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

module.exports = { seedMlRuntimeConfig };
