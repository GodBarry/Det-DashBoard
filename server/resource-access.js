const VISIBILITIES = Object.freeze({
  PRIVATE: "private",
  PUBLIC: "public",
});

const RESOURCE_DEFINITIONS = Object.freeze({
  projects: Object.freeze({ resourceType: "project", ownerColumn: "owner_user_id", visibilityColumn: "visibility" }),
  model_clusters: Object.freeze({ resourceType: "model", ownerColumn: "owner_user_id", visibilityColumn: "visibility" }),
  runtime_envs: Object.freeze({ resourceType: "runtime_env", ownerColumn: "owner_user_id", visibilityColumn: "visibility" }),
  algorithm_assets: Object.freeze({ resourceType: "algorithm", ownerColumn: "owner_user_id", visibilityColumn: "visibility" }),
  training_templates: Object.freeze({ resourceType: "training_template", ownerColumn: "owner_user_id", visibilityColumn: "visibility" }),
  model_revisions: Object.freeze({ resourceType: "model_revision", ownerColumn: "created_by_user_id" }),
  dataset_snapshots: Object.freeze({ resourceType: "dataset_snapshot", ownerColumn: "created_by_user_id" }),
  import_batches: Object.freeze({ resourceType: "import_batch", ownerColumn: "created_by_user_id" }),
  label_versions: Object.freeze({ resourceType: "label_version", ownerColumn: "created_by_user_id" }),
  runtime_training_jobs: Object.freeze({ resourceType: "training_job", ownerColumn: "created_by_user_id" }),
  runtime_inference_jobs: Object.freeze({ resourceType: "inference_job", ownerColumn: "created_by_user_id" }),
  jobs: Object.freeze({ resourceType: "job", ownerColumn: "created_by_user_id" }),
});

const INDEPENDENT_TABLES = Object.freeze(
  Object.keys(RESOURCE_DEFINITIONS).filter((table) => RESOURCE_DEFINITIONS[table].visibilityColumn),
);
const CREATED_BY_TABLES = Object.freeze(
  Object.keys(RESOURCE_DEFINITIONS).filter((table) => RESOURCE_DEFINITIONS[table].ownerColumn === "created_by_user_id"),
);
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function defaultHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createResourceAccess(dependencies = {}) {
  const { query, transaction, httpError = defaultHttpError, accessControl = {} } = dependencies;
  if (typeof query !== "function") throw new TypeError("createResourceAccess requires query(text, params)");
  if (typeof transaction !== "function") throw new TypeError("createResourceAccess requires transaction(callback)");
  if (typeof httpError !== "function") throw new TypeError("httpError must be a function");

  const isAdmin = typeof accessControl.isAdmin === "function"
    ? (actor) => accessControl.isAdmin(actor)
    : (actor) => Boolean(actor && actor.role === "admin" && (!actor.status || actor.status === "active"));
  const permissions = accessControl.PERMISSIONS || {};

  function fail(statusCode, message) {
    throw httpError(statusCode, message);
  }

  function requireActor(actor) {
    if (!actor || !actor.id) fail(401, "authentication required");
    if (actor.status && actor.status !== "active") fail(403, "user account is not active");
    return actor;
  }

  function identifier(value, fieldName = "SQL identifier") {
    const text = String(value || "");
    if (!IDENTIFIER_PATTERN.test(text)) fail(400, `invalid ${fieldName}`);
    return `"${text}"`;
  }

  function definitionFor(table) {
    const key = String(table || "");
    const definition = RESOURCE_DEFINITIONS[key];
    if (!definition) fail(400, `unsupported resource table: ${key || "(empty)"}`);
    return { table: key, ...definition };
  }

  function actorId(actor) {
    return requireActor(actor).id;
  }

  async function getAdminId(executor = query) {
    const result = await executor(
      `SELECT id FROM app_users
       WHERE role='admin' AND status='active'
       ORDER BY (username='admin') DESC, created_at, id LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (!id) fail(500, "an active administrator is required to initialize resource ownership");
    return id;
  }

  async function initializeSchema() {
    await query(`CREATE TABLE IF NOT EXISTS resource_access_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await query("SELECT version FROM resource_access_schema_migrations WHERE version=1");

    await transaction(async (client) => {
      const adminId = await getAdminId(client.query.bind(client));
      for (const table of INDEPENDENT_TABLES) {
        const tableSql = identifier(table, "resource table");
        await client.query(`ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES app_users(id)`);
        await client.query(`ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`);
        await client.query(`UPDATE ${tableSql} SET owner_user_id=$1 WHERE owner_user_id IS NULL`, [adminId]);
        await client.query(`ALTER TABLE ${tableSql} ALTER COLUMN owner_user_id DROP NOT NULL`);
        await client.query(`ALTER TABLE ${tableSql} DROP CONSTRAINT IF EXISTS ${identifier(`${table}_visibility_check`, "constraint")}`);
        await client.query(`ALTER TABLE ${tableSql} ADD CONSTRAINT ${identifier(`${table}_visibility_check`, "constraint")} CHECK (visibility IN ('private','public'))`);
        await client.query(`CREATE INDEX IF NOT EXISTS ${identifier(`idx_${table}_owner`, "index")} ON ${tableSql}(owner_user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS ${identifier(`idx_${table}_visibility`, "index")} ON ${tableSql}(visibility)`);
      }

      for (const table of CREATED_BY_TABLES) {
        const tableSql = identifier(table, "resource table");
        await client.query(`ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES app_users(id)`);
        await client.query(`UPDATE ${tableSql} SET created_by_user_id=$1 WHERE created_by_user_id IS NULL`, [adminId]);
        await client.query(`ALTER TABLE ${tableSql} ALTER COLUMN created_by_user_id DROP NOT NULL`);
        await client.query(`CREATE INDEX IF NOT EXISTS ${identifier(`idx_${table}_created_by`, "index")} ON ${tableSql}(created_by_user_id)`);
      }

      await client.query("UPDATE algorithm_assets SET visibility='public' WHERE source_type='builtin' OR version='builtin'");
      await client.query("UPDATE runtime_envs SET visibility='public' WHERE source_type IN ('builtin','server_python')");
      // Existing templates are platform-provided; newly-created templates retain the private default.
      await client.query("UPDATE training_templates SET visibility='public' WHERE owner_user_id=$1", [adminId]);
      await client.query(
        "INSERT INTO resource_access_schema_migrations (version,name) VALUES (1,'resource ownership and visibility') ON CONFLICT (version) DO NOTHING",
      );
    });
    return { version: 1 };
  }

  async function hasAcl(actor, resourceType, resourceId, permission, allowPublic = false) {
    if (typeof accessControl.hasAssetPermission !== "function") return false;
    return Boolean(await accessControl.hasAssetPermission(actor, resourceType, resourceId, permission, { allowPublic }));
  }

  function canOwn(actor, row, ownerColumn) {
    return Boolean(actor && row && String(row[ownerColumn] || "") === String(actor.id));
  }

  async function loadRow(table, value, columns = "*") {
    if (value && typeof value === "object") return value;
    const tableSql = identifier(table, "resource table");
    const result = await query(`SELECT ${columns} FROM ${tableSql} WHERE id=$1`, [value]);
    return result.rows[0] || null;
  }

  async function assertIndependentAccess(table, value, actor, permission) {
    const definition = definitionFor(table);
    const row = await loadRow(table, value);
    if (!row) fail(404, `${definition.resourceType.replaceAll("_", " ")} not found`);
    if (isAdmin(actor)) return row;
    if (permission === "read" && row.visibility === VISIBILITIES.PUBLIC) return row;
    const currentActor = requireActor(actor);
    if (canOwn(currentActor, row, definition.ownerColumn)) return row;
    const aclPermission = permission === "read"
      ? (permissions.VIEW || "asset:view")
      : permission === "delete" ? (permissions.DELETE || "asset:delete") : (permissions.EDIT || "asset:edit");
    if (await hasAcl(currentActor, definition.resourceType, row.id, aclPermission, false)) return row;
    if (table === "model_revisions" && row.model_id) {
      await assertIndependentAccess("model_clusters", row.model_id, currentActor, permission);
      return row;
    }
    fail(403, `${permission} access denied for ${definition.resourceType.replaceAll("_", " ")}`);
  }

  const assertProjectRead = (actor, project) => assertIndependentAccess("projects", project, actor, "read");
  const assertProjectWrite = (actor, project) => assertIndependentAccess("projects", project, actor, "write");
  const assertProjectDelete = (actor, project) => assertIndependentAccess("projects", project, actor, "delete");

  async function assertRuntimeJobAccess(table, actor, value, permission) {
    const definition = definitionFor(table);
    const row = await loadRow(table, value);
    if (!row) fail(404, `${definition.resourceType.replaceAll("_", " ")} not found`);
    if (isAdmin(actor)) return row;
    const currentActor = requireActor(actor);
    if (canOwn(currentActor, row, definition.ownerColumn)) return row;
    const aclPermission = permission === "read" ? (permissions.VIEW || "asset:view") : (permissions.EDIT || "asset:edit");
    if (await hasAcl(currentActor, definition.resourceType, row.id, aclPermission, false)) return row;
    fail(403, `${permission} access denied for ${definition.resourceType.replaceAll("_", " ")}`);
  }

  const assertTrainingJobRead = (actor, job) => assertRuntimeJobAccess("runtime_training_jobs", actor, job, "read");
  const assertTrainingJobWrite = (actor, job) => assertRuntimeJobAccess("runtime_training_jobs", actor, job, "write");
  const assertInferenceJobRead = (actor, job) => assertRuntimeJobAccess("runtime_inference_jobs", actor, job, "read");
  const assertInferenceJobWrite = (actor, job) => assertRuntimeJobAccess("runtime_inference_jobs", actor, job, "write");

  function scopeSql(options = {}) {
    const definition = definitionFor(options.table || options.resourceTable || "projects");
    const actor = options.actor || options.user;
    const scope = String(options.scope || (isAdmin(actor) ? "all" : "mine")).toLowerCase();
    const alias = identifier(options.alias || "resource", "table alias");
    const params = Array.isArray(options.params) ? [...options.params] : [];
    const idColumn = identifier(options.idColumn || "id", "id column");
    const ownerColumn = identifier(options.ownerColumn || definition.ownerColumn, "owner column");
    const visibilityColumn = definition.visibilityColumn
      ? identifier(options.visibilityColumn || definition.visibilityColumn, "visibility column")
      : null;
    const column = (name) => `${alias}.${name}`;

    if (scope === "all") {
      if (!isAdmin(actor)) fail(403, "administrator permission required for all-resource scope");
      return { sql: "TRUE", params };
    }
    if (isAdmin(actor) && scope === "mine") {
      params.push(actor.id);
      return { sql: `${column(ownerColumn)}=$${params.length}`, params };
    }
    requireActor(actor);
    if (scope === "mine") {
      params.push(actor.id);
      return { sql: `${column(ownerColumn)}=$${params.length}`, params };
    }
    if (scope === "shared") {
      params.push(definition.resourceType, actor.id, [permissions.VIEW || "asset:view", permissions.USE || "asset:use", permissions.EDIT || "asset:edit", permissions.DELETE || "asset:delete", permissions.SHARE || "asset:share", permissions.MANAGE_ACL || "asset:manage_acl"]);
      const base = params.length - 2;
      return {
        sql: `EXISTS (SELECT 1 FROM asset_acl resource_acl WHERE resource_acl.resource_type=$${base} AND resource_acl.resource_id=${column(idColumn)} AND resource_acl.user_id=$${base + 1} AND resource_acl.permission=ANY($${base + 2}::text[]) AND (resource_acl.expires_at IS NULL OR resource_acl.expires_at>now()))`,
        params,
      };
    }
    if (scope === "public") {
      if (!visibilityColumn) fail(400, `${definition.resourceType} does not have independent visibility`);
      return { sql: `${column(visibilityColumn)}='public'`, params };
    }
    fail(400, `unknown resource scope: ${scope || "(empty)"}`);
  }

  function ownerFields(actor, visibility = VISIBILITIES.PRIVATE) {
    const id = actorId(actor);
    const normalizedVisibility = String(visibility || VISIBILITIES.PRIVATE).toLowerCase();
    if (!Object.values(VISIBILITIES).includes(normalizedVisibility)) fail(400, "visibility must be private or public");
    return { owner_user_id: id, visibility: normalizedVisibility };
  }

  function createdByFields(actor) {
    return { created_by_user_id: actorId(actor) };
  }

  async function assignOwner(table, resourceId, actor, options = {}) {
    const definition = definitionFor(table);
    const tableSql = identifier(table, "resource table");
    const params = [actorId(actor), resourceId];
    let assignment = `${identifier(definition.ownerColumn, "owner column")}=$1`;
    if (definition.visibilityColumn && options.visibility !== undefined) {
      const visibility = String(options.visibility).toLowerCase();
      if (!Object.values(VISIBILITIES).includes(visibility)) fail(400, "visibility must be private or public");
      params.push(visibility);
      assignment += `, ${identifier(definition.visibilityColumn, "visibility column")}=$3`;
    }
    const result = await query(`UPDATE ${tableSql} SET ${assignment} WHERE id=$2 RETURNING *`, params);
    if (!result.rows[0]) fail(404, `${definition.resourceType.replaceAll("_", " ")} not found`);
    if (typeof accessControl.ensureAssetOwner === "function" && definition.visibilityColumn) {
      await accessControl.ensureAssetOwner(actor, definition.resourceType, resourceId);
    }
    return result.rows[0];
  }

  return Object.freeze({
    VISIBILITIES,
    RESOURCE_DEFINITIONS,
    INDEPENDENT_TABLES,
    CREATED_BY_TABLES,
    getAdminId,
    initializeSchema,
    initialize: initializeSchema,
    assertProjectRead,
    assertProjectWrite,
    assertProjectDelete,
    assertIndependentAccess,
    assertTrainingJobRead,
    assertTrainingJobWrite,
    assertInferenceJobRead,
    assertInferenceJobWrite,
    scopeSql,
    buildListScope: scopeSql,
    buildScopeSql: scopeSql,
    ownerFields,
    assignOwnerFields: ownerFields,
    createdByFields,
    assignCreatedByFields: createdByFields,
    assignOwner,
    assignCreator: assignOwner,
    assignProjectOwner: (projectId, actor, options) => assignOwner("projects", projectId, actor, options),
    assignTrainingJobOwner: (jobId, actor) => assignOwner("runtime_training_jobs", jobId, actor),
    assignInferenceJobOwner: (jobId, actor) => assignOwner("runtime_inference_jobs", jobId, actor),
  });
}

module.exports = { createResourceAccess };
