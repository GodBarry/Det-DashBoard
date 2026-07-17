const test = require("node:test");
const assert = require("node:assert/strict");

const { createTrashService } = require("../../server/dataset/trash-service");

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createFixture(query) {
  const removedObjects = [];
  const service = createTrashService({
    query,
    transaction: async (callback) => callback({ query }),
    store: {
      async removeObject(objectKey) {
        removedObjects.push(objectKey);
      },
    },
    httpError,
  });
  return { removedObjects, service };
}

test("project tree soft delete and restore preserve recursive SQL boundaries", async () => {
  const calls = [];
  const { service } = createFixture(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0 };
  });

  await service.softDeleteProjectTree("project-1");
  await service.restoreProjectTree("project-1");

  assert.deepEqual(calls.map((call) => call.params), [["project-1"], ["project-1"]]);
  assert.match(calls[0].sql, /SELECT id FROM projects WHERE id=\$1/);
  assert.match(calls[0].sql, /JOIN descendants ON p\.parent_id = descendants\.id/);
  assert.match(calls[0].sql, /UPDATE projects SET deleted_at=now\(\)/);
  assert.match(calls[0].sql, /WHERE id IN \(SELECT id FROM descendants\)/);
  assert.match(calls[1].sql, /descendants AS/);
  assert.match(calls[1].sql, /ancestors AS/);
  assert.match(calls[1].sql, /SELECT id FROM descendants\s+UNION\s+SELECT id FROM ancestors/);
  assert.match(calls[1].sql, /UPDATE projects SET deleted_at=NULL/);
  assert.match(calls[1].sql, /WHERE id IN \(SELECT id FROM affected\)/);
});

test("import soft delete and restore preserve table and status updates", async () => {
  const calls = [];
  const { service } = createFixture(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0 };
  });

  await service.softDeleteImport("import-1");
  await service.restoreImport("import-1");

  assert.deepEqual(calls, [
    { sql: "UPDATE import_batches SET deleted_at=now(), status='deleted' WHERE id=$1", params: ["import-1"] },
    { sql: "UPDATE project_images SET deleted_at=now() WHERE import_batch_id=$1", params: ["import-1"] },
    { sql: "UPDATE project_videos SET deleted_at=now() WHERE import_batch_id=$1", params: ["import-1"] },
    { sql: "UPDATE label_versions SET deleted_at=now(), status='archived' WHERE import_batch_id=$1", params: ["import-1"] },
    { sql: "UPDATE import_batches SET deleted_at=NULL, status='done' WHERE id=$1", params: ["import-1"] },
    { sql: "UPDATE project_images SET deleted_at=NULL WHERE import_batch_id=$1", params: ["import-1"] },
    { sql: "UPDATE project_videos SET deleted_at=NULL WHERE import_batch_id=$1", params: ["import-1"] },
    { sql: "UPDATE label_versions SET deleted_at=NULL, status='active' WHERE import_batch_id=$1", params: ["import-1"] },
  ]);
});

test("emptyImportTrash deletes only trashed imports selected for one project", async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT id FROM import_batches")) return { rows: [{ id: "import-1" }, { id: "import-2" }], rowCount: 2 };
    if (sql.startsWith("DELETE FROM label_versions")) return { rows: [{ id: "label-1" }], rowCount: 1 };
    if (sql.startsWith("DELETE FROM project_images")) return { rows: [{ id: "image-1" }], rowCount: 1 };
    if (sql.startsWith("DELETE FROM project_videos")) return { rows: [{ id: "video-1" }, { id: "video-2" }], rowCount: 2 };
    if (sql.startsWith("DELETE FROM import_batches")) return { rows: [{ id: "import-1" }, { id: "import-2" }], rowCount: 2 };
    if (sql.includes("DELETE FROM image_assets")) return { rows: [{ id: "asset-1", object_key: "images/one.jpg" }], rowCount: 1 };
    if (sql.includes("DELETE FROM video_assets")) return { rows: [{ id: "asset-2", object_key: "videos/one.mp4" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const { removedObjects, service } = createFixture(query);

  const result = await service.emptyImportTrash("project-1");

  assert.deepEqual(result, {
    imports: 2,
    project_images: 1,
    project_videos: 2,
    label_versions: 1,
    image_assets: 1,
    video_assets: 1,
  });
  assert.deepEqual(calls[0], {
    sql: "SELECT id FROM import_batches WHERE project_id=$1 AND deleted_at IS NOT NULL",
    params: ["project-1"],
  });
  const ids = ["import-1", "import-2"];
  assert.deepEqual(calls.slice(2, 6).map((call) => call.params), [[ids], [ids], [ids], [ids]]);
  assert.match(calls[1].sql, /WHERE lv\.project_id=\$1/);
  assert.match(calls[1].sql, /NOT \(lv\.import_batch_id = ANY\(\$2::uuid\[\]\)\)/);
  assert.match(calls[6].sql, /NOT EXISTS \(SELECT 1 FROM project_images pi WHERE pi\.image_asset_id=ia\.id\)/);
  assert.match(calls[6].sql, /NOT EXISTS \(SELECT 1 FROM extracted_frames ef WHERE ef\.image_asset_id=ia\.id\)/);
  assert.match(calls[7].sql, /NOT EXISTS \(SELECT 1 FROM project_videos pv WHERE pv\.video_asset_id=va\.id\)/);
  assert.deepEqual(removedObjects, ["images/one.jpg", "videos/one.mp4"]);
});

test("emptyProjectTrash scopes every delete to the trashed project id set", async () => {
  const calls = [];
  const counts = new Map([
    ["label_versions", 2],
    ["project_images", 3],
    ["project_videos", 4],
    ["import_batches", 5],
    ["projects", 2],
  ]);
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === "SELECT id FROM projects WHERE deleted_at IS NOT NULL") {
      return { rows: [{ id: "project-1" }, { id: "project-2" }], rowCount: 2 };
    }
    for (const [table, rowCount] of counts) {
      if (sql.startsWith(`DELETE FROM ${table}`)) return { rows: [], rowCount };
    }
    return { rows: [], rowCount: 0 };
  };
  const { service } = createFixture(query);

  const result = await service.emptyProjectTrash();

  assert.deepEqual(result, {
    projects: 2,
    imports: 5,
    project_images: 3,
    project_videos: 4,
    label_versions: 2,
    image_assets: 0,
    video_assets: 0,
  });
  const ids = ["project-1", "project-2"];
  assert.deepEqual(calls.slice(1, 7).map((call) => call.params), [[ids], [ids], [ids], [ids], [ids], [ids]]);
  for (const call of calls.slice(1, 7)) assert.match(call.sql, /ANY\(\$1::uuid\[\]\)/);
});

test("permanent project deletion includes only trashed descendants", async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT id FROM projects WHERE id=")) return { rows: [{ id: "project-1" }], rowCount: 1 };
    if (sql.includes("WITH RECURSIVE descendants")) return { rows: [{ id: "project-1" }, { id: "project-2" }], rowCount: 2 };
    return { rows: [], rowCount: 0 };
  };
  const { service } = createFixture(query);

  await service.deleteProjectPermanently("project-1");

  assert.equal(calls[0].sql, "SELECT id FROM projects WHERE id=$1 AND deleted_at IS NOT NULL");
  assert.match(calls[1].sql, /SELECT id FROM projects WHERE id=\$1 AND deleted_at IS NOT NULL/);
  assert.match(calls[1].sql, /WHERE p\.deleted_at IS NOT NULL/);
  const ids = ["project-1", "project-2"];
  assert.deepEqual(calls.slice(2, 8).map((call) => call.params), [[ids], [ids], [ids], [ids], [ids], [ids]]);
});
