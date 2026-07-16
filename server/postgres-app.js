const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const sharp = require("sharp");
const { createRuntimeContext } = require("./bootstrap/runtime-context");
const { createProcessLifecycle } = require("./bootstrap/process-lifecycle");
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
const { createBaselineService } = require("./dataset/baseline-service");
const { createImportService } = require("./dataset/import-service");
const { createTrashService } = require("./dataset/trash-service");
const { createDatasetRoutes } = require("./routes/dataset-routes");
const { createMlRoutes } = require("./routes/ml-routes");
const { createRuntimeJobService } = require("./runtime-jobs/job-service");
const { createTrainingCatalogService } = require("./runtime-jobs/training-catalog-service");
const { createRuntimeQueueService } = require("./runtime-jobs/queue-service");
const { createRuntimeWorkerSupport } = require("./runtime-jobs/worker-support");
const { createInferenceWorker } = require("./runtime-jobs/inference-worker");
const { createTrainingWorker } = require("./runtime-jobs/training-worker");
const { createInferenceInputCacheService } = require("./runtime-jobs/inference-input-cache-service");
const { createInferenceSubmissionService } = require("./runtime-jobs/inference-submission-service");
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
let baselineService;
let importService;
let datasetRoutes;
let mlRoutes;
let inferenceSubmissionService;
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

function dateCode() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
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
  if (await datasetRoutes.handle(req, res, parsed, actor)) return;
  if (await mlRoutes.handle(req, res, parsed, actor)) return;
  if (method === "GET" && parsed.pathname === "/api/jobs") {
    const scoped = scopedSql("jobs", "j", actor, requestedScope(parsed, actor));
    const rows = await query(`SELECT j.* FROM jobs j WHERE ${scoped.sql} ORDER BY created_at DESC LIMIT 50`, scoped.params);
    return sendJson(res, { jobs: rows.rows });
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
  baselineService = createBaselineService({ query, transaction, accessControl });
  runtimeQueueService = createRuntimeQueueService({ query, transaction, accessControl });
  resourceAccess = createResourceAccess({ query, transaction, httpError, accessControl });
  await resourceAccess.initializeSchema();
  importService = createImportService({
    query,
    transaction,
    accessControl,
    resourceAccess,
    lifecycle,
    fs,
    path,
    sharp,
    store,
    IMAGE_EXTS,
    VIDEO_EXTS,
    walk,
    walkAsync,
    hashFile,
    quickHash,
    inferModality,
    inferSceneFromPath,
    cleanName,
    buildDatasetMatches,
    imageKey,
    shapeToBox,
    imageObjectKey,
    videoObjectKey,
    rawLabelObjectKey,
    discoverDatasetSplitPlan,
    splitForImage,
    serializeSplitPlan,
    toInternalDataPath,
    toDisplayDataPath,
    httpError,
    logger: console,
  });
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
  inferenceSubmissionService = createInferenceSubmissionService({
    query,
    resourceAccess,
    algorithmAssetService,
    prepareInferenceInputCache,
    fs,
    path,
    storageRoot,
    logger: console,
  });
  mlRoutes = createMlRoutes({
    query,
    readBody,
    sendJson,
    requestedScope,
    accessControl,
    resourceAccess,
    modelService,
    modelMaintenanceService,
    algorithmAssetService,
    runtimeAssetLinkService,
    trainingCatalogService,
    pythonEnvService,
    runtimeQueueService,
    runtimeJobService,
    createInferenceJob: inferenceSubmissionService.createInferenceJob,
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
  datasetRoutes = createDatasetRoutes({
    query,
    readBody,
    sendJson,
    httpError,
    requestedScope,
    accessControl,
    resourceAccess,
    projectService,
    trashService,
    importService,
    datasetContentService,
    baselineService,
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
  return processLifecycle.startHttpServer();
}

const processLifecycle = createProcessLifecycle({
  createServer: http.createServer,
  route,
  sendError,
  lifecycle,
  startTrainingWorker: () => trainingWorkerController.startTrainingWorker(),
  startInferenceWorker: () => inferenceWorkerController.startInferenceWorker(),
  pool,
  port,
  host,
  dataRoot,
  dataRootDisplay,
  browseRoot,
  browseRootDisplay,
  hostPathMode,
  storageRoot,
  processRef: process,
  globalRef: globalThis,
  logger: console,
});

processLifecycle.run(main);
