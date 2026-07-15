"use strict";

const crypto = require("crypto");

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS dataset_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    source_label_version_id UUID REFERENCES label_versions(id) ON DELETE SET NULL,
    created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    UNIQUE (project_id, name)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dataset_versions_project ON dataset_versions(project_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS annotation_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_version_id UUID NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    review_required BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
  )`,
  "CREATE INDEX IF NOT EXISTS idx_annotation_tasks_version ON annotation_tasks(dataset_version_id, status, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS annotation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES annotation_tasks(id) ON DELETE CASCADE,
    project_image_id UUID NOT NULL REFERENCES project_images(id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    annotation_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    revision INT NOT NULL DEFAULT 0,
    submitted_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, project_image_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_annotation_items_task ON annotation_items(task_id, status, sort_order, created_at)",
  `CREATE TABLE IF NOT EXISTS annotation_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES annotation_tasks(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES annotation_items(id) ON DELETE CASCADE,
    assignee_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_annotation_assignments_user ON annotation_assignments(assignee_id, status, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS annotation_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES annotation_tasks(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES annotation_items(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES annotation_assignments(id) ON DELETE SET NULL,
    reviewer_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    decision TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_annotation_reviews_item ON annotation_reviews(item_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS annotation_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES annotation_tasks(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES annotation_items(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token UUID NOT NULL UNIQUE,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    renewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (item_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_annotation_locks_expiry ON annotation_locks(expires_at)",
];

function defaultHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createCollaborationService(options = {}) {
  const query = options.query;
  const transaction = options.transaction;
  const httpError = options.httpError || defaultHttpError;
  const checkPermission = options.checkPermission || options.authorize || null;
  const audit = options.audit || options.onAudit || null;
  const defaultLockTtlSeconds = positiveInteger(options.lockTtlSeconds, 300, 86400);

  if (typeof query !== "function") throw new TypeError("createCollaborationService requires a query function");
  if (typeof transaction !== "function") throw new TypeError("createCollaborationService requires a transaction function");
  if (typeof httpError !== "function") throw new TypeError("httpError must be a function");
  if (checkPermission && typeof checkPermission !== "function") throw new TypeError("checkPermission must be a function");
  if (audit && typeof audit !== "function") throw new TypeError("audit must be a function");

  const run = (client, text, params = []) => client && typeof client.query === "function"
    ? client.query(text, params)
    : query(text, params);

  async function authorize(action, actor, resource = {}) {
    const normalizedActor = actorRecord(actor);
    if (checkPermission) {
      const allowed = await checkPermission(action, { actor: normalizedActor, resource });
      if (allowed === false) throw httpError(403, "permission denied");
      return normalizedActor;
    }
    if (!normalizedActor.id) throw httpError(401, "authentication required");
    if (action === "review:create" && normalizedActor.role !== "admin") {
      throw httpError(403, "administrator permission required");
    }
    return normalizedActor;
  }

  async function emitAudit(action, actor, entityType, entityId, details = {}) {
    if (!audit) return;
    await audit({
      action,
      actor: actorRecord(actor),
      entityType,
      entityId,
      details,
      occurredAt: new Date().toISOString(),
    });
  }

  async function ensureSchema() {
    for (const statement of SCHEMA_STATEMENTS) await query(statement);
    return { initialized: true, tables: [
      "dataset_versions",
      "annotation_tasks",
      "annotation_items",
      "annotation_assignments",
      "annotation_reviews",
      "annotation_locks",
    ] };
  }

  async function createTask(input = {}, actor) {
    const body = objectInput(input);
    const currentActor = await authorize("task:create", actor || body.actor, { projectId: body.projectId || body.project_id });
    const projectId = required(body.projectId || body.project_id, "projectId", httpError);
    const name = requiredText(body.name, "name", httpError);
    const imageIds = uniqueValues(body.imageIds || body.image_ids || body.itemIds || body.item_ids);
    const datasetVersionId = body.datasetVersionId || body.dataset_version_id || null;

    const result = await transaction(async (client) => {
      const project = (await run(client,
        "SELECT id, active_label_version_id FROM projects WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [projectId],
      )).rows[0];
      if (!project) throw httpError(404, "project not found");

      let version;
      if (datasetVersionId) {
        version = (await run(client,
          "SELECT * FROM dataset_versions WHERE id=$1 AND project_id=$2 FOR UPDATE",
          [datasetVersionId, projectId],
        )).rows[0];
        if (!version) throw httpError(404, "dataset version not found");
      } else {
        const versionName = requiredText(
          body.datasetVersionName || body.dataset_version_name || `collaboration_${new Date().toISOString()}`,
          "datasetVersionName",
          httpError,
        );
        version = (await run(client,
          `INSERT INTO dataset_versions
           (project_id, name, status, source_label_version_id, created_by, metadata_json)
           VALUES ($1,$2,'draft',$3,$4,$5::jsonb) RETURNING *`,
          [projectId, versionName, project.active_label_version_id, currentActor.id, json(body.datasetVersionMetadata || body.dataset_version_metadata || {})],
        )).rows[0];
      }

      const task = (await run(client,
        `INSERT INTO annotation_tasks
         (dataset_version_id, name, description, status, review_required, created_by, due_at, metadata_json)
         VALUES ($1,$2,$3,'open',$4,$5,$6,$7::jsonb) RETURNING *`,
        [
          version.id,
          name,
          String(body.description || ""),
          body.reviewRequired ?? body.review_required ?? true,
          currentActor.id,
          body.dueAt || body.due_at || null,
          json(body.metadata || body.metadata_json || {}),
        ],
      )).rows[0];

      const itemParams = [task.id, projectId];
      let itemFilter = "";
      if (imageIds.length) {
        itemParams.push(imageIds);
        itemFilter = "AND pi.id = ANY($3::uuid[])";
      }
      const inserted = await run(client,
        `INSERT INTO annotation_items (task_id, project_image_id, sort_order)
         SELECT $1, pi.id, row_number() OVER (ORDER BY pi.created_at, pi.id)::int
         FROM project_images pi
         WHERE pi.project_id=$2 AND pi.deleted_at IS NULL ${itemFilter}
         ON CONFLICT (task_id, project_image_id) DO NOTHING
         RETURNING id, project_image_id`,
        itemParams,
      );
      if (!inserted.rows.length) throw httpError(400, "task must contain at least one project image");
      if (imageIds.length && inserted.rows.length !== imageIds.length) {
        throw httpError(400, "one or more imageIds do not belong to the project");
      }
      return { task: { ...task, item_count: inserted.rows.length }, datasetVersion: version };
    });

    await emitAudit("task.created", currentActor, "annotation_task", result.task.id, {
      projectId,
      datasetVersionId: result.datasetVersion.id,
      itemCount: result.task.item_count,
    });
    return result;
  }

  async function listTasks(filters = {}, actor) {
    const input = objectInput(filters);
    await authorize("task:list", actor || input.actor, input);
    const page = positiveInteger(input.page, 1, 1000000);
    const pageSize = positiveInteger(input.pageSize || input.page_size, 50, 200);
    const params = [];
    const where = [];
    addFilter(where, params, "dv.project_id", input.projectId || input.project_id);
    addFilter(where, params, "t.dataset_version_id", input.datasetVersionId || input.dataset_version_id);
    addFilter(where, params, "t.status", input.status);
    addFilter(where, params, "t.created_by", input.createdBy || input.created_by);
    if (input.assigneeId || input.assignee_id) {
      params.push(input.assigneeId || input.assignee_id);
      where.push(`EXISTS (SELECT 1 FROM annotation_assignments aa WHERE aa.task_id=t.id AND aa.assignee_id=$${params.length})`);
    }
    if (input.q) {
      params.push(`%${String(input.q).trim()}%`);
      where.push(`(t.name ILIKE $${params.length} OR t.description ILIKE $${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await query(
      `SELECT count(*)::int AS count FROM annotation_tasks t
       JOIN dataset_versions dv ON dv.id=t.dataset_version_id ${clause}`,
      params,
    );
    const rowParams = [...params, pageSize, (page - 1) * pageSize];
    const rows = await query(
      `SELECT t.*, dv.project_id, dv.name AS dataset_version_name,
        count(i.id)::int AS item_count,
        count(i.id) FILTER (WHERE i.status='pending')::int AS pending_count,
        count(i.id) FILTER (WHERE i.status='in_progress')::int AS in_progress_count,
        count(i.id) FILTER (WHERE i.status='submitted')::int AS submitted_count,
        count(i.id) FILTER (WHERE i.status='approved')::int AS approved_count,
        count(i.id) FILTER (WHERE i.status='rejected')::int AS rejected_count
       FROM annotation_tasks t
       JOIN dataset_versions dv ON dv.id=t.dataset_version_id
       LEFT JOIN annotation_items i ON i.task_id=t.id
       ${clause}
       GROUP BY t.id, dv.project_id, dv.name
       ORDER BY t.created_at DESC
       LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams,
    );
    return { page, pageSize, total: count.rows[0]?.count || 0, items: rows.rows };
  }

  async function listTaskItems(taskIdOrInput, filters = {}, actor) {
    const base = typeof taskIdOrInput === "object" ? objectInput(taskIdOrInput) : { taskId: taskIdOrInput };
    const input = { ...base, ...(typeof filters === "object" ? filters : {}) };
    const taskId = required(input.taskId || input.task_id, "taskId", httpError);
    await authorize("item:list", actor || input.actor, { taskId });
    const page = positiveInteger(input.page, 1, 1000000);
    const pageSize = positiveInteger(input.pageSize || input.page_size, 100, 500);
    const params = [taskId];
    const where = ["i.task_id=$1"];
    addFilter(where, params, "i.status", input.status);
    addFilter(where, params, "a.assignee_id", input.assigneeId || input.assignee_id);
    const count = await query(
      `SELECT count(DISTINCT i.id)::int AS count
       FROM annotation_items i LEFT JOIN annotation_assignments a ON a.item_id=i.id
       WHERE ${where.join(" AND ")}`,
      params,
    );
    const rowParams = [...params, pageSize, (page - 1) * pageSize];
    const rows = await query(
      `SELECT i.*, pi.display_name, pi.source_path, pi.image_asset_id,
        a.id AS assignment_id, a.assignee_id, a.status AS assignment_status,
        l.id AS lock_id, l.owner_id AS lock_owner_id, l.expires_at AS lock_expires_at,
        r.decision AS latest_review_decision, r.comment AS latest_review_comment
       FROM annotation_items i
       JOIN project_images pi ON pi.id=i.project_image_id
       LEFT JOIN annotation_assignments a ON a.item_id=i.id
       LEFT JOIN annotation_locks l ON l.item_id=i.id AND l.expires_at>now()
       LEFT JOIN LATERAL (
         SELECT decision, comment FROM annotation_reviews ar
         WHERE ar.item_id=i.id ORDER BY ar.created_at DESC LIMIT 1
       ) r ON true
       WHERE ${where.join(" AND ")}
       ORDER BY i.sort_order, i.created_at
       LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams,
    );
    return { page, pageSize, total: count.rows[0]?.count || 0, items: rows.rows };
  }

  async function cleanupExpiredLocks(client) {
    await run(client,
      `UPDATE annotation_assignments a SET status='released', released_at=now(), updated_at=now()
       FROM annotation_locks l
       WHERE l.item_id=a.item_id AND l.owner_id=a.assignee_id AND l.expires_at<=now() AND a.status='active'`,
    );
    await run(client, "DELETE FROM annotation_locks WHERE expires_at<=now()");
  }

  async function claimTask(taskIdOrInput, actor, optionsArg = {}) {
    const input = typeof taskIdOrInput === "object"
      ? objectInput(taskIdOrInput)
      : { taskId: taskIdOrInput, ...objectInput(optionsArg) };
    const taskId = required(input.taskId || input.task_id, "taskId", httpError);
    const currentActor = await authorize("item:claim", actor || input.actor, { taskId });
    const ttl = positiveInteger(input.ttlSeconds || input.ttl_seconds, defaultLockTtlSeconds, 86400);
    const result = await transaction(async (client) => {
      await cleanupExpiredLocks(client);
      const task = (await run(client,
        "SELECT * FROM annotation_tasks WHERE id=$1 FOR UPDATE",
        [taskId],
      )).rows[0];
      if (!task) throw httpError(404, "annotation task not found");
      if (["completed", "cancelled"].includes(task.status)) throw httpError(409, "annotation task is not claimable");

      const item = (await run(client,
        `SELECT i.* FROM annotation_items i
         LEFT JOIN annotation_assignments a ON a.item_id=i.id
         LEFT JOIN annotation_locks l ON l.item_id=i.id AND l.expires_at>now()
         WHERE i.task_id=$1
           AND i.status IN ('pending','rejected','in_progress')
           AND (a.id IS NULL OR a.assignee_id=$2 OR a.status='released')
           AND (l.id IS NULL OR l.owner_id=$2)
         ORDER BY CASE WHEN a.assignee_id=$2 THEN 0 ELSE 1 END, i.sort_order, i.created_at
         FOR UPDATE OF i SKIP LOCKED LIMIT 1`,
        [taskId, currentActor.id],
      )).rows[0];
      if (!item) throw httpError(409, "no claimable annotation item is available");
      return assignAndLock(client, task, item, currentActor.id, ttl);
    });
    await emitAudit("item.claimed", currentActor, "annotation_item", result.item.id, { taskId, lockId: result.lock.id });
    return result;
  }

  async function acquireLock(itemIdOrInput, actor, optionsArg = {}) {
    const input = typeof itemIdOrInput === "object"
      ? objectInput(itemIdOrInput)
      : { itemId: itemIdOrInput, ...objectInput(optionsArg) };
    const itemId = required(input.itemId || input.item_id, "itemId", httpError);
    const currentActor = await authorize("lock:acquire", actor || input.actor, { itemId });
    const ttl = positiveInteger(input.ttlSeconds || input.ttl_seconds, defaultLockTtlSeconds, 86400);
    const result = await transaction(async (client) => {
      await cleanupExpiredLocks(client);
      const item = (await run(client,
        `SELECT i.*, t.status AS task_status, t.dataset_version_id
         FROM annotation_items i JOIN annotation_tasks t ON t.id=i.task_id
         WHERE i.id=$1 FOR UPDATE OF i`,
        [itemId],
      )).rows[0];
      if (!item) throw httpError(404, "annotation item not found");
      if (["completed", "cancelled"].includes(item.task_status) || item.status === "approved") {
        throw httpError(409, "annotation item cannot be locked");
      }
      const assignment = (await run(client,
        "SELECT * FROM annotation_assignments WHERE item_id=$1 FOR UPDATE",
        [item.id],
      )).rows[0];
      if (assignment && assignment.assignee_id !== currentActor.id && assignment.status !== "released") {
        throw httpError(409, "annotation item is assigned to another user");
      }
      const activeLock = (await run(client,
        "SELECT * FROM annotation_locks WHERE item_id=$1 FOR UPDATE",
        [item.id],
      )).rows[0];
      if (activeLock && activeLock.owner_id !== currentActor.id) throw httpError(423, "annotation item is locked by another user");
      const task = { id: item.task_id, dataset_version_id: item.dataset_version_id };
      return assignAndLock(client, task, item, currentActor.id, ttl, activeLock?.token);
    });
    await emitAudit("lock.acquired", currentActor, "annotation_item", itemId, { lockId: result.lock.id });
    return result;
  }

  async function assignAndLock(client, task, item, actorId, ttl, existingToken) {
    const assignment = (await run(client,
      `INSERT INTO annotation_assignments (task_id, item_id, assignee_id, status, claimed_at, released_at, updated_at)
       VALUES ($1,$2,$3,'active',now(),NULL,now())
       ON CONFLICT (item_id) DO UPDATE SET
         task_id=EXCLUDED.task_id, assignee_id=EXCLUDED.assignee_id, status='active',
         claimed_at=now(), released_at=NULL, updated_at=now()
       RETURNING *`,
      [task.id, item.id, actorId],
    )).rows[0];
    const token = existingToken || crypto.randomUUID();
    const lock = (await run(client,
      `INSERT INTO annotation_locks (task_id, item_id, owner_id, token, expires_at)
       VALUES ($1,$2,$3,$4,now() + $5::int * interval '1 second')
       ON CONFLICT (item_id) DO UPDATE SET
         owner_id=EXCLUDED.owner_id, token=EXCLUDED.token, renewed_at=now(), expires_at=EXCLUDED.expires_at
       RETURNING *`,
      [task.id, item.id, actorId, token, ttl],
    )).rows[0];
    const updatedItem = (await run(client,
      "UPDATE annotation_items SET status='in_progress', updated_at=now() WHERE id=$1 RETURNING *",
      [item.id],
    )).rows[0];
    await run(client, "UPDATE annotation_tasks SET status='active', updated_at=now() WHERE id=$1 AND status='open'", [task.id]);
    return { taskId: task.id, datasetVersionId: task.dataset_version_id, item: updatedItem, assignment, lock };
  }

  async function renewLock(tokenOrInput, actor, optionsArg = {}) {
    const input = typeof tokenOrInput === "object"
      ? objectInput(tokenOrInput)
      : { lockToken: tokenOrInput, ...objectInput(optionsArg) };
    const token = required(input.lockToken || input.lock_token || input.token, "lockToken", httpError);
    const currentActor = await authorize("lock:renew", actor || input.actor, { lockToken: token });
    const ttl = positiveInteger(input.ttlSeconds || input.ttl_seconds, defaultLockTtlSeconds, 86400);
    const result = await query(
      `UPDATE annotation_locks SET renewed_at=now(), expires_at=now() + $3::int * interval '1 second'
       WHERE token=$1 AND owner_id=$2 AND expires_at>now() RETURNING *`,
      [token, currentActor.id, ttl],
    );
    const lock = result.rows[0];
    if (!lock) throw httpError(409, "annotation lock is missing, expired, or owned by another user");
    await emitAudit("lock.renewed", currentActor, "annotation_item", lock.item_id, { lockId: lock.id, expiresAt: lock.expires_at });
    return { lock };
  }

  async function releaseLock(tokenOrInput, actor) {
    const input = typeof tokenOrInput === "object" ? objectInput(tokenOrInput) : { lockToken: tokenOrInput };
    const token = required(input.lockToken || input.lock_token || input.token, "lockToken", httpError);
    const currentActor = await authorize("lock:release", actor || input.actor, { lockToken: token });
    const result = await transaction(async (client) => {
      const lock = (await run(client,
        "DELETE FROM annotation_locks WHERE token=$1 AND owner_id=$2 RETURNING *",
        [token, currentActor.id],
      )).rows[0];
      if (!lock) throw httpError(404, "annotation lock not found");
      await run(client,
        `UPDATE annotation_assignments SET status='released', released_at=now(), updated_at=now()
         WHERE item_id=$1 AND assignee_id=$2 AND status='active'`,
        [lock.item_id, currentActor.id],
      );
      const item = (await run(client,
        `UPDATE annotation_items SET status='pending', updated_at=now()
         WHERE id=$1 AND status='in_progress' AND submitted_at IS NULL RETURNING *`,
        [lock.item_id],
      )).rows[0] || null;
      return { released: true, lock, item };
    });
    await emitAudit("lock.released", currentActor, "annotation_item", result.lock.item_id, { lockId: result.lock.id });
    return result;
  }

  async function saveSubmission(itemIdOrInput, actor, optionsArg = {}) {
    const input = typeof itemIdOrInput === "object"
      ? objectInput(itemIdOrInput)
      : { itemId: itemIdOrInput, ...objectInput(optionsArg) };
    const itemId = required(input.itemId || input.item_id, "itemId", httpError);
    const token = required(input.lockToken || input.lock_token || input.token, "lockToken", httpError);
    const submission = input.submission ?? input.annotations ?? input.annotation_json;
    if (submission === undefined) throw httpError(400, "submission is required");
    const currentActor = await authorize("submission:save", actor || input.actor, { itemId });
    const result = await transaction(async (client) => {
      const lock = (await run(client,
        `SELECT l.*, i.task_id, i.status AS item_status, t.review_required
         FROM annotation_locks l
         JOIN annotation_items i ON i.id=l.item_id
         JOIN annotation_tasks t ON t.id=i.task_id
         WHERE l.item_id=$1 AND l.token=$2 AND l.owner_id=$3 FOR UPDATE OF l, i`,
        [itemId, token, currentActor.id],
      )).rows[0];
      if (!lock || new Date(lock.expires_at).getTime() <= Date.now()) throw httpError(409, "a valid annotation lock is required");
      if (lock.item_status === "approved") throw httpError(409, "approved annotation cannot be changed");
      const submittedStatus = lock.review_required ? "submitted" : "approved";
      const item = (await run(client,
        `UPDATE annotation_items SET annotation_json=$1::jsonb, metadata_json=$2::jsonb,
           status=$3, revision=revision+1, submitted_by=$4, submitted_at=now(), updated_at=now()
         WHERE id=$5 RETURNING *`,
        [json(submission), json(input.metadata || input.metadata_json || {}), submittedStatus, currentActor.id, itemId],
      )).rows[0];
      const assignment = (await run(client,
        `UPDATE annotation_assignments SET status='submitted', submitted_at=now(), updated_at=now()
         WHERE item_id=$1 AND assignee_id=$2 RETURNING *`,
        [itemId, currentActor.id],
      )).rows[0];
      if (!assignment) throw httpError(409, "annotation assignment not found");
      await run(client, "DELETE FROM annotation_locks WHERE id=$1", [lock.id]);
      const task = await refreshTaskStatus(client, lock.task_id);
      return { item, assignment, task };
    });
    await emitAudit("submission.saved", currentActor, "annotation_item", itemId, {
      taskId: result.item.task_id,
      revision: result.item.revision,
    });
    return result;
  }

  async function reviewSubmission(itemIdOrInput, actor, optionsArg = {}) {
    const input = typeof itemIdOrInput === "object"
      ? objectInput(itemIdOrInput)
      : { itemId: itemIdOrInput, ...objectInput(optionsArg) };
    const itemId = required(input.itemId || input.item_id, "itemId", httpError);
    const currentActor = await authorize("review:create", actor || input.actor, { itemId });
    const rawDecision = requiredText(input.decision || input.verdict || input.status, "decision", httpError).toLowerCase();
    const decision = rawDecision === "approve" ? "approved" : rawDecision === "reject" ? "rejected" : rawDecision;
    if (!["approved", "rejected"].includes(decision)) throw httpError(400, "decision must be approved or rejected");

    const result = await transaction(async (client) => {
      const item = (await run(client,
        "SELECT * FROM annotation_items WHERE id=$1 FOR UPDATE",
        [itemId],
      )).rows[0];
      if (!item) throw httpError(404, "annotation item not found");
      if (item.status !== "submitted") throw httpError(409, "only submitted annotations can be reviewed");
      const assignment = (await run(client,
        "SELECT * FROM annotation_assignments WHERE item_id=$1 FOR UPDATE",
        [itemId],
      )).rows[0];
      const review = (await run(client,
        `INSERT INTO annotation_reviews
         (task_id, item_id, assignment_id, reviewer_id, decision, comment, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
        [item.task_id, item.id, assignment?.id || null, currentActor.id, decision, String(input.comment || ""), json(input.metadata || input.metadata_json || {})],
      )).rows[0];
      const updatedItem = (await run(client,
        "UPDATE annotation_items SET status=$1, updated_at=now() WHERE id=$2 RETURNING *",
        [decision, item.id],
      )).rows[0];
      if (assignment) {
        await run(client,
          "UPDATE annotation_assignments SET status='reviewed', updated_at=now() WHERE id=$1",
          [assignment.id],
        );
      }
      const task = await refreshTaskStatus(client, item.task_id);
      return { review, item: updatedItem, task };
    });
    await emitAudit("review.created", currentActor, "annotation_item", itemId, {
      taskId: result.item.task_id,
      reviewId: result.review.id,
      decision,
    });
    return result;
  }

  async function refreshTaskStatus(client, taskId) {
    const counts = (await run(client,
      `SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status='approved')::int AS approved,
        count(*) FILTER (WHERE status IN ('submitted','approved'))::int AS awaiting_review,
        count(*) FILTER (WHERE status='rejected')::int AS rejected
       FROM annotation_items WHERE task_id=$1`,
      [taskId],
    )).rows[0];
    let status = "active";
    if (counts.total > 0 && counts.approved === counts.total) status = "completed";
    else if (counts.total > 0 && counts.awaiting_review === counts.total) status = "review";
    const task = (await run(client,
      `UPDATE annotation_tasks SET status=$1, updated_at=now(),
         completed_at=CASE WHEN $1='completed' THEN now() ELSE NULL END
       WHERE id=$2 RETURNING *`,
      [status, taskId],
    )).rows[0];
    if (status === "completed") {
      await run(client,
        `UPDATE dataset_versions SET status='ready', updated_at=now()
         WHERE id=$1 AND status='draft'
           AND NOT EXISTS (
             SELECT 1 FROM annotation_tasks pending
             WHERE pending.dataset_version_id=$1 AND pending.status<>'completed'
           )`,
        [task.dataset_version_id],
      );
    }
    return { ...task, counts };
  }

  return {
    ensureSchema,
    initSchema: ensureSchema,
    initializeSchema: ensureSchema,
    createTask,
    listTasks,
    listTaskItems,
    listItems: listTaskItems,
    claimTask,
    claimItem: claimTask,
    claimNextItem: claimTask,
    acquireLock,
    acquireItemLock: acquireLock,
    lockItem: acquireLock,
    renewLock,
    renewItemLock: renewLock,
    releaseLock,
    releaseItemLock: releaseLock,
    saveSubmission,
    saveAndSubmit: saveSubmission,
    submitItem: saveSubmission,
    reviewSubmission,
    adminReview: reviewSubmission,
    reviewItem: reviewSubmission,
  };
}

function objectInput(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function actorRecord(actor) {
  if (typeof actor === "string") return { id: actor };
  const value = objectInput(actor);
  return {
    ...value,
    id: value.id || value.userId || value.user_id || null,
    role: value.role || "",
  };
}

function required(value, name, httpError) {
  if (value === undefined || value === null || value === "") throw httpError(400, `${name} is required`);
  return value;
}

function requiredText(value, name, httpError) {
  const text = String(value || "").trim();
  if (!text) throw httpError(400, `${name} is required`);
  return text;
}

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(maximum, Math.floor(number));
}

function uniqueValues(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
}

function json(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function addFilter(where, params, column, value) {
  if (value === undefined || value === null || value === "") return;
  params.push(value);
  where.push(`${column}=$${params.length}`);
}

module.exports = { createCollaborationService };
