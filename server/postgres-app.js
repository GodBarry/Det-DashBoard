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
const { createRuntimeJobService } = require("./runtime-jobs/job-service");
const { createTrainingCatalogService } = require("./runtime-jobs/training-catalog-service");
const { createRuntimeQueueService } = require("./runtime-jobs/queue-service");
const { createRuntimeWorkerSupport } = require("./runtime-jobs/worker-support");
const { createInferenceWorker } = require("./runtime-jobs/inference-worker");
const { createTrainingWorker } = require("./runtime-jobs/training-worker");
const { createInferenceInputCacheService } = require("./runtime-jobs/inference-input-cache-service");
const { createModelService } = require("./ml-assets/model-service");
const { createModelMaintenanceService } = require("./ml-assets/model-maintenance-service");
const { createPythonEnvService } = require("./ml-assets/python-env-service");
const { createAlgorithmAssetService } = require("./ml-assets/algorithm-asset-service");
const { createAlgorithmRuntimeSource } = require("./ml-assets/algorithm-runtime-source");
const { createRuntimeAssetLinkService } = require("./ml-assets/runtime-asset-link-service");
const { ensureRuntimeSchema } = require("./schema/runtime-schema");
const { seedMlRuntimeConfig: seedMlRuntimeConfigWithDeps } = require("./schema/ml-runtime-seed");
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
} = require("./training-format");

const lifecycle = runtime.lifecycle;
const staticHandler = runtime.staticHandler;
const { stopProcess, runChildProcess, appendTrainingLog } = createRuntimeWorkerSupport({ query, spawn, processRef: process });
const runtimeWorkerClock = {
  now: Date.now,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
};
const algorithmRuntimeSource = createAlgorithmRuntimeSource({
  query,
  store,
  storageRoot,
  fs,
  path,
  spawnSync,
  walk,
  cleanName,
  writeObjectToFile,
  runChildProcess,
  processRef: process,
  logger: console,
});

let accessControl;
let resourceAccess;
let collaborationService;
let multiUserRouter;
let projectService;
let datasetContentService;
let runtimeJobService;
let trainingCatalogService;
let runtimeQueueService;
let prepareInferenceInputCache;
let modelService;
let modelMaintenanceService;
let pythonEnvService;
let algorithmAssetService;
let runtimeAssetLinkService;
let inferenceWorkerController;
let trainingWorkerController;
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
modelMaintenanceService = createModelMaintenanceService({ query, store, fs, path, storageRoot, isInsideRoot });
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

function seedMlRuntimeConfig() {
  return seedMlRuntimeConfigWithDeps({ query, path, storageRoot, pythonEnvService, uniqueExistingPaths });
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

async function presentTrainingJobs(jobs) {
  return runtimeJobService.presentTrainingJobs(jobs);
}

async function listTrainingJobs(actor, scope = "mine") {
  return runtimeJobService.listTrainingJobs(actor, scope);
}

async function normalizeTrainingInitialization(body, params, actor) {
  return runtimeJobService.normalizeTrainingInitialization(body, params, actor);
}

async function createTrainingJob(body = {}, actor) {
  return runtimeJobService.createTrainingJob(body, actor);
}

async function requeueTrainingJob(jobId, body = {}) {
  return runtimeJobService.requeueTrainingJob(jobId, body);
}

async function pauseTrainingJob(jobId) {
  return runtimeJobService.pauseTrainingJob(jobId);
}

async function resumeTrainingJob(jobId) {
  return runtimeJobService.resumeTrainingJob(jobId);
}

async function deleteTrainingJob(jobId) {
  return runtimeJobService.deleteTrainingJob(jobId);
}

async function listInferenceJobs(actor, scope = "mine") {
  return runtimeJobService.listInferenceJobs(actor, scope);
}

async function listInferenceResults(jobId) {
  return runtimeJobService.listInferenceResults(jobId);
}

async function getInferenceEvaluation(jobId) {
  return runtimeJobService.getInferenceEvaluation(jobId);
}

async function deleteInferenceJob(jobId) {
  return runtimeJobService.deleteInferenceJob(jobId);
}

async function requeueInferenceJob(jobId) {
  return runtimeJobService.requeueInferenceJob(jobId);
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
  if (method === "POST" && parsed.pathname === "/api/ml/model-assets/clear") { accessControl.requireAdmin(actor); return sendJson(res, await modelMaintenanceService.clearModelAssets(await readBody(req))); }
  if (method === "GET" && parsed.pathname === "/api/ml/algorithm-assets") return sendJson(res, { algorithms: await algorithmAssetService.listAlgorithmAssets(actor, requestedScope(parsed, actor)) });
  if (method === "GET" && parsed.pathname === "/api/ml/asset-links") return sendJson(res, { links: await runtimeAssetLinkService.listLinks(actor, requestedScope(parsed, actor)) });
  if (method === "GET" && parsed.pathname === "/api/ml/training-templates") return sendJson(res, { templates: await trainingCatalogService.listTrainingTemplates(actor, requestedScope(parsed, actor)) });
  if (method === "POST" && parsed.pathname === "/api/ml/training-templates") return sendJson(res, { template: await trainingCatalogService.createTrainingTemplate(await readBody(req), actor) });
  if (method === "GET" && parsed.pathname === "/api/ml/python-envs") return sendJson(res, { envs: await pythonEnvService.listPythonEnvs(actor, requestedScope(parsed, actor)) });
  if (method === "POST" && parsed.pathname === "/api/ml/python-envs") return sendJson(res, { env: await pythonEnvService.createPythonEnv(await readBody(req), actor) });
  const pythonEnvDownload = parsed.pathname.match(/^\/api\/ml\/python-envs\/([^/]+)\/download$/);
  if (method === "GET" && pythonEnvDownload) { await resourceAccess.assertIndependentAccess("runtime_envs", pythonEnvDownload[1], actor, "read"); return pythonEnvService.streamPythonEnvArtifact(res, pythonEnvDownload[1]); }
  const renameModelVersionMatch = parsed.pathname.match(/^\/api\/ml\/model-versions\/([^/]+)$/);
  if (method === "PATCH" && renameModelVersionMatch) { await resourceAccess.assertIndependentAccess("model_revisions", renameModelVersionMatch[1], actor, "write"); return sendJson(res, { version: await modelService.renameModelVersion(renameModelVersionMatch[1], await readBody(req)) }); }
  const modelVersionDownload = parsed.pathname.match(/^\/api\/ml\/model-versions\/([^/]+)\/download$/);
  if (method === "GET" && modelVersionDownload) { await resourceAccess.assertIndependentAccess("model_revisions", modelVersionDownload[1], actor, "read"); return modelService.streamModelArtifact(res, modelVersionDownload[1], parsed.query.artifactId || parsed.query.artifact_id); }
  if (method === "GET" && parsed.pathname === "/api/ml/dataset-snapshots") return sendJson(res, { snapshots: await trainingCatalogService.listDatasetSnapshots(actor, requestedScope(parsed, actor)) });
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
  await ensureRuntimeSchema({ query, authService, seedMlRuntimeConfig });
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
  runtimeJobService = createRuntimeJobService({
    query,
    scopedSql,
    httpError,
    evaluateDetections,
    normalizeTrainingDatasetSplits,
    normalizeTrainingDatasetFilters,
    resourceAccess,
    pythonEnvService,
    storageRoot,
    fs,
    path,
    stopProcess,
    appendTrainingLog,
  });
  ({ prepareInferenceInputCache } = createInferenceInputCacheService({
    query,
    fs,
    path,
    storageRoot,
    writeObjectToFile,
  }));
  runtimeAssetLinkService = createRuntimeAssetLinkService({
    query,
    scopeSql: ({ table, alias, actor, scope, params }) => scopedSql(table, alias, actor, scope, params),
  });
  algorithmAssetService = createAlgorithmAssetService({
    query,
    resourceAccess,
    store,
    cleanName,
    algorithmAssetPrefix,
    algorithmManifestKey,
    algorithmAdapterKey,
  });
  trainingCatalogService = createTrainingCatalogService({
    query,
    scopedSql,
    algorithmAssetService,
    resourceAccess,
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
  inferenceWorkerController = createInferenceWorker({
    query,
    transaction,
    fs,
    path,
    storageRoot,
    processRef: process,
    runtimeQueueService,
    pythonEnvService,
    modelService,
    runtimeAssetLinkService,
    runChildProcess,
    algorithmRuntimeSource,
    uniqueExistingPaths,
    logger: console,
    clock: runtimeWorkerClock,
  });
  trainingWorkerController = createTrainingWorker({
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
    processRef: process,
    logger: console,
    clock: runtimeWorkerClock,
    dateCode,
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
  await runtimeAssetLinkService.backfillInferenceSuccesses();
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
  const trainingWorker = trainingWorkerController.startTrainingWorker();
  const inferenceWorker = inferenceWorkerController.startInferenceWorker();
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
