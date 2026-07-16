const test = require("node:test");
const assert = require("node:assert/strict");

const { createProjectService } = require("../../server/dataset/project-service");

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createFixture(query) {
  const accessCalls = [];
  const resourceAccess = {
    scopeSql(input) {
      accessCalls.push({ method: "scopeSql", input });
      return { sql: "p.owner_user_id=$1", params: [input.actor.id] };
    },
    async assertProjectWrite(actor, project) {
      accessCalls.push({ method: "assertProjectWrite", actor, project });
    },
    async assignOwner(table, id, actor, options) {
      accessCalls.push({ method: "assignOwner", table, id, actor, options });
      return { id, visibility: options.visibility, owner_user_id: actor.id };
    },
  };
  const service = createProjectService({
    query,
    transaction: async (callback) => callback({ query }),
    httpError,
    resourceAccess,
  });
  return { accessCalls, service };
}

test("createProject preserves parent and reused-folder write checks", async () => {
  const actor = { id: "user-1" };
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes("WITH RECURSIVE ancestors")) return { rows: [{ depth: 1 }] };
    if (sql.startsWith("SELECT * FROM projects WHERE deleted_at")) {
      return { rows: [{ id: "folder-1", name: "existing", parent_id: "parent-1" }] };
    }
    if (sql.startsWith("INSERT INTO projects")) return { rows: [{ id: "leaf-1", visibility: "public" }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const { accessCalls, service } = createFixture(query);

  const project = await service.createProject({
    name: "existing/leaf",
    parentId: "parent-1",
    description: "dataset",
    project_type: "normal",
    visibility: "public",
  }, actor);

  assert.deepEqual(project, { id: "leaf-1", visibility: "public", owner_user_id: "user-1" });
  assert.deepEqual(accessCalls, [
    { method: "assertProjectWrite", actor, project: "parent-1" },
    { method: "assertProjectWrite", actor, project: { id: "folder-1", name: "existing", parent_id: "parent-1" } },
    { method: "assignOwner", table: "projects", id: "leaf-1", actor, options: { visibility: "public" } },
  ]);
  assert.deepEqual(queries.at(-1).params, ["leaf", "dataset", "normal", "folder-1", "user-1", "public"]);
});

test("renameProject preserves sibling duplicate lookup and update contract", async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT * FROM projects WHERE id=")) return { rows: [{ id: "project-1", parent_id: "parent-1" }] };
    if (sql.startsWith("SELECT id FROM projects WHERE deleted_at")) return { rows: [] };
    if (sql.startsWith("UPDATE projects SET name=")) return { rows: [{ id: "project-1", name: "renamed" }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const { service } = createFixture(query);

  const project = await service.renameProject("project-1", { name: " renamed " });

  assert.deepEqual(project, { id: "project-1", name: "renamed" });
  assert.deepEqual(calls.map((call) => call.params), [
    ["project-1"],
    ["project-1", "renamed", "parent-1"],
    ["renamed", "project-1"],
  ]);
  assert.match(calls[1].sql, /parent_id IS NOT DISTINCT FROM \$3/);
});

test("listProjects preserves scope and active-or-latest label version SQL", async () => {
  const actor = { id: "user-2" };
  let queryCall;
  const query = async (sql, params) => {
    queryCall = { sql, params };
    return { rows: [{ id: "project-2" }] };
  };
  const { accessCalls, service } = createFixture(query);

  const projects = await service.listProjects(false, actor, "shared");

  assert.deepEqual(projects, [{ id: "project-2" }]);
  assert.deepEqual(accessCalls, [{
    method: "scopeSql",
    input: { table: "projects", alias: "p", actor, scope: "shared", params: [] },
  }]);
  assert.deepEqual(queryCall.params, ["user-2"]);
  assert.match(queryCall.sql, /p\.deleted_at IS NULL AND p\.owner_user_id=\$1/);
  assert.equal((queryCall.sql.match(/EXISTS \(SELECT 1 FROM image_annotations a WHERE a\.label_version_id=lv\.id\)/g) || []).length, 2);
  assert.match(queryCall.sql, /COALESCE\(p\.active_label_version_id/);
  assert.match(queryCall.sql, /COALESCE\(c\.active_label_version_id/);
  assert.match(queryCall.sql, /a\.label_version_id=COALESCE\(p\.active_label_version_id/);
});

test("projectSummary preserves recursive label fallback and result shape", async () => {
  const expected = { image_count: 7, annotation_count: 11, labels: ["car"] };
  let queryCall;
  const query = async (sql, params) => {
    queryCall = { sql, params };
    return { rows: [expected] };
  };
  const { service } = createFixture(query);

  const summary = await service.projectSummary("project-3");

  assert.equal(summary, expected);
  assert.deepEqual(queryCall.params, ["project-3"]);
  assert.equal((queryCall.sql.match(/EXISTS \(SELECT 1 FROM image_annotations a WHERE a\.label_version_id=lv\.id\)/g) || []).length, 2);
  assert.match(queryCall.sql, /COALESCE\(active_label_version_id/);
  assert.match(queryCall.sql, /COALESCE\(p\.active_label_version_id/);
  assert.match(queryCall.sql, /s\.effective_label_version_id=a\.label_version_id/);
});
