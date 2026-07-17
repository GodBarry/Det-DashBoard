const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createImportService } = require("../../server/dataset/import-service");

function emptySplitPlan() {
  return Object.fromEntries(["train", "val", "test"].map((split) => [split, { files: new Set(), directories: new Set() }]));
}

function createFixture(overrides = {}) {
  const tracked = [];
  const deferred = [];
  const ownerCalls = [];
  const baseQuery = overrides.query || (async () => ({ rows: [] }));
  const deps = {
    query: baseQuery,
    transaction: overrides.transaction || (async (callback) => callback({ query: baseQuery })),
    accessControl: overrides.accessControl || { async ensureAssetOwner() {} },
    resourceAccess: overrides.resourceAccess || {
      async assertProjectWrite() {},
      async assignOwner(...args) { ownerCalls.push(args); },
    },
    lifecycle: overrides.lifecycle || {
      isShuttingDown: () => false,
      trackImport(task) { tracked.push(task); },
    },
    fs: overrides.fs || {
      existsSync: () => true,
      statSync: () => ({ isDirectory: () => true, size: 1 }),
    },
    path,
    sharp: overrides.sharp || (() => ({ metadata: async () => ({}) })),
    store: overrides.store || { putFile: async () => {}, objectSize: async () => 0 },
    IMAGE_EXTS: new Set([".jpg"]),
    VIDEO_EXTS: new Set([".mp4"]),
    walk: overrides.walk || (() => []),
    walkAsync: overrides.walkAsync || (async () => []),
    hashFile: async () => "sha",
    quickHash: () => "quick",
    inferModality: () => "visible",
    inferSceneFromPath: () => "UnknownScene",
    cleanName: (value, fallback) => value || fallback,
    buildDatasetMatches: overrides.buildDatasetMatches || (() => ({
      matches: new Map(), unresolved: [], usedLabelFiles: [], formatCounts: {},
    })),
    imageKey: (value) => value,
    shapeToBox: () => null,
    imageObjectKey: (sha, ext) => `images/${sha}${ext}`,
    videoObjectKey: (sha, ext) => `videos/${sha}${ext}`,
    rawLabelObjectKey: (...parts) => parts.join("/"),
    discoverDatasetSplitPlan: overrides.discoverDatasetSplitPlan || emptySplitPlan,
    splitForImage: () => null,
    serializeSplitPlan: overrides.serializeSplitPlan || ((_plan, ids) => ({ detected: false, splits: {}, ids })),
    toInternalDataPath: (value) => value,
    toDisplayDataPath: (value) => `display:${value}`,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    logger: { error() {} },
    defer: overrides.defer || ((callback) => deferred.push(callback)),
    now: () => 1000,
  };
  return { service: createImportService(deps), tracked, deferred, ownerCalls };
}

test("importPath preserves creation transaction, ownership, lifecycle, and response contract", async () => {
  const transactionCalls = [];
  const project = { id: "project-1", name: "demo", owner_user_id: "owner-1" };
  const batch = { id: "batch-1", status: "scanning" };
  const transaction = async (callback) => callback({
    async query(sql, params) {
      transactionCalls.push({ sql, params });
      if (sql.startsWith("SELECT pg_advisory")) return { rows: [] };
      if (sql.startsWith("SELECT * FROM projects")) return { rows: [project] };
      if (sql.startsWith("SELECT id FROM import_batches")) return { rows: [] };
      if (sql.includes("INSERT INTO import_batches")) return { rows: [batch] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  const { service, tracked, deferred, ownerCalls } = createFixture({ transaction });
  const body = { projectId: "project-1", sourcePaths: ["C:\\data", "C:\\data"] };
  const actor = { id: "user-1" };

  const result = await service.importPath(body, actor);

  assert.deepEqual(result, { project, batch, splitResult: { detected: false, splits: {}, ids: {} } });
  assert.deepEqual(transactionCalls.map(({ params }) => params), [
    ["project-1"],
    ["project-1"],
    ["project-1"],
    ["project-1", "display:C:\\data", "正在扫描文件"],
  ]);
  assert.deepEqual(ownerCalls, [["import_batches", "batch-1", actor]]);
  assert.equal(tracked.length, 1);
  assert.equal(deferred.length, 1);
  assert.deepEqual(body.sourcePaths, ["C:\\data"]);
  assert.equal(body.actorId, "user-1");
});

test("cancelImport and importCancelled preserve cancellation SQL and status rules", async () => {
  const calls = [];
  const statuses = ["running", "cancel_requested", "cancelled", "deleted", null];
  const { service } = createFixture({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT status")) {
        const status = statuses.shift();
        return { rows: status ? [{ status }] : [] };
      }
      return { rows: [] };
    },
  });

  await service.cancelImport("batch-1");
  assert.deepEqual(calls[0].params, ["正在取消导入", "batch-1"]);
  assert.match(calls[0].sql, /status IN \('scanning','running'\)/);
  assert.equal(await service.importCancelled("batch-1"), false);
  assert.equal(await service.importCancelled("batch-1"), true);
  assert.equal(await service.importCancelled("batch-1"), true);
  assert.equal(await service.importCancelled("batch-1"), true);
  assert.equal(await service.importCancelled("batch-1"), true);
});

test("ensureSplitProjects preserves train-val-test order and owner assignment", async () => {
  const calls = [];
  const ownerCalls = [];
  const plan = emptySplitPlan();
  plan.train.files.add("train.jpg");
  plan.val.directories.add("val");
  const { service } = createFixture({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT id FROM projects")) return { rows: [] };
      if (sql.startsWith("INSERT INTO projects")) return { rows: [{ id: `${params[0]}-id` }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    accessControl: {
      async ensureAssetOwner(...args) { ownerCalls.push(args); },
    },
  });

  const result = await service.ensureSplitProjects({ id: "parent-1", name: "demo", owner_user_id: "owner-1" }, plan);

  assert.deepEqual(result, { train: "train-id", val: "val-id" });
  assert.deepEqual(calls.filter(({ sql }) => sql.startsWith("SELECT")).map(({ params }) => params[1]), ["train", "val"]);
  assert.deepEqual(ownerCalls, [
    [{ id: "owner-1" }, "project", "train-id"],
    [{ id: "owner-1" }, "project", "val-id"],
  ]);
});

test("listImports preserves live/trash predicates, ordering, and rows", async () => {
  const calls = [];
  const rows = [{ id: "batch-1", progress: 50 }];
  const { service } = createFixture({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    },
  });

  assert.equal(await service.listImports("project-1"), rows);
  assert.match(calls[0].sql, /deleted_at IS NULL/);
  assert.match(calls[0].sql, /ORDER BY created_at DESC/);
  assert.deepEqual(calls[0].params, ["project-1"]);
  await service.listImports("project-1", true);
  assert.match(calls[1].sql, /deleted_at IS NOT NULL/);
});

test("runImportBatch propagates scanner failures unchanged", async () => {
  const failure = Object.assign(new Error("scan exploded"), { code: "EIO" });
  const { service } = createFixture({
    walkAsync: async () => { throw failure; },
  });

  await assert.rejects(
    service.runImportBatch("batch-1", { id: "project-1", owner_user_id: "owner-1" }, { sourcePath: "C:\\data" }),
    (error) => error === failure,
  );
});
