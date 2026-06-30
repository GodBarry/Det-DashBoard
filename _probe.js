const { query } = require('./server/db');
(async () => {
  try {
    const created = await query('INSERT INTO projects (name, description) VALUES ($1,$2) RETURNING *', ['debug_project', '']);
    console.log('created', created.rows[0]);
    const list = await query(`SELECT p.*,
      (SELECT count(*)::int FROM project_images pi WHERE pi.project_id=p.id AND pi.deleted_at IS NULL) AS image_count,
      (SELECT count(*)::int FROM project_videos pv WHERE pv.project_id=p.id AND pv.deleted_at IS NULL) AS video_count,
      (SELECT max(created_at) FROM import_batches ib WHERE ib.project_id=p.id) AS last_import_at
     FROM projects p
     WHERE p.deleted_at IS NULL
     ORDER BY p.created_at DESC`);
    console.log('list', JSON.stringify(list.rows, null, 2));
    const simple = await query('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC');
    console.log('simple', JSON.stringify(simple.rows, null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
  }
})();
