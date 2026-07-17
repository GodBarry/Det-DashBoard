const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createDatasetContentService } = require("../../server/dataset/content-service");

function createFixture({ query, transaction, store, lifecycle, fs, resourceAccess } = {}) {
  const tracked = [];
  const ownerCalls = [];
  const service = createDatasetContentService({
    query: query || (async () => ({ rows: [] })),
    transaction: transaction || (async (callback) => callback({ query })),
    store: store || {},
    resourceAccess: resourceAccess || {
      async assignOwner(...args) {
        ownerCalls.push(args);
      },
    },
    lifecycle: lifecycle || {
      isShuttingDown: () => false,
      trackExport(task) {
        tracked.push(task);
      },
    },
    fs: fs || {},
    path,
    sharp: () => { throw new Error("sharp should not be called"); },
    storageRoot: "C:\\storage",
    exportRoot: "C:\\exports",
    exportRootDisplay: "E:\\exports",
    cleanName: (value) => value,
    exportBaseName: (_item, index) => `image_${index}`,
    normalizeExportFormat: (value) => ["labelme", "coco", "yolo"].includes(String(value || "").toLowerCase())
      ? String(value).toLowerCase()
      : null,
    labelmeDocument: () => ({}),
    cocoDocument: () => ({}),
    yoloDocuments: () => ({ labelFiles: new Map(), dataYaml: "" }),
    sendError: (res, statusCode, message) => {
      res.error = { statusCode, message };
    },
  });
  return { ownerCalls, service, tracked };
}

test("saveImageAnnotations preserves label creation, clamping, and transaction boundaries", async () => {
  const actor = { id: "user-1" };
  const queryCalls = [];
  const transactionCalls = [];
  const query = async (sql, params) => {
    queryCalls.push({ sql, params });
    if (sql.includes("FROM project_images pi")) {
      return { rows: [{ id: "image-1", project_id: "project-1", image_width: 100, image_height: 50, active_label_version_id: null }] };
    }
    if (sql.includes("INSERT INTO label_versions")) return { rows: [{ id: "label-version-1" }] };
    if (sql.startsWith("UPDATE projects SET active_label_version_id")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const transaction = async (callback) => callback({
    async query(sql, params) {
      transactionCalls.push({ sql, params });
      if (sql.includes("INSERT INTO image_annotations")) return { rows: [{ id: "annotation-1", label: params[2] }] };
      return { rows: [] };
    },
  });
  const { ownerCalls, service } = createFixture({ query, transaction });

  const result = await service.saveImageAnnotations("image-1", {
    annotations: [{ label: "  ", bbox_x: 120, bbox_y: -5, bbox_w: 20, bbox_h: 80, difficult: 1, score: "0.5", attributes: { source: "manual" } }],
  }, actor);

  assert.deepEqual(result, { annotations: [{ id: "annotation-1", label: "unknown" }] });
  assert.deepEqual(ownerCalls, [["label_versions", "label-version-1", actor]]);
  assert.match(queryCalls[1].params[1], /^manual_\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(queryCalls[2].params, ["label-version-1", "project-1"]);
  assert.equal(transactionCalls[0].sql, "DELETE FROM image_annotations WHERE label_version_id=$1 AND project_image_id=$2");
  assert.deepEqual(transactionCalls[0].params, ["label-version-1", "image-1"]);
  assert.deepEqual(transactionCalls[1].params, [
    "label-version-1", "image-1", "unknown", 99, 0, 1, 50, "rectangle", true, 0.5, { source: "manual" },
  ]);
  assert.deepEqual(transactionCalls[2], {
    sql: "UPDATE projects SET updated_at=now() WHERE id=$1",
    params: ["project-1"],
  });
});

test("listProjectImages preserves filter SQL ordering and annotated response shape", async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT pi.*")) return { rows: [{ id: "image-1", display_name: "one.jpg" }] };
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: 1 }] };
    if (sql.startsWith("SELECT a.id")) {
      return { rows: [
        { id: "annotation-1", project_image_id: "image-1", label: "car" },
        { id: "annotation-2", project_image_id: "image-1", label: "car" },
      ] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const { service } = createFixture({ query });

  const result = await service.listProjectImages("project-1", {
    page: "2",
    pageSize: "20",
    scenes: "road, yard",
    labels: "car",
    q: "front",
  });

  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 20);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].annotations.map((item) => item.id), ["annotation-1", "annotation-2"]);
  assert.deepEqual(calls[0].params, ["project-1", ["road", "yard"], "%front%", ["car"], 20, 20]);
  assert.match(calls[0].sql, /ORDER BY pi\.created_at DESC\s+LIMIT \$5 OFFSET \$6/);
  assert.deepEqual(calls[1].params, ["project-1", ["road", "yard"], "%front%", ["car"]]);
  assert.deepEqual(calls[2].params, ["project-1", ["image-1"], ["car"]]);
  assert.match(calls[2].sql, /ORDER BY a\.id/);
});

test("streamProjectImage preserves full and cached-thumbnail stream contracts", async () => {
  const keys = [];
  const piped = [];
  const store = {
    async objectExists(key) {
      keys.push(["exists", key]);
      return true;
    },
    async getStream(key) {
      keys.push(["stream", key]);
      return { pipe(target) { piped.push(target); } };
    },
  };
  const query = async () => ({ rows: [{ id: "asset-1", project_image_id: "image-1", object_key: "images/original.jpg", original_ext: ".jpg" }] });
  const { service } = createFixture({ query, store });
  const fullRes = { writeHead(statusCode, headers) { this.head = { statusCode, headers }; } };
  const thumbRes = { writeHead(statusCode, headers) { this.head = { statusCode, headers }; } };

  await service.streamProjectImage(fullRes, "image-1", false);
  await service.streamProjectImage(thumbRes, "image-1", true);

  assert.deepEqual(fullRes.head, {
    statusCode: 200,
    headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=3600" },
  });
  assert.deepEqual(thumbRes.head, {
    statusCode: 200,
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, max-age=604800, immutable",
      "x-image-variant": "thumb-420",
    },
  });
  assert.deepEqual(keys, [
    ["stream", "images/original.jpg"],
    ["exists", "cache/thumbs/images/asset-1.webp"],
    ["stream", "cache/thumbs/images/asset-1.webp"],
  ]);
  assert.deepEqual(piped, [fullRes, thumbRes]);
});

test("exportProject rejects invalid formats and preserves deferred scheduling contract", async () => {
  let invalidQueryCount = 0;
  const invalid = createFixture({ query: async () => { invalidQueryCount += 1; return { rows: [] }; } });
  await assert.rejects(
    invalid.service.exportProject("project-1", { format: "zip" }, { id: "user-1" }),
    (error) => error.statusCode === 400 && /labelme/.test(error.message),
  );
  assert.equal(invalidQueryCount, 0);

  const calls = [];
  const fsCalls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT * FROM projects")) return { rows: [{ id: "project-1", name: "demo", active_label_version_id: null }] };
    if (sql.startsWith("INSERT INTO jobs")) return { rows: [{ id: "job-1", status: "running" }] };
    if (sql.startsWith("SELECT pi.*")) return { rows: [] };
    if (sql.startsWith("UPDATE jobs SET status='done'")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const fakeFs = {
    mkdirSync(target, options) { fsCalls.push(["mkdir", target, options]); },
    rmSync(target, options) { fsCalls.push(["rm", target, options]); },
  };
  const { ownerCalls, service, tracked } = createFixture({ query, fs: fakeFs });
  const actor = { id: "user-2" };

  const response = await service.exportProject("project-1", { format: "labelme" }, actor);

  assert.deepEqual(response, { jobId: "job-1", status: "running", outputRoot: "E:\\exports", format: "labelme" });
  assert.deepEqual(ownerCalls, [["jobs", "job-1", actor]]);
  assert.equal(tracked.length, 1);
  assert.equal(calls.length, 2, "background export must not run before the scheduling response");
  await tracked[0];
  assert.match(calls[2].sql, /ORDER BY pi\.created_at/);
  assert.match(calls.at(-1).sql, /status='done', progress=100/);
  assert.equal(fsCalls.filter(([method]) => method === "rm").length, 1);
});
