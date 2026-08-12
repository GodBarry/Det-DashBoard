function createRuntimeQueueService({ query, transaction, accessControl }) {
  async function updatePriorities(client, tableName, rows) {
    if (!rows.length) return;
    await client.query(
      `UPDATE ${tableName} AS jobs
       SET priority=updates.priority
       FROM unnest($1::uuid[], $2::int[]) AS updates(id, priority)
       WHERE jobs.id=updates.id`,
      [rows.map((row) => row.id), rows.map((row) => row.priority)],
    );
  }

  async function moveRuntimeJobPriority(tableName, jobId, direction, actor) {
    const allowedTables = new Set(["runtime_training_jobs", "runtime_inference_jobs"]);
    if (!allowedTables.has(tableName)) throw new Error("unsupported queue type");
    if (!["up", "down"].includes(direction)) throw new Error("direction must be up or down");
    return transaction(async (client) => {
      const ownerFilter = accessControl.isAdmin(actor)
        ? { sql: "", params: [] }
        : { sql: "WHERE created_by_user_id=$1", params: [actor.id] };
      const rows = (await client.query(
        `SELECT id, COALESCE(priority, 0)::int AS priority, created_at
         FROM ${tableName}
         ${ownerFilter.sql}
         ORDER BY COALESCE(priority, 0) DESC, created_at DESC, id DESC
         LIMIT 200`,
        ownerFilter.params,
      )).rows;
      const index = rows.findIndex((row) => String(row.id) === String(jobId));
      if (index < 0) throw new Error("job not found");
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= rows.length) return rows[index];

      const normalized = rows.map((row, rowIndex) => ({ ...row, priority: rows.length - rowIndex }));
      const current = normalized[index];
      const target = normalized[targetIndex];
      [current.priority, target.priority] = [target.priority, current.priority];
      await updatePriorities(client, tableName, normalized);
      return (await client.query(`SELECT * FROM ${tableName} WHERE id=$1`, [jobId])).rows[0];
    });
  }

  async function reorderRuntimeJobs(tableName, orderedIds, actor) {
    const allowedTables = new Set(["runtime_training_jobs", "runtime_inference_jobs"]);
    if (!allowedTables.has(tableName)) throw new Error("unsupported queue type");
    const ids = [...new Set((Array.isArray(orderedIds) ? orderedIds : []).map(String).filter(Boolean))];
    if (!ids.length) throw new Error("orderedIds is required");
    return transaction(async (client) => {
      const isAdmin = accessControl.isAdmin(actor);
      const accessible = (await client.query(
        `SELECT id FROM ${tableName}
         WHERE id = ANY($1::uuid[])${isAdmin ? "" : " AND created_by_user_id=$2"}`,
        isAdmin ? [ids] : [ids, actor.id],
      )).rows;
      const accessibleIds = new Set(accessible.map((row) => String(row.id)));
      if (ids.some((id) => !accessibleIds.has(id))) throw new Error("queue contains an inaccessible job");
      const priorityBase = ids.length;
      await updatePriorities(client, tableName, ids.map((id, index) => ({ id, priority: priorityBase - index })));
      return ids;
    });
  }

  async function claimTrainingJob(workerId) {
    return transaction(async (client) => {
      const row = (await client.query(
        `SELECT * FROM runtime_training_jobs
         WHERE status='pending'
         ORDER BY priority DESC, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      )).rows[0];
      if (!row) return null;
      const updated = (await client.query(
        `UPDATE runtime_training_jobs
         SET status='preparing', worker_id=$1, heartbeat_at=now(), started_at=COALESCE(started_at, now()), message=$2
         WHERE id=$3 RETURNING *`,
        [workerId, "正在生成数据集快照", row.id],
      )).rows[0];
      return updated;
    });
  }

  async function claimInferenceJob(workerId) {
    return transaction(async (client) => {
      const row = (await client.query(
        `SELECT *
         FROM runtime_inference_jobs
         WHERE status='pending'
         ORDER BY priority DESC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      )).rows[0];
      if (!row) return null;
      await client.query(
        "UPDATE runtime_inference_jobs SET status='running', progress=10, message=$1, started_at=COALESCE(started_at, now()) WHERE id=$2",
        [`推理 worker ${workerId} 已接管任务`, row.id],
      );
      return { ...row, status: "running" };
    });
  }

  return { moveRuntimeJobPriority, reorderRuntimeJobs, claimTrainingJob, claimInferenceJob };
}

module.exports = { createRuntimeQueueService };
