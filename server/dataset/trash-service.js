function createTrashService({ query, transaction, store, httpError }) {
  if (typeof query !== "function") throw new TypeError("createTrashService requires query");
  if (typeof transaction !== "function") throw new TypeError("createTrashService requires transaction");
  if (!store || typeof store.removeObject !== "function") throw new TypeError("createTrashService requires store");
  if (typeof httpError !== "function") throw new TypeError("createTrashService requires httpError");

  async function softDeleteProjectTree(projectId) {
    await query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM projects WHERE id=$1
         UNION ALL
         SELECT p.id
         FROM projects p
         JOIN descendants ON p.parent_id = descendants.id
       )
       UPDATE projects SET deleted_at=now()
       WHERE id IN (SELECT id FROM descendants)`,
      [projectId],
    );
  }

  async function restoreProjectTree(projectId) {
    await query(
      `WITH RECURSIVE descendants AS (
         SELECT id, parent_id FROM projects WHERE id=$1
         UNION ALL
         SELECT p.id, p.parent_id
         FROM projects p
         JOIN descendants ON p.parent_id = descendants.id
       ),
       ancestors AS (
         SELECT id, parent_id FROM projects WHERE id=$1
         UNION ALL
         SELECT p.id, p.parent_id
         FROM projects p
         JOIN ancestors ON ancestors.parent_id = p.id
       ),
       affected AS (
         SELECT id FROM descendants
         UNION
         SELECT id FROM ancestors
       )
       UPDATE projects SET deleted_at=NULL
       WHERE id IN (SELECT id FROM affected)`,
      [projectId],
    );
  }

  async function softDeleteImport(importId) {
    await transaction(async (client) => {
      await client.query("UPDATE import_batches SET deleted_at=now(), status='deleted' WHERE id=$1", [importId]);
      await client.query("UPDATE project_images SET deleted_at=now() WHERE import_batch_id=$1", [importId]);
      await client.query("UPDATE project_videos SET deleted_at=now() WHERE import_batch_id=$1", [importId]);
      await client.query("UPDATE label_versions SET deleted_at=now(), status='archived' WHERE import_batch_id=$1", [importId]);
    });
  }

  async function restoreImport(importId) {
    await transaction(async (client) => {
      await client.query("UPDATE import_batches SET deleted_at=NULL, status='done' WHERE id=$1", [importId]);
      await client.query("UPDATE project_images SET deleted_at=NULL WHERE import_batch_id=$1", [importId]);
      await client.query("UPDATE project_videos SET deleted_at=NULL WHERE import_batch_id=$1", [importId]);
      await client.query("UPDATE label_versions SET deleted_at=NULL, status='active' WHERE import_batch_id=$1", [importId]);
    });
  }

  async function cleanupUnreferencedAssets(client) {
    const images = await client.query(
      `DELETE FROM image_assets ia
       WHERE NOT EXISTS (SELECT 1 FROM project_images pi WHERE pi.image_asset_id=ia.id)
         AND NOT EXISTS (SELECT 1 FROM extracted_frames ef WHERE ef.image_asset_id=ia.id)
       RETURNING id, object_key`,
    );
    const videos = await client.query(
      `DELETE FROM video_assets va
       WHERE NOT EXISTS (SELECT 1 FROM project_videos pv WHERE pv.video_asset_id=va.id)
       RETURNING id, object_key`,
    );
    for (const row of [...images.rows, ...videos.rows]) await store.removeObject(row.object_key);
    return { image_assets: images.rowCount, video_assets: videos.rowCount };
  }

  async function emptyImportTrash(projectId) {
    return transaction(async (client) => {
      const batches = await client.query(
        "SELECT id FROM import_batches WHERE project_id=$1 AND deleted_at IS NOT NULL",
        [projectId],
      );
      const ids = batches.rows.map((row) => row.id);
      if (!ids.length) return { imports: 0, project_images: 0, project_videos: 0, label_versions: 0, image_assets: 0, video_assets: 0 };

      await client.query(
        `UPDATE projects
         SET active_label_version_id = (
           SELECT lv.id
           FROM label_versions lv
           WHERE lv.project_id=$1
             AND lv.deleted_at IS NULL
             AND (lv.import_batch_id IS NULL OR NOT (lv.import_batch_id = ANY($2::uuid[])))
           ORDER BY lv.created_at DESC
           LIMIT 1
         )
         WHERE id=$1
           AND active_label_version_id IN (
             SELECT id FROM label_versions WHERE import_batch_id = ANY($2::uuid[])
           )`,
        [projectId, ids],
      );
      const labelVersions = await client.query(
        "DELETE FROM label_versions WHERE import_batch_id = ANY($1::uuid[]) RETURNING id",
        [ids],
      );
      const images = await client.query(
        "DELETE FROM project_images WHERE import_batch_id = ANY($1::uuid[]) RETURNING id",
        [ids],
      );
      const videos = await client.query(
        "DELETE FROM project_videos WHERE import_batch_id = ANY($1::uuid[]) RETURNING id",
        [ids],
      );
      const imports = await client.query(
        "DELETE FROM import_batches WHERE id = ANY($1::uuid[]) RETURNING id",
        [ids],
      );
      const assets = await cleanupUnreferencedAssets(client);
      return { imports: imports.rowCount, project_images: images.rowCount, project_videos: videos.rowCount, label_versions: labelVersions.rowCount, ...assets };
    });
  }

  async function deleteProjectPermanently(projectId) {
    return transaction(async (client) => {
      const root = (await client.query("SELECT id FROM projects WHERE id=$1 AND deleted_at IS NOT NULL", [projectId])).rows[0];
      if (!root) throw httpError(404, "project is not in trash");
      const rows = await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM projects WHERE id=$1 AND deleted_at IS NOT NULL
           UNION ALL
           SELECT p.id
           FROM projects p
           JOIN descendants d ON p.parent_id = d.id
           WHERE p.deleted_at IS NOT NULL
         )
         SELECT id FROM descendants`,
        [projectId],
      );
      const ids = rows.rows.map((row) => row.id);
      if (!ids.length) return { projects: 0, imports: 0, project_images: 0, project_videos: 0, label_versions: 0, image_assets: 0, video_assets: 0 };
      await client.query("UPDATE projects SET active_label_version_id=NULL WHERE id = ANY($1::uuid[])", [ids]);
      const labelVersions = await client.query("DELETE FROM label_versions WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
      const images = await client.query("DELETE FROM project_images WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
      const videos = await client.query("DELETE FROM project_videos WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
      const imports = await client.query("DELETE FROM import_batches WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
      const deletedProjects = await client.query("DELETE FROM projects WHERE id = ANY($1::uuid[]) RETURNING id", [ids]);
      const assets = await cleanupUnreferencedAssets(client);
      return { projects: deletedProjects.rowCount, imports: imports.rowCount, project_images: images.rowCount, project_videos: videos.rowCount, label_versions: labelVersions.rowCount, ...assets };
    });
  }

  async function emptyProjectTrash() {
    return transaction(async (client) => {
      const projects = await client.query("SELECT id FROM projects WHERE deleted_at IS NOT NULL");
      const ids = projects.rows.map((row) => row.id);
      if (!ids.length) return { projects: 0, imports: 0, project_images: 0, project_videos: 0, label_versions: 0, image_assets: 0, video_assets: 0 };

      await client.query("UPDATE projects SET active_label_version_id=NULL WHERE id = ANY($1::uuid[])", [ids]);
      const labelVersions = await client.query("DELETE FROM label_versions WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
      const images = await client.query("DELETE FROM project_images WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
      const videos = await client.query("DELETE FROM project_videos WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
      const imports = await client.query("DELETE FROM import_batches WHERE project_id = ANY($1::uuid[]) RETURNING id", [ids]);
      const deletedProjects = await client.query("DELETE FROM projects WHERE id = ANY($1::uuid[]) RETURNING id", [ids]);
      const assets = await cleanupUnreferencedAssets(client);
      return { projects: deletedProjects.rowCount, imports: imports.rowCount, project_images: images.rowCount, project_videos: videos.rowCount, label_versions: labelVersions.rowCount, ...assets };
    });
  }

  return {
    softDeleteProjectTree,
    restoreProjectTree,
    softDeleteImport,
    restoreImport,
    cleanupUnreferencedAssets,
    emptyImportTrash,
    deleteProjectPermanently,
    emptyProjectTrash,
  };
}

module.exports = { createTrashService };
