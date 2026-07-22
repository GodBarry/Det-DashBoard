"use strict";

const { pool, transaction } = require("../server/db");
const store = require("../server/object-store");

const TARGET_PROJECT_IDS = [
  "f03f3028-6dcf-43c7-b7f9-fa1c3ce629ba",
  "0341b551-592b-48ae-89ac-aa213b8d8fc8",
  "a76af1f1-7c3d-43a1-b5c1-0cfa7a2a0364",
  "c1a28e1d-bf8d-4901-bb40-eb40a60bb385",
  "01b7214f-4126-4e9d-bb23-bdaef568e403",
  "b1820b47-69c6-46c5-b70d-90e1ed97397c",
  "707af33c-5056-4735-9dd7-eaa045b63c87",
  "8d911cbf-8695-478b-acaf-744fc1fe247c",
  "48974b3a-1d00-49da-b625-28de5a7d9c7f",
  "9c011191-7c75-4687-8fa5-302473b9b39d",
];

const KEEP_IMPORT_IDS = [
  "49e0e86a-0d1d-4503-9172-d8117347bfc7",
  "ff9dee5a-2261-4119-bbf5-f7c7e45463d3",
  "bd07ab3d-c45f-4434-8796-6978bb893c49",
  "6fa37120-c0c7-4bc8-bc6b-bd51bc19fd68",
  "23ba5aa2-171e-40de-ac33-ad283ce03287",
  "5f5aee6b-40a9-4b35-9862-e571d1137b69",
  "675930a1-de4d-41ff-938d-0a9e5eccb11b",
  "5c48bdd1-1907-4fdb-bc64-969ed7d61a36",
  "4d7c1817-afdf-45df-9162-78190d2f2af6",
  "83cc00f5-3d58-4316-8e1e-bb8f505ddbb8",
];

const TEST_PROJECT_ID = "cccb683c-9500-44a3-99ec-06bfa04baa73";

async function removeRawLabelVersions(versions) {
  let removed = 0;
  for (const version of versions) {
    const prefix = `objects/raw-labels/${version.project_id}/${version.id}/`;
    const keys = await store.listObjectKeys(prefix);
    await store.removeObjects(keys, { collapsePrefixes: [prefix] });
    removed += keys.length;
    console.log(`[objects] raw labels ${version.id}: ${keys.length}`);
  }
  return removed;
}

async function replaceBaseline() {
  const cleanup = await transaction(async (client) => {
    const keep = await client.query(
      "SELECT id,status,total_files,processed_files FROM import_batches WHERE id=ANY($1::uuid[]) ORDER BY created_at",
      [KEEP_IMPORT_IDS],
    );
    if (keep.rows.length !== KEEP_IMPORT_IDS.length || keep.rows.some((row) => row.status !== "done" || row.total_files !== row.processed_files)) {
      throw new Error(`Refusing cleanup: expected ${KEEP_IMPORT_IDS.length} complete imports, found ${keep.rows.length}`);
    }

    const testProjects = await client.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM projects WHERE id=$1
         UNION ALL SELECT p.id FROM projects p JOIN tree t ON p.parent_id=t.id
       ) SELECT id FROM tree`,
      [TEST_PROJECT_ID],
    );
    const testProjectIds = testProjects.rows.map((row) => row.id);
    const purgeImports = await client.query(
      `SELECT id FROM import_batches
       WHERE (project_id=ANY($1::uuid[]) AND NOT (id=ANY($2::uuid[])))
          OR project_id=ANY($3::uuid[])`,
      [TARGET_PROJECT_IDS, KEEP_IMPORT_IDS, testProjectIds],
    );
    const purgeImportIds = purgeImports.rows.map((row) => row.id);
    const versions = purgeImportIds.length || testProjectIds.length
      ? await client.query(
        `SELECT id,project_id FROM label_versions
         WHERE import_batch_id=ANY($1::uuid[]) OR project_id=ANY($2::uuid[])`,
        [purgeImportIds, testProjectIds],
      )
      : { rows: [] };

    await client.query(
      `UPDATE projects SET active_label_version_id=NULL
       WHERE id=ANY($1::uuid[]) OR active_label_version_id=ANY($2::uuid[])`,
      [testProjectIds, versions.rows.map((row) => row.id)],
    );
    const labelVersions = await client.query(
      "DELETE FROM label_versions WHERE id=ANY($1::uuid[]) RETURNING id",
      [versions.rows.map((row) => row.id)],
    );
    const images = await client.query(
      `DELETE FROM project_images
       WHERE import_batch_id=ANY($1::uuid[]) OR project_id=ANY($2::uuid[])
       RETURNING id`,
      [purgeImportIds, testProjectIds],
    );
    const videos = await client.query(
      `DELETE FROM project_videos
       WHERE import_batch_id=ANY($1::uuid[]) OR project_id=ANY($2::uuid[])
       RETURNING id`,
      [purgeImportIds, testProjectIds],
    );
    const imports = await client.query(
      "DELETE FROM import_batches WHERE id=ANY($1::uuid[]) RETURNING id",
      [purgeImportIds],
    );
    const projects = await client.query(
      "DELETE FROM projects WHERE id=ANY($1::uuid[]) RETURNING id",
      [testProjectIds],
    );
    const imageAssets = await client.query(
      `DELETE FROM image_assets ia
       WHERE NOT EXISTS (SELECT 1 FROM project_images pi WHERE pi.image_asset_id=ia.id)
         AND NOT EXISTS (SELECT 1 FROM extracted_frames ef WHERE ef.image_asset_id=ia.id)
       RETURNING object_key`,
    );
    const videoAssets = await client.query(
      `DELETE FROM video_assets va
       WHERE NOT EXISTS (SELECT 1 FROM project_videos pv WHERE pv.video_asset_id=va.id)
       RETURNING object_key`,
    );
    return {
      versions: versions.rows,
      imageObjectKeys: imageAssets.rows.map((row) => row.object_key),
      videoObjectKeys: videoAssets.rows.map((row) => row.object_key),
      counts: {
        imports: imports.rowCount,
        labelVersions: labelVersions.rowCount,
        projectImages: images.rowCount,
        projectVideos: videos.rowCount,
        projects: projects.rowCount,
        imageAssets: imageAssets.rowCount,
        videoAssets: videoAssets.rowCount,
      },
    };
  });

  console.log("[database]", JSON.stringify(cleanup.counts));
  const rawLabelObjects = await removeRawLabelVersions(cleanup.versions);
  await store.removeObjects(cleanup.imageObjectKeys);
  await store.removeObjects(cleanup.videoObjectKeys);
  console.log("[objects]", JSON.stringify({
    rawLabelObjects,
    imageObjects: cleanup.imageObjectKeys.length,
    videoObjects: cleanup.videoObjectKeys.length,
  }));
}

async function main() {
  if (!process.argv.includes("--execute")) {
    throw new Error("Pass --execute to replace the dataset baseline.");
  }
  try {
    await replaceBaseline();
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
