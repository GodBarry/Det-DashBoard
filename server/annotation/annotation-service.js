"use strict";

function createAnnotationService({ query, transaction, computeTaskService, resourceAccess, httpError }) {
  async function assertSession(sessionId, actor, permission = "read") {
    const session = (await query("SELECT * FROM annotation_sessions WHERE id=$1", [sessionId])).rows[0];
    if (!session) throw httpError(404, "标注会话不存在");
    await (permission === "write" ? resourceAccess.assertProjectWrite(actor, session.project_id) : resourceAccess.assertProjectRead(actor, session.project_id));
    return session;
  }

  async function createSession(body, actor) {
    const projectId = body.projectId;
    await resourceAccess.assertProjectWrite(actor, projectId);
    const mode = ["manual", "segmentation", "tracking"].includes(body.mode) ? body.mode : "manual";
    return (await query(
      `INSERT INTO annotation_sessions
       (owner_user_id, project_id, mode, adapter_id, model_asset_id, environment_asset_id, settings_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [actor.id, projectId, mode, body.adapterId || null, body.modelAssetId || null,
        body.environmentAssetId || null, body.settings || {}],
    )).rows[0];
  }

  async function runOperation(sessionId, body, actor) {
    const session = await assertSession(sessionId, actor, "write");
    const allowed = session.mode === "segmentation"
      ? new Set(["segment"])
      : session.mode === "tracking"
        ? new Set(["propagate", "correct"])
        : new Set();
    if (!allowed.has(body.operation)) throw httpError(400, "当前标注模式不支持该计算操作");
    return computeTaskService.createTask({
      purpose: "annotation",
      operation: body.operation,
      adapterId: session.adapter_id,
      modelAssetId: session.model_asset_id,
      environmentAssetId: session.environment_asset_id,
      executionMode: "session",
      sessionKey: session.id,
      input: { ...(body.input || {}), annotationSessionId: session.id, projectId: session.project_id },
      parameters: body.parameters || {},
    }, actor);
  }

  async function correctTrack(sessionId, body, actor) {
    const session = await assertSession(sessionId, actor, "write");
    if (session.mode !== "tracking") throw httpError(400, "只有跟踪标注会话可以修正轨迹");
    const trackId = String(body.trackId || "").trim();
    const frame = Number(body.frameIndex);
    if (!trackId || !Number.isInteger(frame)) throw httpError(400, "trackId 和 frameIndex 必填");
    return transaction(async (client) => {
      const revision = Number((await client.query(
        "SELECT COALESCE(MAX(revision),0)+1 AS revision FROM annotation_revisions WHERE session_id=$1 AND track_id=$2",
        [sessionId, trackId],
      )).rows[0].revision);
      const end = body.endFrame == null ? null : Number(body.endFrame);
      await client.query(
        `UPDATE annotation_suggestions SET status='superseded', updated_at=now()
         WHERE session_id=$1 AND track_id=$2 AND frame_index >= $3 AND ($4::int IS NULL OR frame_index <= $4)`,
        [sessionId, trackId, frame, end],
      );
      const row = (await client.query(
        `INSERT INTO annotation_revisions
         (session_id, track_id, revision, correction_frame, affected_start, affected_end, prompt_json)
         VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING *`,
        [sessionId, trackId, revision, frame, end, body.prompt || {}],
      )).rows[0];
      return row;
    });
  }

  async function suggestions(sessionId, actor) {
      await assertSession(sessionId, actor);
      return (await query(
      `SELECT * FROM (
         SELECT DISTINCT ON (project_image_id, track_id) *
         FROM annotation_suggestions
         WHERE session_id=$1 AND status IN ('suggested','accepted')
         ORDER BY project_image_id, track_id, revision DESC, created_at DESC
       ) latest ORDER BY frame_index, track_id`, [sessionId],
      )).rows;
  }

  async function reviewSuggestions(sessionId, body, actor) {
    await assertSession(sessionId, actor, "write");
    const ids = Array.isArray(body.suggestionIds) ? body.suggestionIds.filter(Boolean) : [];
    const status = body.status === "rejected" ? "rejected" : "suggested";
    const params = [sessionId, status];
    const selection = ids.length ? (params.push(ids), "AND id=ANY($3::uuid[])") : "";
    return (await query(
      `UPDATE annotation_suggestions SET status=$2,updated_at=now()
       WHERE session_id=$1 AND status <> 'superseded' ${selection} RETURNING *`, params,
    )).rows;
  }

  async function commitSuggestions(sessionId, body, actor) {
    const session = await assertSession(sessionId, actor, "write");
    const requestedIds = Array.isArray(body.suggestionIds) ? body.suggestionIds.filter(Boolean) : [];
    return transaction(async (client) => {
      const project = (await client.query("SELECT active_label_version_id FROM projects WHERE id=$1 FOR UPDATE", [session.project_id])).rows[0];
      const nextVersion = (await client.query(
        `INSERT INTO label_versions(project_id,name,target_type,status)
         VALUES ($1,$2,'image','active') RETURNING *`,
        [session.project_id, `smart_annotation_${new Date().toISOString()}`],
      )).rows[0];
      if (project?.active_label_version_id) {
        await client.query(
          `INSERT INTO image_annotations
           (label_version_id,project_image_id,label,bbox_x,bbox_y,bbox_w,bbox_h,shape_type,difficult,score,attributes_json)
           SELECT $1,project_image_id,label,bbox_x,bbox_y,bbox_w,bbox_h,shape_type,difficult,score,attributes_json
           FROM image_annotations WHERE label_version_id=$2`,
          [nextVersion.id, project.active_label_version_id],
        );
      }
      const params = [sessionId];
      let selected = "session_id=$1 AND status='suggested'";
      if (requestedIds.length) { params.push(requestedIds); selected += ` AND id=ANY($2::uuid[])`; }
      const suggestionSql = requestedIds.length
        ? `SELECT * FROM annotation_suggestions WHERE ${selected} ORDER BY frame_index,id`
        : `SELECT * FROM (
             SELECT DISTINCT ON (project_image_id, track_id) * FROM annotation_suggestions
             WHERE ${selected} ORDER BY project_image_id, track_id, revision DESC, created_at DESC
           ) latest ORDER BY frame_index,id`;
      const rows = (await client.query(suggestionSql, params)).rows;
      for (const row of rows) {
        const geometry = typeof row.geometry_json === "string" ? JSON.parse(row.geometry_json || "{}") : (row.geometry_json || {});
        const [x1, y1, x2, y2] = geometry.bbox || [];
        if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
        await client.query(
          `INSERT INTO image_annotations
           (label_version_id,project_image_id,label,bbox_x,bbox_y,bbox_w,bbox_h,shape_type,difficult,score,attributes_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10)`,
          [nextVersion.id, row.project_image_id, row.label, x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1),
            row.shape_type, row.score, { track_id: row.track_id, annotation_source: row.source, annotation_session_id: sessionId }],
        );
      }
      if (rows.length) await client.query(`UPDATE annotation_suggestions SET status='accepted',updated_at=now() WHERE id=ANY($1::uuid[])`, [rows.map((row) => row.id)]);
      await client.query("UPDATE projects SET active_label_version_id=$1,updated_at=now() WHERE id=$2", [nextVersion.id, session.project_id]);
      await client.query(
        `UPDATE annotation_sessions SET status='committed',
         settings_json=COALESCE(settings_json,'{}'::jsonb) || $2::jsonb,updated_at=now() WHERE id=$1`,
        [sessionId, JSON.stringify({ committedLabelVersionId: nextVersion.id, previousLabelVersionId: project?.active_label_version_id || null })],
      );
      return { labelVersion: nextVersion, accepted: rows.length };
    });
  }

  async function undoCommit(sessionId, actor) {
    const session = await assertSession(sessionId, actor, "write");
    const settings = typeof session.settings_json === "string" ? JSON.parse(session.settings_json || "{}") : (session.settings_json || {});
    const committedId = settings.committedLabelVersionId;
    if (!committedId) throw httpError(409, "该会话没有可撤销的提交");
    return transaction(async (client) => {
      const project = (await client.query("SELECT active_label_version_id FROM projects WHERE id=$1 FOR UPDATE", [session.project_id])).rows[0];
      if (String(project?.active_label_version_id || "") !== String(committedId)) throw httpError(409, "项目已切换到其他标签版本，不能直接撤销");
      await client.query("UPDATE projects SET active_label_version_id=$1,updated_at=now() WHERE id=$2", [settings.previousLabelVersionId || null, session.project_id]);
      await client.query("DELETE FROM label_versions WHERE id=$1 AND project_id=$2", [committedId, session.project_id]);
      await client.query("UPDATE annotation_suggestions SET status='suggested',updated_at=now() WHERE session_id=$1 AND status='accepted'", [sessionId]);
      await client.query(
        `UPDATE annotation_sessions SET status='active',
         settings_json=(COALESCE(settings_json,'{}'::jsonb) - 'committedLabelVersionId' - 'previousLabelVersionId'),updated_at=now() WHERE id=$1`,
        [sessionId],
      );
      return { restoredLabelVersionId: settings.previousLabelVersionId || null };
    });
  }

  return { createSession, runOperation, correctTrack, suggestions, reviewSuggestions, commitSuggestions, undoCommit, assertSession };
}

module.exports = { createAnnotationService };
