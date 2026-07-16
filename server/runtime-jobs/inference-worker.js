const {
  seededRandom,
  hashToSeed,
  clampNumber,
  shuffleWithRng,
  jitterBoxFromGt,
  randomBackgroundBox,
  fakeScore,
  boxIou,
  metricLabel,
  averagePrecision,
} = require("./inference-metrics");

function createInferenceWorker({
  query,
  transaction,
  fs,
  path,
  storageRoot,
  processRef,
  runtimeQueueService,
  pythonEnvService,
  modelService,
  runtimeAssetLinkService,
  runChildProcess,
  algorithmRuntimeSource,
  uniqueExistingPaths,
  logger,
  clock,
}) {
  const nowIso = () => new Date(clock.now()).toISOString();

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
          completedAt: nowIso(),
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
      processRef.env.DET_DASHBOARD_REFERENCE,
      processRef.env.DD_REFERENCE,
      processRef.env.DET_DASHBOARD_RUNTIME ? path.join(processRef.env.DET_DASHBOARD_RUNTIME, "reference.json") : "",
      processRef.env.DD_RUNTIME ? path.join(processRef.env.DD_RUNTIME, "reference.json") : "",
      path.join(path.dirname(storageRoot), "reference.json"),
      path.join(storageRoot, "reference.json"),
      path.resolve(__dirname, "..", "..", "..", "DD-runtime", "reference.json"),
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
      await new Promise((resolve) => clock.setTimeout(resolve, delayMs));
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
          completedAt: nowIso(),
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
    await runtimeAssetLinkService.recordSuccess(job, bestMetrics);
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
    const result = await runChildProcess(env.python_path, [runnerPath], { cwd: outputRoot, env: { ...processRef.env, PYTHONIOENCODING: "utf-8" } });
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
          completedAt: nowIso(),
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
    await runtimeAssetLinkService.recordSuccess(job, metrics);
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

    const resolved = await algorithmRuntimeSource.resolveTrainingAlgorithmSource(params);
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
    const { configPath, sourceRoot } = await algorithmRuntimeSource.resolveDinoConfigPath({ env, cacheRoot, algorithm, params, weightPath, outputRoot });
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
      result = await runChildProcess(env.python_path, commandArgs, { cwd: sourceRoot, env: { ...processRef.env, PYTHONIOENCODING: "utf-8", PYTHONPATH: [sourceRoot, cacheRoot, processRef.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } });
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
      const nextParams = { ...params, output: { ...(params.output || {}), predictionsPath, visualizationDir, resultCount: rows.length, predictionCount, completedAt: nowIso(), metrics, command: [env.python_path, ...commandArgs], stdout: result.stdout, stderr: result.stderr, executionLog: result.combined || `${result.stdout || ""}${result.stderr || ""}` } };
      await client.query(
        "UPDATE runtime_inference_jobs SET status='done', progress=100, params_json=$1, metrics_json=$2, message=$3, finished_at=now() WHERE id=$4",
        [JSON.stringify(nextParams), JSON.stringify(metrics), `DINO inference completed: ${rows.length} images, ${predictionCount} boxes`, job.id],
      );
    });
    await runtimeAssetLinkService.recordSuccess(job, metrics);
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
          failedAt: nowIso(),
        },
      };
      await query(
        "UPDATE runtime_inference_jobs SET status='failed', message=$1, params_json=$2, finished_at=now() WHERE id=$3",
        [error.message || `推理 worker ${workerId} 执行失败`, JSON.stringify(nextParams), job.id],
      ).catch(() => {});
    }
  }

  function startInferenceWorker() {
    if (String(processRef.env.INFERENCE_WORKER_ENABLED || "true").toLowerCase() === "false") return;
    const workerId = `local-infer-${processRef.pid}`;
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
          logger.error("inference worker error:", error);
        } finally {
          busy = false;
        }
      })();
      return activeTick;
    };
    const interval = clock.setInterval(tick, Number(processRef.env.INFERENCE_WORKER_INTERVAL_MS || 2500));
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
    isDummyInferenceJob,
    isFakeReferenceInferenceJob,
    runDummyInferenceJob,
    fakeReferenceConfigCandidates,
    readFakeReferenceConfig,
    loadFakeReferenceGroundTruth,
    generateFakeReferenceRows,
    metricDistance,
    runFakeReferenceInferenceJob,
    computeDetectionMetrics,
    runUltralyticsInferenceJob,
    normalizeTorchDevice,
    runDinoInferenceJob,
    runInferenceJob,
    startInferenceWorker,
  };
}

module.exports = { createInferenceWorker };
