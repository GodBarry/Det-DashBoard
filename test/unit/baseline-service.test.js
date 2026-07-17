const test = require("node:test");
const assert = require("node:assert/strict");

const { createBaselineService } = require("../../server/dataset/baseline-service");

function sourceRows() {
  return [
    { id: "image-1", project_id: "source-1", project_name: "one", image_asset_id: "asset-1", display_name: "one.jpg", source_path: null, scene: "road", view: "front", modality: "rgb", keyword: "car" },
    { id: "image-2", project_id: "source-2", project_name: "two", image_asset_id: "asset-1", display_name: "two.jpg", source_path: "two.jpg", scene: "road", view: "front", modality: "rgb", keyword: "car" },
  ];
}

function annotations() {
  return [
    { id: "ann-1", project_image_id: "image-1", label: "car", bbox_x: 1, bbox_y: 2, bbox_w: 10, bbox_h: 20, attributes_json: { source: 1 } },
    { id: "ann-2", project_image_id: "image-2", label: "truck", bbox_x: 1, bbox_y: 2, bbox_w: 10, bbox_h: 20, attributes_json: { source: 2 } },
  ];
}

test("preview preserves source loading, conflict insert, summary, and response contracts", async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT pi.*")) return { rows: sourceRows() };
    if (sql.startsWith("SELECT a.*")) return { rows: annotations() };
    if (sql.includes("INSERT INTO baseline_merge_runs")) return { rows: [{ id: "run-1" }] };
    return { rows: [], rowCount: 1 };
  };
  const service = createBaselineService({ query, transaction: async () => {}, accessControl: {} });

  const result = await service.createBaselinePreview({ sourceProjectIds: ["source-1", "source-2", "source-1"], name: "baseline", labelMap: { truck: "lorry" } });

  assert.deepEqual(result.summary, { source_projects: 2, source_images: 2, unique_images: 1, auto_resolved: 0, conflicts: 1, annotations_kept: 1, by_type: { label_conflict: 1 } });
  assert.equal(result.runId, "run-1");
  assert.deepEqual(calls[0].params, [["source-1", "source-2"]]);
  assert.deepEqual(calls[1].params, [["source-1", "source-2"], ["image-1", "image-2"]]);
  assert.deepEqual(calls[2].params.slice(0, 2), ["baseline", ["source-1", "source-2"]]);
  assert.match(calls[3].sql, /INSERT INTO baseline_conflicts/);
  assert.deepEqual(calls[3].params.slice(0, 4), ["run-1", "asset-1", "label_conflict", "high"]);
  assert.equal(calls[4].sql, "UPDATE baseline_merge_runs SET summary_json=$1, log_json=$2 WHERE id=$3");
  await assert.rejects(service.createBaselinePreview(), { message: "Select at least one source project." });
});

test("conflict list and resolution preserve SQL, defaults, deduplication, and empty shortcut", async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT bc.*")) return { rows: [{ id: "conflict-1" }] };
    return { rows: [{ id: "conflict-1" }], rowCount: 1 };
  };
  const service = createBaselineService({ query, transaction: async () => {}, accessControl: {} });

  assert.deepEqual(await service.listBaselineConflicts("run-1"), [{ id: "conflict-1" }]);
  assert.deepEqual(await service.resolveBaselineConflicts("run-1", { conflictIds: ["conflict-1", "conflict-1"], resolution: "source_project:source-2" }), { updated: 1 });
  assert.deepEqual(calls[1].params, ["resolved", "source_project:source-2", "run-1", ["conflict-1"]]);
  assert.match(calls[1].sql, /id = ANY\(\$4::uuid\[\]\)/);
  assert.deepEqual(await service.resolveBaselineConflicts("run-1", { conflictIds: [] }), { updated: 0 });
  assert.equal(calls.length, 2);
});

test("apply preserves conflict choice, label-version writes, transaction boundary, ownership, and result", async () => {
  const outside = [];
  const inside = [];
  const ownerCalls = [];
  const query = async (sql, params) => {
    outside.push({ sql, params });
    if (sql.startsWith("SELECT * FROM baseline_merge_runs")) return { rows: [{ id: "run-1", name: "preview", status: "preview", source_project_ids: ["source-1", "source-2"], params_json: {} }] };
    if (sql.startsWith("SELECT pi.*")) return { rows: sourceRows() };
    if (sql.startsWith("SELECT a.*")) return { rows: annotations() };
    throw new Error(`Unexpected outside SQL: ${sql}`);
  };
  const transaction = async (callback) => callback({
    async query(sql, params) {
      inside.push({ sql, params });
      if (sql.startsWith("SELECT * FROM baseline_conflicts")) return { rows: [{ image_asset_id: "asset-1", conflict_type: "label_conflict", severity: "high", resolution: "source_project:source-2" }] };
      if (sql.startsWith("INSERT INTO projects")) return { rows: [{ id: "project-1", name: params[0] }] };
      if (sql.startsWith("INSERT INTO label_versions")) return { rows: [{ id: "version-1" }] };
      if (sql.includes("INSERT INTO project_images")) return { rows: [{ id: "baseline-image-1" }] };
      if (sql.includes("INSERT INTO image_annotations")) return { rows: [{ id: "baseline-ann-1" }] };
      return { rows: [] };
    },
  });
  const actor = { id: "user-1" };
  const service = createBaselineService({ query, transaction, accessControl: { async ensureAssetOwner(...args) { ownerCalls.push(args); } } });

  const result = await service.applyBaselineRun("run-1", { name: "applied" }, actor);

  assert.deepEqual(result, { project: { id: "project-1", name: "applied" }, imageCount: 1, annotationCount: 1 });
  assert.deepEqual(ownerCalls, [[actor, "project", "project-1"]]);
  assert.deepEqual(inside[1].params, ["applied", "Baseline generated from 2 projects", "user-1"]);
  assert.deepEqual(inside[2].params, ["project-1", "baseline_v1", "user-1"]);
  assert.deepEqual(inside[3].params.slice(0, 4), ["project-1", "asset-1", "two.jpg", "two.jpg"]);
  assert.equal(inside[4].params[2], "truck");
  assert.equal(inside[5].params[5], "source_priority");
  assert.deepEqual(inside.at(-2).params, ["version-1", "project-1"]);
  assert.deepEqual(inside.at(-1).params, ["project-1", "run-1"]);
  assert.equal(outside.length, 3);
});

test("apply preserves validation, transaction failure, and ownership failure propagation", async () => {
  const actor = { id: "user-1" };
  const missing = createBaselineService({ query: async () => ({ rows: [] }), transaction: async () => {}, accessControl: {} });
  await assert.rejects(missing.applyBaselineRun("missing", {}, actor), { message: "baseline run not found" });

  const applied = createBaselineService({ query: async () => ({ rows: [{ status: "applied" }] }), transaction: async () => {}, accessControl: {} });
  await assert.rejects(applied.applyBaselineRun("run-1", {}, actor), { message: "baseline run already applied" });

  let ownerCalled = false;
  const transactionError = new Error("transaction failed");
  const runQuery = async (sql) => {
    if (sql.startsWith("SELECT * FROM baseline_merge_runs")) return { rows: [{ status: "preview", source_project_ids: [], params_json: {} }] };
    return { rows: [] };
  };
  const failedTransaction = createBaselineService({
    query: runQuery,
    transaction: async () => { throw transactionError; },
    accessControl: { async ensureAssetOwner() { ownerCalled = true; } },
  });
  await assert.rejects(failedTransaction.applyBaselineRun("run-1", {}, actor), (error) => error === transactionError);
  assert.equal(ownerCalled, false);

  const ownerError = new Error("permission failed");
  const failedOwner = createBaselineService({
    query: runQuery,
    transaction: async (callback) => callback({
      async query(sql) {
        if (sql.startsWith("SELECT * FROM baseline_conflicts")) return { rows: [] };
        if (sql.startsWith("INSERT INTO projects")) return { rows: [{ id: "project-1" }] };
        if (sql.startsWith("INSERT INTO label_versions")) return { rows: [{ id: "version-1" }] };
        return { rows: [] };
      },
    }),
    accessControl: { async ensureAssetOwner() { throw ownerError; } },
  });
  await assert.rejects(failedOwner.applyBaselineRun("run-1", {}, actor), (error) => error === ownerError);
});
