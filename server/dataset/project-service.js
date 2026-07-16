function createProjectService({ query, transaction, httpError, resourceAccess }) {
  if (typeof query !== "function") throw new TypeError("createProjectService requires query");
  if (typeof transaction !== "function") throw new TypeError("createProjectService requires transaction");
  if (typeof httpError !== "function") throw new TypeError("createProjectService requires httpError");
  if (!resourceAccess || typeof resourceAccess.scopeSql !== "function") {
    throw new TypeError("createProjectService requires resourceAccess");
  }

  async function projectDepth(projectId) {
    const result = await query(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_id, 1 AS depth FROM projects WHERE id=$1 AND deleted_at IS NULL
         UNION ALL
         SELECT p.id, p.parent_id, ancestors.depth + 1
         FROM projects p
         JOIN ancestors ON ancestors.parent_id = p.id
         WHERE p.deleted_at IS NULL AND ancestors.depth < 3
       )
       SELECT count(*)::int AS depth FROM ancestors`,
      [projectId],
    );
    const depth = result.rows[0]?.depth || 0;
    if (!depth) throw httpError(400, "父级项目不存在");
    return depth;
  }

  async function createProject(body, actor) {
    const rawName = String(body.name || `project_${Date.now()}`);
    const segments = rawName.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean);
    if (!segments.length) throw httpError(400, "项目名称不能为空");
    let parentId = body.parentId || body.parent_id || null;
    if (parentId) await resourceAccess.assertProjectWrite(actor, parentId);
    if (!parentId && segments[0] === "历史项目") throw httpError(400, "历史项目是旧版虚拟目录名称，不能创建为项目");
    const parentDepth = parentId ? await projectDepth(parentId) : 0;
    if (parentDepth + segments.length > 3) throw httpError(400, "Project folder depth exceeds limit");
    let project = null;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const shouldReuseFolder = segments.length > 1 && index < segments.length - 1;
      const existing = shouldReuseFolder ? (await query(
        "SELECT * FROM projects WHERE deleted_at IS NULL AND name=$1 AND parent_id IS NOT DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1",
        [segment, parentId],
      )).rows[0] : null;
      if (existing) {
        await resourceAccess.assertProjectWrite(actor, existing);
        project = existing;
      } else {
        project = (await query(
          "INSERT INTO projects (name, description, project_type, parent_id, owner_user_id, visibility) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
          [segment, body.description || "", body.project_type || "normal", parentId, actor.id, body.visibility || "private"],
        )).rows[0];
        project = await resourceAccess.assignOwner("projects", project.id, actor, { visibility: project.visibility });
      }
      parentId = project.id;
    }
    return project;
  }

  async function renameProject(projectId, body = {}) {
    const name = String(body.name || "").trim();
    if (!name) throw httpError(400, "文件夹名称不能为空");
    if (/[\\/]/.test(name)) throw httpError(400, "文件夹名称不能包含路径分隔符");
    const project = (await query("SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL", [projectId])).rows[0];
    if (!project) throw httpError(404, "项目或文件夹不存在");
    const duplicate = (await query(
      "SELECT id FROM projects WHERE deleted_at IS NULL AND id<>$1 AND name=$2 AND parent_id IS NOT DISTINCT FROM $3 LIMIT 1",
      [projectId, name, project.parent_id],
    )).rows[0];
    if (duplicate) throw httpError(409, "同级目录下已存在同名文件夹");
    const updated = await query("UPDATE projects SET name=$1, updated_at=now() WHERE id=$2 RETURNING *", [name, projectId]);
    return updated.rows[0];
  }

  async function listProjects(trash = false, actor, scope = "mine") {
    const scoped = resourceAccess.scopeSql({ table: "projects", alias: "p", actor, scope, params: [] });
    const result = await query(
      `WITH RECURSIVE scoped_projects AS (
         SELECT p.id FROM projects p WHERE ${trash ? "p.deleted_at IS NOT NULL" : "p.deleted_at IS NULL"} AND ${scoped.sql}
       ),
       subtree AS (
         SELECT p.id AS root_id, p.id AS project_id,
                COALESCE(p.active_label_version_id, (
                  SELECT lv.id
                  FROM label_versions lv
                  WHERE lv.project_id=p.id
                    AND lv.deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM image_annotations a WHERE a.label_version_id=lv.id)
                  ORDER BY lv.created_at DESC
                  LIMIT 1
                )) AS effective_label_version_id
         FROM projects p
         JOIN scoped_projects sp ON sp.id = p.id
         UNION ALL
         SELECT subtree.root_id, c.id,
                COALESCE(c.active_label_version_id, (
                  SELECT lv.id
                  FROM label_versions lv
                  WHERE lv.project_id=c.id
                    AND lv.deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM image_annotations a WHERE a.label_version_id=lv.id)
                  ORDER BY lv.created_at DESC
                  LIMIT 1
                )) AS effective_label_version_id
         FROM subtree
         JOIN projects c ON c.parent_id = subtree.project_id
         JOIN scoped_projects sp ON sp.id = c.id
       ),
       image_counts AS (
         SELECT subtree.root_id, count(DISTINCT pi.image_asset_id)::int AS image_count
         FROM subtree
         JOIN project_images pi ON pi.project_id = subtree.project_id AND pi.deleted_at IS NULL
         GROUP BY subtree.root_id
       ),
       video_counts AS (
         SELECT subtree.root_id, count(DISTINCT pv.video_asset_id)::int AS video_count
         FROM subtree
         JOIN project_videos pv ON pv.project_id = subtree.project_id AND pv.deleted_at IS NULL
         GROUP BY subtree.root_id
       ),
       annotation_counts AS (
         SELECT subtree.root_id, count(a.id)::int AS annotation_count
         FROM subtree
         JOIN image_annotations a ON a.label_version_id = subtree.effective_label_version_id
         GROUP BY subtree.root_id
       ),
       import_times AS (
         SELECT subtree.root_id, max(ib.created_at) AS last_import_at
         FROM subtree
         JOIN import_batches ib ON ib.project_id = subtree.project_id
         GROUP BY subtree.root_id
       )
       SELECT p.*,
        COALESCE(ic.image_count, 0)::int AS image_count,
        COALESCE(vc.video_count, 0)::int AS video_count,
        COALESCE(ac.annotation_count, 0)::int AS annotation_count,
        (SELECT count(DISTINCT pi.image_asset_id)::int FROM project_images pi WHERE pi.project_id=p.id AND pi.deleted_at IS NULL) AS direct_image_count,
        (SELECT count(DISTINCT pv.video_asset_id)::int FROM project_videos pv WHERE pv.project_id=p.id AND pv.deleted_at IS NULL) AS direct_video_count,
        (SELECT count(a.id)::int FROM image_annotations a
         JOIN project_images pi ON pi.id=a.project_image_id AND pi.project_id=p.id AND pi.deleted_at IS NULL
         WHERE a.label_version_id=COALESCE(p.active_label_version_id, (
           SELECT lv.id FROM label_versions lv
           WHERE lv.project_id=p.id AND lv.deleted_at IS NULL
           ORDER BY lv.created_at DESC LIMIT 1
         ))) AS direct_annotation_count,
        COALESCE(ic.image_count, 0)::int AS subtree_image_count,
        COALESCE(vc.video_count, 0)::int AS subtree_video_count,
        COALESCE(ac.annotation_count, 0)::int AS subtree_annotation_count,
        (SELECT count(*)::int FROM projects c WHERE c.parent_id=p.id AND ${trash ? "c.deleted_at IS NOT NULL" : "c.deleted_at IS NULL"}) AS child_count,
        COALESCE((SELECT jsonb_agg(DISTINCT pi.scene) FILTER (WHERE pi.scene IS NOT NULL AND pi.scene<>'') FROM subtree s JOIN project_images pi ON pi.project_id=s.project_id AND pi.deleted_at IS NULL WHERE s.root_id=p.id), '[]'::jsonb) AS scenes,
        COALESCE((SELECT jsonb_agg(DISTINCT pi.view) FILTER (WHERE pi.view IS NOT NULL AND pi.view<>'') FROM subtree s JOIN project_images pi ON pi.project_id=s.project_id AND pi.deleted_at IS NULL WHERE s.root_id=p.id), '[]'::jsonb) AS views,
        COALESCE((SELECT jsonb_agg(DISTINCT pi.modality) FILTER (WHERE pi.modality IS NOT NULL AND pi.modality<>'') FROM subtree s JOIN project_images pi ON pi.project_id=s.project_id AND pi.deleted_at IS NULL WHERE s.root_id=p.id), '[]'::jsonb) AS modalities,
        COALESCE((SELECT jsonb_agg(DISTINCT a.label) FILTER (WHERE a.label IS NOT NULL AND a.label<>'') FROM subtree s JOIN image_annotations a ON a.label_version_id=s.effective_label_version_id WHERE s.root_id=p.id), '[]'::jsonb) AS labels,
        it.last_import_at
       FROM projects p
       LEFT JOIN image_counts ic ON ic.root_id = p.id
       LEFT JOIN video_counts vc ON vc.root_id = p.id
       LEFT JOIN annotation_counts ac ON ac.root_id = p.id
       LEFT JOIN import_times it ON it.root_id = p.id
       WHERE ${trash ? "p.deleted_at IS NOT NULL" : "p.deleted_at IS NULL"}
         AND p.id IN (SELECT id FROM scoped_projects)
         AND NOT (p.parent_id IS NULL AND p.name='历史项目')
       ORDER BY p.created_at DESC`,
      scoped.params,
    );
    return result.rows;
  }

  async function projectSummary(projectId) {
    const rows = await query(
      `WITH RECURSIVE subtree AS (
         SELECT id,
                COALESCE(active_label_version_id, (
                  SELECT lv.id
                  FROM label_versions lv
                  WHERE lv.project_id=projects.id
                    AND lv.deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM image_annotations a WHERE a.label_version_id=lv.id)
                  ORDER BY lv.created_at DESC
                  LIMIT 1
                )) AS effective_label_version_id
         FROM projects WHERE id=$1 AND deleted_at IS NULL
         UNION ALL
         SELECT p.id,
                COALESCE(p.active_label_version_id, (
                  SELECT lv.id
                  FROM label_versions lv
                  WHERE lv.project_id=p.id
                    AND lv.deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM image_annotations a WHERE a.label_version_id=lv.id)
                  ORDER BY lv.created_at DESC
                  LIMIT 1
                )) AS effective_label_version_id
         FROM projects p
         JOIN subtree ON p.parent_id = subtree.id
         WHERE p.deleted_at IS NULL
       )
       SELECT
        (SELECT count(DISTINCT pi.image_asset_id)::int FROM project_images pi WHERE pi.project_id=$1 AND pi.deleted_at IS NULL) AS direct_image_count,
        (SELECT count(DISTINCT pv.video_asset_id)::int FROM project_videos pv WHERE pv.project_id=$1 AND pv.deleted_at IS NULL) AS direct_video_count,
        (SELECT count(*)::int FROM image_annotations a JOIN project_images pi ON pi.id=a.project_image_id JOIN subtree s ON s.id=pi.project_id WHERE s.id=$1 AND s.effective_label_version_id=a.label_version_id AND pi.deleted_at IS NULL) AS direct_annotation_count,
        (SELECT count(DISTINCT pi.image_asset_id)::int FROM project_images pi JOIN subtree s ON s.id=pi.project_id WHERE pi.deleted_at IS NULL) AS image_count,
        (SELECT count(DISTINCT pv.video_asset_id)::int FROM project_videos pv JOIN subtree s ON s.id=pv.project_id WHERE pv.deleted_at IS NULL) AS video_count,
        (SELECT count(DISTINCT a.project_image_id)::int FROM image_annotations a JOIN project_images pi ON pi.id=a.project_image_id JOIN subtree s ON s.id=pi.project_id AND s.effective_label_version_id=a.label_version_id WHERE pi.deleted_at IS NULL) AS labeled_image_count,
        (SELECT count(*)::int FROM image_annotations a JOIN project_images pi ON pi.id=a.project_image_id JOIN subtree s ON s.id=pi.project_id AND s.effective_label_version_id=a.label_version_id WHERE pi.deleted_at IS NULL) AS annotation_count,
        (SELECT COALESCE(json_agg(json_build_object('label', label, 'count', count) ORDER BY count DESC, label), '[]'::json)
         FROM (
           SELECT a.label, count(*)::int AS count
           FROM image_annotations a
           JOIN project_images pi ON pi.id=a.project_image_id
           JOIN subtree s ON s.id=pi.project_id AND s.effective_label_version_id=a.label_version_id
           WHERE pi.deleted_at IS NULL AND lower(trim(a.label)) NOT IN ('no', 'none', 'background', 'bg', 'negative')
           GROUP BY a.label
         ) label_stats) AS label_counts,
        (SELECT json_agg(DISTINCT scene) FROM project_images pi JOIN subtree s ON s.id=pi.project_id WHERE pi.deleted_at IS NULL) AS scenes,
        (SELECT json_agg(DISTINCT view) FROM project_images pi JOIN subtree s ON s.id=pi.project_id WHERE pi.deleted_at IS NULL) AS views,
        (SELECT json_agg(DISTINCT modality) FROM project_images pi JOIN subtree s ON s.id=pi.project_id WHERE pi.deleted_at IS NULL) AS modalities,
        (SELECT json_agg(DISTINCT label) FROM image_annotations a JOIN project_images pi ON pi.id=a.project_image_id JOIN subtree s ON s.id=pi.project_id AND s.effective_label_version_id=a.label_version_id WHERE pi.deleted_at IS NULL AND lower(trim(a.label)) NOT IN ('no', 'none', 'background', 'bg', 'negative')) AS labels`,
      [projectId],
    );
    return rows.rows[0];
  }

  return { createProject, renameProject, projectDepth, listProjects, projectSummary };
}

module.exports = { createProjectService };
