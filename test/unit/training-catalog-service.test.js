const test = require("node:test");
const assert = require("node:assert/strict");

const { createTrainingCatalogService } = require("../../server/runtime-jobs/training-catalog-service");

function createFixture(overrides = {}) {
  const calls = {
    queries: [],
    scopes: [],
    owners: [],
    fallbacks: 0,
  };
  const query = overrides.query || (async (sql, params) => {
    calls.queries.push({ sql, params });
    return { rows: overrides.rows || [] };
  });
  const scopedSql = overrides.scopedSql || ((table, alias, actor, scope) => {
    calls.scopes.push({ table, alias, actor, scope });
    return { sql: `${alias}.owner_user_id=$1`, params: [actor.id] };
  });
  const algorithmAssetService = {
    getBuiltinTrainingTemplateFallbacks() {
      calls.fallbacks += 1;
      return overrides.fallbacks || [{ id: "builtin-template" }];
    },
  };
  const resourceAccess = {
    async assignOwner(...args) {
      calls.owners.push(args);
      return overrides.ownerResult || { ...args[4], id: args[1] };
    },
  };
  const service = createTrainingCatalogService({
    query,
    scopedSql,
    algorithmAssetService,
    resourceAccess,
  });
  return { calls, service };
}

test("listDatasetSnapshots preserves scope, SQL, parameters, and rows", async () => {
  const actor = { id: "user-1" };
  const rows = [{ id: "snapshot-1", source_project_name: "Dataset" }];
  const { calls, service } = createFixture({ rows });

  assert.equal(await service.listDatasetSnapshots(actor, "shared"), rows);
  assert.deepEqual(calls.scopes, [{
    table: "dataset_snapshots",
    alias: "ds",
    actor,
    scope: "shared",
  }]);
  assert.deepEqual(calls.queries, [{
    sql: `SELECT ds.*, p.name AS source_project_name
       FROM dataset_snapshots ds
       LEFT JOIN projects p ON p.id=ds.source_project_id
       WHERE ds.owner_user_id=$1
       ORDER BY ds.created_at DESC
       LIMIT 200`,
    params: [actor.id],
  }]);
});

test("listTrainingTemplates preserves SQL and defaults scope to mine", async () => {
  const actor = { id: "user-2" };
  const rows = [{ id: "template-1" }];
  const { calls, service } = createFixture({ rows });

  assert.equal(await service.listTrainingTemplates(actor), rows);
  assert.deepEqual(calls.scopes, [{
    table: "training_templates",
    alias: "t",
    actor,
    scope: "mine",
  }]);
  assert.deepEqual(calls.queries, [{
    sql: "SELECT t.* FROM training_templates t WHERE t.owner_user_id=$1 ORDER BY created_at DESC",
    params: [actor.id],
  }]);
  assert.equal(calls.fallbacks, 0);
});

test("listTrainingTemplates falls back only for PostgreSQL 42P01", async () => {
  const missingTable = Object.assign(new Error("missing relation"), { code: "42P01" });
  const fallbackRows = [{ id: "builtin-1" }];
  const fallbackFixture = createFixture({
    query: async () => { throw missingTable; },
    fallbacks: fallbackRows,
  });

  assert.equal(await fallbackFixture.service.listTrainingTemplates({ id: "user-3" }), fallbackRows);
  assert.equal(fallbackFixture.calls.fallbacks, 1);

  const databaseError = Object.assign(new Error("database unavailable"), { code: "08006" });
  const fatalFixture = createFixture({ query: async () => { throw databaseError; } });
  await assert.rejects(() => fatalFixture.service.listTrainingTemplates({ id: "user-3" }), databaseError);
  assert.equal(fatalFixture.calls.fallbacks, 0);
});

test("templateCapabilities preserves explicit tasks and filters unsupported tasks", () => {
  const { service } = createFixture();
  const capabilities = {
    tasks: ["detect", "pose", "segment", "classify"],
    gpu: true,
  };

  assert.deepEqual(service.templateCapabilities({ capabilities }), {
    tasks: ["detect", "segment", "classify"],
    gpu: true,
  });
  assert.deepEqual(service.templateCapabilities({ capabilities_json: { tasks: ["pose"] } }), { tasks: [] });
});

test("templateCapabilities preserves automatic and task-specific defaults", () => {
  const { service } = createFixture();

  assert.deepEqual(service.templateCapabilities({ framework: "Ultralytics" }), {
    tasks: ["detect", "segment", "classify"],
    autoDetected: true,
  });
  assert.deepEqual(service.templateCapabilities({ template_key: "custom-yolo-adapter" }), {
    tasks: ["detect", "segment", "classify"],
    autoDetected: true,
  });
  assert.deepEqual(service.templateCapabilities({ task_type: "segment" }), {
    tasks: ["segment"],
    autoDetected: false,
  });
  assert.deepEqual(service.templateCapabilities(), {
    tasks: ["detect"],
    autoDetected: false,
  });
});

test("createTrainingTemplate preserves validation, serialization, SQL, ownership, and return value", async () => {
  const actor = { id: "user-4" };
  const ownerResult = { id: "template-9", owner_user_id: actor.id };
  const { calls, service } = createFixture({
    rows: [{ id: "template-9" }],
    ownerResult,
  });
  const body = {
    name: "  Custom trainer  ",
    template_key: "custom_trainer",
    framework: "custom",
    task_type: "segment",
    command_json: { executable: "train.py" },
    default_params_json: { epochs: 20 },
    capabilities_json: { tasks: ["segment", "pose"], gpu: true },
    description: "Custom training adapter",
    visibility: "shared",
  };

  assert.equal(await service.createTrainingTemplate(body, actor), ownerResult);
  assert.deepEqual(calls.queries, [{
    sql: `INSERT INTO training_templates (name, template_key, framework, task_type, command_json, default_params_json, capabilities_json, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    params: [
      "Custom trainer",
      "custom_trainer",
      "custom",
      "segment",
      JSON.stringify({ executable: "train.py" }),
      JSON.stringify({ epochs: 20 }),
      JSON.stringify({ tasks: ["segment"], gpu: true }),
      "Custom training adapter",
    ],
  }]);
  assert.deepEqual(calls.owners, [["training_templates", "template-9", actor, { visibility: "shared" }]]);

  await assert.rejects(() => service.createTrainingTemplate({ name: "   " }, actor), {
    message: "模板名称不能为空",
  });
});

test("createTrainingTemplate preserves default values", async () => {
  const actor = { id: "user-5" };
  const { calls, service } = createFixture({ rows: [{ id: "template-default" }] });

  await service.createTrainingTemplate({ name: "Default template" }, actor);

  assert.deepEqual(calls.queries[0].params, [
    "Default template",
    "ultralytics_yolo",
    "ultralytics",
    "detect",
    "{}",
    "{}",
    JSON.stringify({ tasks: ["detect"], autoDetected: false }),
    "",
  ]);
  assert.deepEqual(calls.owners, [["training_templates", "template-default", actor, { visibility: "private" }]]);
});
