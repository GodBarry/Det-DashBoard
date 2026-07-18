"use strict";

function json(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function createComputeTaskService({ query, transaction, resourceAccess, accessControl, httpError, stopProcess }) {
  const owns = (actor, row) => accessControl.isAdmin(actor) || String(row.owner_user_id || "") === String(actor.id || "");

  async function assertTask(taskId, actor) {
    const row = (await query("SELECT * FROM compute_tasks WHERE id=$1", [taskId])).rows[0];
    if (!row) throw httpError(404, "计算任务不存在");
    if (!owns(actor, row)) throw httpError(403, "无权访问该计算任务");
    return row;
  }

  async function createTask(body, actor) {
    const purpose = String(body.purpose || "annotation");
    const operation = String(body.operation || "").trim();
    if (!operation) throw httpError(400, "operation is required");
    const executionMode = body.executionMode === "session" ? "session" : "oneshot";
    const inserted = await query(
      `INSERT INTO compute_tasks
       (owner_user_id, purpose, operation, adapter_id, model_asset_id, environment_asset_id,
        execution_mode, session_key, input_json, parameters_json, priority, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         (SELECT COALESCE(MAX(priority),0)+1 FROM compute_tasks),$11)
       RETURNING *`,
      [actor.id, purpose, operation, body.adapterId || null, body.modelAssetId || null,
        body.environmentAssetId || null, executionMode, String(body.sessionKey || ""),
        body.input || {}, body.parameters || {}, "等待计算资源"],
    );
    return inserted.rows[0];
  }

  async function listTasks(actor, filters = {}) {
    const params = [];
    const where = [];
    if (!accessControl.isAdmin(actor)) { params.push(actor.id); where.push(`owner_user_id=$${params.length}`); }
    if (filters.purpose) { params.push(filters.purpose); where.push(`purpose=$${params.length}`); }
    if (filters.sessionKey) { params.push(filters.sessionKey); where.push(`session_key=$${params.length}`); }
    return (await query(
      `SELECT * FROM compute_tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC LIMIT 200`, params,
    )).rows;
  }

  async function controlTask(taskId, action, actor) {
    const task = await assertTask(taskId, actor);
    const transitions = {
      pause: ["paused", "已暂停"],
      resume: ["pending", "等待继续执行"],
      cancel: ["cancelled", "已取消"],
      restart: ["pending", "等待重新执行"],
    };
    if (!transitions[action]) throw httpError(400, "不支持的任务操作");
    if (["done", "failed", "cancelled"].includes(task.status) && !["restart"].includes(action)) {
      throw httpError(409, "当前任务状态不支持该操作");
    }
    if (["pause", "cancel", "restart"].includes(action) && task.process_pid) stopProcess?.(task.process_pid);
    const [status, message] = transitions[action];
    return (await query(
      `UPDATE compute_tasks SET status=$1, message=$2, process_pid=NULL,
       progress=CASE WHEN $3='restart' THEN 0 ELSE progress END,
       started_at=CASE WHEN $3 IN ('resume','restart') THEN NULL ELSE started_at END,
       finished_at=CASE WHEN $3 IN ('resume','restart') THEN NULL ELSE finished_at END,
       updated_at=now() WHERE id=$4 RETURNING *`,
      [status, message, action, taskId],
    )).rows[0];
  }

  async function taskLogs(taskId, actor) {
    await assertTask(taskId, actor);
    return (await query("SELECT * FROM compute_task_logs WHERE task_id=$1 ORDER BY id", [taskId])).rows;
  }

  return { createTask, listTasks, assertTask, controlTask, taskLogs, transaction, resourceAccess, json };
}

module.exports = { createComputeTaskService };
