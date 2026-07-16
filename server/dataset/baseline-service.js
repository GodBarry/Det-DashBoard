const { analyzeImageGroup, applyConflictDecision } = require("./baseline-core");

function createBaselineService({ query, transaction, accessControl }) {
  async function sourceImageRows(sourceProjectIds) {
    const rows = await query(
      `SELECT pi.*, ia.sha256, ia.width AS image_width, ia.height AS image_height, ia.original_ext,
              p.name AS project_name, p.active_label_version_id
       FROM project_images pi
       JOIN projects p ON p.id=pi.project_id
       JOIN image_assets ia ON ia.id=pi.image_asset_id
       WHERE pi.project_id = ANY($1::uuid[]) AND pi.deleted_at IS NULL AND p.deleted_at IS NULL
       ORDER BY pi.created_at`,
      [sourceProjectIds],
    );
    const images = rows.rows;
    if (!images.length) return [];
    const anns = await query(
      `SELECT a.*
       FROM image_annotations a
       JOIN projects p ON p.active_label_version_id=a.label_version_id
       WHERE p.id = ANY($1::uuid[]) AND a.project_image_id = ANY($2::uuid[])
       ORDER BY a.id`,
      [sourceProjectIds, images.map((row) => row.id)],
    );
    const byImage = new Map();
    for (const ann of anns.rows) {
      const key = String(ann.project_image_id);
      if (!byImage.has(key)) byImage.set(key, []);
      byImage.get(key).push(ann);
    }
    return images.map((row) => ({ ...row, annotations: byImage.get(String(row.id)) || [] }));
  }

  async function listBaselineConflicts(runId) {
    const result = await query(
      `SELECT bc.*, ia.width AS image_width, ia.height AS image_height, ia.object_key
       FROM baseline_conflicts bc
       JOIN image_assets ia ON ia.id=bc.image_asset_id
       WHERE bc.merge_run_id=$1
       ORDER BY bc.created_at, bc.id`,
      [runId],
    );
    return result.rows;
  }

  async function resolveBaselineConflicts(runId, body = {}) {
    const ids = Array.from(new Set((body.conflictIds || []).map(String).filter(Boolean)));
    if (!ids.length) return { updated: 0 };
    const resolution = String(body.resolution || "pending");
    const status = body.status || (resolution === "pending" ? "pending" : "resolved");
    const result = await query(
      `UPDATE baseline_conflicts
       SET status=$1, resolution=$2
       WHERE merge_run_id=$3 AND id = ANY($4::uuid[])
       RETURNING id`,
      [status, resolution, runId, ids],
    );
    return { updated: result.rowCount };
  }

  async function createBaselinePreview(body = {}) {
    const sourceProjectIds = Array.from(new Set((body.sourceProjectIds || []).map(String).filter(Boolean)));
    if (sourceProjectIds.length < 1) throw new Error("Select at least one source project.");
    const params = {
      iouSame: Number(body.iouSame ?? 0.9),
      iouLight: Number(body.iouLight ?? 0.75),
      sourcePriority: body.sourcePriority?.length ? body.sourcePriority : sourceProjectIds,
      labelMap: body.labelMap || {},
    };
    const rows = await sourceImageRows(sourceProjectIds);
    const byAsset = new Map();
    for (const row of rows) {
      const key = String(row.image_asset_id);
      if (!byAsset.has(key)) byAsset.set(key, []);
      byAsset.get(key).push(row);
    }
    const run = await query(
      `INSERT INTO baseline_merge_runs (name, source_project_ids, params_json, status)
       VALUES ($1,$2,$3,'preview') RETURNING *`,
      [body.name || `baseline_${new Date().toISOString()}`, sourceProjectIds, JSON.stringify(params)],
    );
    const runId = run.rows[0].id;
    const summary = { source_projects: sourceProjectIds.length, source_images: rows.length, unique_images: byAsset.size, auto_resolved: 0, conflicts: 0, annotations_kept: 0, by_type: {} };
    const logs = [];
    for (const group of byAsset.values()) {
      const analysis = analyzeImageGroup(group, params);
      summary.annotations_kept += analysis.annotations.length;
      if (analysis.conflictType) {
        summary.conflicts += 1;
        summary.by_type[analysis.conflictType] = (summary.by_type[analysis.conflictType] || 0) + 1;
        await query(
          `INSERT INTO baseline_conflicts (merge_run_id, image_asset_id, conflict_type, severity, preview_json)
           VALUES ($1,$2,$3,$4,$5)`,
          [runId, group[0].image_asset_id, analysis.conflictType, analysis.severity, JSON.stringify({ sources: group.map((row) => ({ project_id: row.project_id, project_name: row.project_name, image_id: row.id, annotations: row.annotations.length })), log: analysis.log })],
        );
      } else {
        summary.auto_resolved += 1;
      }
      logs.push(...analysis.log.slice(0, 5));
    }
    await query("UPDATE baseline_merge_runs SET summary_json=$1, log_json=$2 WHERE id=$3", [JSON.stringify(summary), JSON.stringify(logs.slice(0, 200)), runId]);
    return { runId, summary, logs: logs.slice(0, 200) };
  }

  async function applyBaselineRun(runId, body = {}, actor) {
    const run = (await query("SELECT * FROM baseline_merge_runs WHERE id=$1", [runId])).rows[0];
    if (!run) throw new Error("baseline run not found");
    if (run.status === "applied") throw new Error("baseline run already applied");
    const sourceProjectIds = run.source_project_ids;
    const params = run.params_json || {};
    const rows = await sourceImageRows(sourceProjectIds);
    const byAsset = new Map();
    for (const row of rows) {
      const key = String(row.image_asset_id);
      if (!byAsset.has(key)) byAsset.set(key, []);
      byAsset.get(key).push(row);
    }
    const result = await transaction(async (client) => {
      const decisions = await client.query("SELECT * FROM baseline_conflicts WHERE merge_run_id=$1", [runId]);
      const decisionByAsset = new Map(decisions.rows.map((row) => [String(row.image_asset_id), row]));
      const project = (await client.query(
        "INSERT INTO projects (name, description, project_type, owner_user_id, visibility) VALUES ($1,$2,'baseline',$3,'private') RETURNING *",
        [body.name || run.name, `Baseline generated from ${sourceProjectIds.length} projects`, actor.id],
      )).rows[0];
      const version = (await client.query(
        "INSERT INTO label_versions (project_id, name, target_type, status, created_by_user_id) VALUES ($1,$2,'image','active',$3) RETURNING *",
        [project.id, "baseline_v1", actor.id],
      )).rows[0];
      let imageCount = 0;
      let annCount = 0;
      for (const group of byAsset.values()) {
        const analysis = applyConflictDecision(group, params, decisionByAsset.get(String(group[0].image_asset_id)));
        const source = analysis.chosenRow;
        const pi = (await client.query(
          `INSERT INTO project_images (project_id, image_asset_id, display_name, source_path, scene, view, modality, keyword)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (project_id, image_asset_id, display_name) DO UPDATE SET deleted_at=NULL
           RETURNING *`,
          [project.id, source.image_asset_id, source.display_name, source.source_path || "", source.scene, source.view, source.modality, source.keyword],
        )).rows[0];
        imageCount += 1;
        for (const ann of analysis.annotations) {
          const saved = (await client.query(
            `INSERT INTO image_annotations
             (label_version_id, project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h, shape_type, difficult, score, attributes_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [version.id, pi.id, ann.normalized_label || ann.label || "unknown", ann.bbox_x, ann.bbox_y, ann.bbox_w, ann.bbox_h, ann.shape_type || "rectangle", Boolean(ann.difficult), ann.score, ann.attributes_json || {}],
          )).rows[0];
          await client.query(
            `INSERT INTO baseline_annotation_sources
             (merge_run_id, baseline_annotation_id, source_project_id, source_project_image_id, source_annotation_id, resolution_method, annotation_snapshot_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [runId, saved.id, ann.source_project_id, ann.source_project_image_id, ann.id, analysis.conflictType ? "source_priority" : "auto_consistent", ann],
          );
          annCount += 1;
        }
      }
      await client.query("UPDATE projects SET active_label_version_id=$1, updated_at=now() WHERE id=$2", [version.id, project.id]);
      await client.query("UPDATE baseline_merge_runs SET baseline_project_id=$1, status='applied', applied_at=now() WHERE id=$2", [project.id, runId]);
      return { project, imageCount, annotationCount: annCount };
    });
    await accessControl.ensureAssetOwner(actor, "project", result.project.id);
    return result;
  }

  return { sourceImageRows, listBaselineConflicts, resolveBaselineConflicts, createBaselinePreview, applyBaselineRun };
}

module.exports = { createBaselineService };
