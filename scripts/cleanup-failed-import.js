#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const batchId = process.argv[2];
const apply = process.argv.includes("--apply");
const rootDir = path.resolve(__dirname, "..");
const storageRoot = path.resolve(process.env.STORAGE_ROOT || path.join(rootDir, "runtime"));
const databaseUrl = process.env.DATABASE_URL || "postgres://det:det_password@127.0.0.1:55432/det_dashboard";

if (!batchId) {
  console.error("Usage: node scripts/cleanup-failed-import.js <import_batch_id> [--apply]");
  process.exit(1);
}

function fallbackPath(objectKey) {
  return path.join(storageRoot, "object-store-fallback", ...String(objectKey || "").split(/[\\/]+/).filter(Boolean));
}

function pruneEmptyDirs(start, stop) {
  let current = path.dirname(start);
  const boundary = path.resolve(stop);
  while (current.startsWith(boundary) && current !== boundary) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const batch = (await client.query(
      "SELECT id, project_id, status, source_path FROM import_batches WHERE id=$1",
      [batchId],
    )).rows[0];
    if (!batch) throw new Error(`import batch not found: ${batchId}`);
    if (batch.status !== "failed" && batch.status !== "cancelled" && batch.status !== "deleted") {
      throw new Error(`refusing to clean import batch with status=${batch.status}`);
    }

    const versions = (await client.query(
      "SELECT id FROM label_versions WHERE import_batch_id=$1",
      [batchId],
    )).rows.map((row) => row.id);

    const projectImages = (await client.query(
      "SELECT id FROM project_images WHERE import_batch_id=$1",
      [batchId],
    )).rows.map((row) => row.id);

    const exclusiveAssets = (await client.query(
      `WITH failed_assets AS (
         SELECT DISTINCT image_asset_id
         FROM project_images
         WHERE import_batch_id=$1
       )
       SELECT ia.id, ia.object_key
       FROM failed_assets fa
       JOIN image_assets ia ON ia.id=fa.image_asset_id
       WHERE NOT EXISTS (
         SELECT 1
         FROM project_images pi2
         WHERE pi2.image_asset_id=fa.image_asset_id
           AND pi2.import_batch_id <> $1
           AND pi2.deleted_at IS NULL
       )`,
      [batchId],
    )).rows;

    const imageFiles = exclusiveAssets.map((row) => fallbackPath(row.object_key)).filter((filePath) => fs.existsSync(filePath));
    const rawLabelDirs = versions
      .map((versionId) => path.join(storageRoot, "object-store-fallback", "objects", "raw-labels", batch.project_id, versionId))
      .filter((dirPath) => fs.existsSync(dirPath));

    const imageBytes = imageFiles.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);

    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      batch,
      labelVersions: versions.length,
      projectImages: projectImages.length,
      exclusiveAssets: exclusiveAssets.length,
      fallbackImageFiles: imageFiles.length,
      fallbackImageBytes: imageBytes,
      rawLabelDirs: rawLabelDirs.length,
    }, null, 2));

    if (!apply) return;

    await client.query("BEGIN");
    await client.query(
      "DELETE FROM image_annotations WHERE label_version_id = ANY($1::uuid[])",
      [versions],
    );
    await client.query("DELETE FROM label_versions WHERE import_batch_id=$1", [batchId]);
    await client.query("DELETE FROM project_images WHERE import_batch_id=$1", [batchId]);
    await client.query("DELETE FROM project_videos WHERE import_batch_id=$1", [batchId]);
    await client.query("DELETE FROM import_batches WHERE id=$1", [batchId]);
    await client.query(
      "DELETE FROM image_assets WHERE id = ANY($1::uuid[])",
      [exclusiveAssets.map((row) => row.id)],
    );
    await client.query("COMMIT");

    for (const filePath of imageFiles) {
      fs.rmSync(filePath, { force: true });
      pruneEmptyDirs(filePath, path.join(storageRoot, "object-store-fallback"));
    }
    for (const dirPath of rawLabelDirs) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      pruneEmptyDirs(dirPath, path.join(storageRoot, "object-store-fallback"));
    }
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
