function createImportService(deps) {
  const {
    query,
    transaction,
    accessControl,
    resourceAccess,
    lifecycle,
    fs,
    path,
    sharp,
    store,
    IMAGE_EXTS,
    VIDEO_EXTS,
    walk,
    walkAsync,
    hashFile,
    quickHash,
    inferModality,
    inferSceneFromPath,
    cleanName,
    buildDatasetMatches,
    imageKey,
    shapeToBox,
    imageObjectKey,
    videoObjectKey,
    rawLabelObjectKey,
    discoverDatasetSplitPlan,
    splitForImage,
    serializeSplitPlan,
    toInternalDataPath,
    toDisplayDataPath,
    httpError,
    logger = console,
    defer = setImmediate,
    now = Date.now,
  } = deps;

  async function ensureSplitProjects(parentProject, splitPlan, ownerUserId = parentProject.owner_user_id) {
    if (!splitPlan) return {};
    const ids = {};
    for (const split of ["train", "val", "test"]) {
      const entry = splitPlan[split];
      if (!entry.files.size && !entry.directories.size) continue;
      let row = (await query(
        "SELECT id FROM projects WHERE parent_id=$1 AND lower(name)=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
        [parentProject.id, split],
      )).rows[0];
      if (!row) row = (await query(
        "INSERT INTO projects (name, description, project_type, parent_id, owner_user_id, visibility) VALUES ($1,$2,'dataset_split',$3,$4,'private') RETURNING id",
        [split, `${parentProject.name} ${split} split`, parentProject.id, ownerUserId],
      )).rows[0];
      await accessControl.ensureAssetOwner({ id: ownerUserId }, "project", row.id);
      ids[split] = row.id;
    }
    return ids;
  }

  async function upsertImageAsset(client, filePath, meta = {}) {
    const stat = fs.statSync(filePath);
    const qh = quickHash(filePath);
    const sha = await hashFile(filePath);
    const ext = path.extname(filePath).toLowerCase() || ".jpg";
    let width = Number(meta.imageWidth) || null;
    let height = Number(meta.imageHeight) || null;
    if (!width || !height) {
      try {
        const imageMeta = await sharp(filePath).metadata();
        width = width || Number(imageMeta.width) || null;
        height = height || Number(imageMeta.height) || null;
      } catch {}
    }
    const existing = await client.query("SELECT * FROM image_assets WHERE sha256=$1", [sha]);
    if (existing.rows[0]) {
      let row = existing.rows[0];
      const storedSize = await store.objectSize(row.object_key);
      if (storedSize !== Number(row.file_size || stat.size)) await store.putFile(row.object_key, filePath);
      if ((!row.width && width) || (!row.height && height)) {
        row = (await client.query(
          "UPDATE image_assets SET width=COALESCE(width,$1), height=COALESCE(height,$2) WHERE id=$3 RETURNING *",
          [width, height, row.id],
        )).rows[0];
      }
      return row;
    }
    const objectKey = imageObjectKey(sha, ext);
    await store.putFile(objectKey, filePath);
    const inserted = await client.query(
      `INSERT INTO image_assets (sha256, quick_hash, object_key, original_ext, width, height, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sha, qh, objectKey, ext, width, height, stat.size],
    );
    return inserted.rows[0];
  }

  async function upsertVideoAsset(client, filePath) {
    const stat = fs.statSync(filePath);
    const qh = quickHash(filePath);
    const sha = await hashFile(filePath);
    const ext = path.extname(filePath).toLowerCase() || ".mp4";
    const existing = await client.query("SELECT * FROM video_assets WHERE sha256=$1", [sha]);
    if (existing.rows[0]) return existing.rows[0];
    const objectKey = videoObjectKey(sha, ext);
    await store.putFile(objectKey, filePath);
    const inserted = await client.query(
      `INSERT INTO video_assets (sha256, quick_hash, object_key, original_ext, file_size)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [sha, qh, objectKey, ext, stat.size],
    );
    return inserted.rows[0];
  }

  async function importPath(body, actor) {
    const projectId = body.projectId;
    if (!projectId) throw new Error("projectId is required");
    await resourceAccess.assertProjectWrite(actor, projectId);
    if (lifecycle.isShuttingDown()) {
      const error = new Error("Service is shutting down and cannot accept new imports.");
      error.statusCode = 503;
      throw error;
    }
    const rawSourcePaths = Array.isArray(body.sourcePaths)
      ? body.sourcePaths
      : String(body.sourcePath || "").split(";").map((item) => item.trim()).filter(Boolean);
    const sourcePaths = Array.from(new Set(rawSourcePaths.map((item) => toInternalDataPath(item)).filter(Boolean)));
    if (!sourcePaths.length) throw httpError(400, "No dataset folder path was selected.");
    for (const sourcePath of sourcePaths) {
      if (!fs.existsSync(sourcePath)) throw httpError(400, "Import path does not exist: " + sourcePath);
      if (!fs.statSync(sourcePath).isDirectory()) throw httpError(400, "Import path must be a folder: " + sourcePath);
    }
    body.sourcePath = sourcePaths[0];
    body.sourcePaths = sourcePaths;
    const manifestGroups = sourcePaths.map((sourceRoot) => ({ sourceRoot, files: walk(sourceRoot) }));
    const splitPlan = discoverDatasetSplitPlan(manifestGroups);
    body.splitPlan = splitPlan;

    const { project, batch } = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [String(projectId)]);
      const projectRow = (await client.query("SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL", [projectId])).rows[0];
      if (!projectRow) throw new Error("project not found");
      const active = (await client.query(
        "SELECT id FROM import_batches WHERE project_id=$1 AND deleted_at IS NULL AND status IN ('scanning','running','cancel_requested') LIMIT 1",
        [projectId],
      )).rows[0];
      if (active) {
        const error = new Error("An import task is already running for this project.");
        error.statusCode = 409;
        throw error;
      }
      const batchRow = (await client.query(
        `INSERT INTO import_batches (project_id, source_path, import_mode, source_type, status, total_files, processed_files, message)
         VALUES ($1,$2,'merge_project','server_path','scanning',0,0,$3) RETURNING *`,
        [projectId, sourcePaths.map((sourcePath) => toDisplayDataPath(sourcePath)).join(";"), "正在扫描文件"],
      )).rows[0];
      return { project: projectRow, batch: batchRow };
    });
    await resourceAccess.assignOwner("import_batches", batch.id, actor);
    const splitProjectIds = await ensureSplitProjects(project, splitPlan, actor.id);
    body.actorId = actor.id;
    body.splitProjectIds = splitProjectIds;

    const importTask = new Promise((resolve) => defer(resolve))
      .then(() => runImportBatch(batch.id, project, body))
      .catch(async (error) => {
        logger.error("import failed", error);
        await query(
          "UPDATE import_batches SET status='failed', message=$1, finished_at=now() WHERE id=$2",
          [error.message || "导入失败", batch.id],
        ).catch(() => {});
      });
    lifecycle.trackImport(importTask);

    return { project, batch, splitResult: serializeSplitPlan(splitPlan, splitProjectIds, toDisplayDataPath) };
  }

  async function importCancelled(batchId) {
    if (lifecycle.isShuttingDown()) return true;
    const row = (await query("SELECT status FROM import_batches WHERE id=$1", [batchId])).rows[0];
    return !row || row.status === "cancel_requested" || row.status === "cancelled" || row.status === "deleted";
  }

  async function cancelImport(importId) {
    await query(
      "UPDATE import_batches SET status='cancel_requested', message=$1 WHERE id=$2 AND status IN ('scanning','running')",
      ["正在取消导入", importId],
    );
  }

  async function runImportBatch(batchId, project, body) {
    const projectId = project.id;
    const sourceRoots = Array.from(new Set((Array.isArray(body.sourcePaths) && body.sourcePaths.length ? body.sourcePaths : [body.sourcePath])
      .map((item) => path.resolve(item || ""))
      .filter(Boolean)));
    let lastCancellationCheck = 0;
    const sourceGroups = [];
    try {
      for (const sourceRoot of sourceRoots) {
        const files = await walkAsync(sourceRoot, {
          shouldStop: async () => {
            if (lifecycle.isShuttingDown()) return true;
            const currentTime = now();
            if (currentTime - lastCancellationCheck < 500) return false;
            lastCancellationCheck = currentTime;
            return importCancelled(batchId);
          },
        });
        const images = files.filter((file) => IMAGE_EXTS.has(path.extname(file).toLowerCase()));
        const videos = files.filter((file) => VIDEO_EXTS.has(path.extname(file).toLowerCase()));
        const parsed = buildDatasetMatches({ files, images, sourceRoot });
        sourceGroups.push({ sourceRoot, files, images, videos, ...parsed });
      }
    } catch (error) {
      if (error.code !== "SCAN_CANCELLED") throw error;
      await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["Import cancelled", batchId]);
      return;
    }
    const images = sourceGroups.flatMap((group) => group.images.map((file) => ({ file, sourceRoot: group.sourceRoot, matches: group.matches })));
    const videos = sourceGroups.flatMap((group) => group.videos.map((file) => ({ file, sourceRoot: group.sourceRoot })));
    const unresolved = sourceGroups.flatMap((group) => group.unresolved || []);
    const usedLabelFiles = sourceGroups.flatMap((group) => (group.usedLabelFiles || []).map((file) => ({ file, sourceRoot: group.sourceRoot })));
    const formatCounts = sourceGroups.reduce((acc, group) => {
      acc.labelme += group.formatCounts?.labelme || 0;
      acc.coco += group.formatCounts?.coco || 0;
      acc.yolo += group.formatCounts?.yolo || 0;
      acc.voc += group.formatCounts?.voc || 0;
      return acc;
    }, { labelme: 0, coco: 0, yolo: 0, voc: 0 });
    const splitPlan = body.splitPlan || discoverDatasetSplitPlan(sourceGroups);
    const splitProjectIds = Object.keys(body.splitProjectIds || {}).length
      ? body.splitProjectIds
      : await ensureSplitProjects(project, splitPlan, body.actorId || project.owner_user_id);
    const splitResult = serializeSplitPlan(splitPlan, splitProjectIds, toDisplayDataPath);

    await query(
      "UPDATE import_batches SET status='running', total_files=$1, processed_files=0, message=$2 WHERE id=$3",
      [images.length + videos.length, `扫描完成：${images.length} 图片，${videos.length} 视频；LabelMe ${formatCounts.labelme}，COCO ${formatCounts.coco}，YOLO ${formatCounts.yolo}`, batchId],
    );
    if (await importCancelled(batchId)) {
      await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["Import cancelled", batchId]);
      return;
    }

    const client = { query };
    const targetProjectIds = Array.from(new Set([projectId, ...Object.values(splitProjectIds)]));
    const versionsByProject = new Map();
    for (const targetProjectId of targetProjectIds) {
      const version = (await query(
        `INSERT INTO label_versions (project_id, name, target_type, status, import_batch_id)
         VALUES ($1,$2,'image','active',$3) RETURNING *`,
        [targetProjectId, body.labelVersionName || `import_${new Date().toISOString()}`, batchId],
      )).rows[0];
      await resourceAccess.assignOwner("label_versions", version.id, { id: body.actorId || project.owner_user_id });
      versionsByProject.set(String(targetProjectId), version);
      await query("UPDATE projects SET active_label_version_id=$1, updated_at=now() WHERE id=$2", [version.id, targetProjectId]);
    }

    for (const item of usedLabelFiles) {
      const relative = path.relative(item.sourceRoot, item.file).replace(/\.\.(?:[\\/]|$)/g, "").replace(/[\\/]+/g, "__");
      for (const [targetProjectId, version] of versionsByProject) {
        await store.putFile(rawLabelObjectKey(targetProjectId, version.id, relative || path.basename(item.file)), item.file);
      }
    }

    let imageCount = 0;
    let annCount = 0;
    let unlabeledImageCount = 0;
    const actualSplitCounts = { train: 0, val: 0, test: 0 };
    for (const imageEntry of images) {
      const imageFile = imageEntry.file;
      if (imageCount % 5 === 0 && await importCancelled(batchId)) {
        await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["Import cancelled", batchId]);
        return;
      }
      const matched = imageEntry.matches.get(imageKey(imageFile));
      const split = splitForImage(imageFile, splitPlan);
      if (split && Object.prototype.hasOwnProperty.call(actualSplitCounts, split)) actualSplitCounts[split] += 1;
      const targetProjectId = splitProjectIds[split] || projectId;
      const version = versionsByProject.get(String(targetProjectId));
      const meta = matched?.meta || {};
      const scene = inferSceneFromPath(meta, imageFile, imageEntry.sourceRoot);
      const asset = await upsertImageAsset(client, imageFile, meta);
      const modality = inferModality(meta, imageFile);
      const displayName = body.rename
        ? `${cleanName(meta.view, "UnknownView")}_${cleanName(scene, "UnknownScene")}_${modality === "infrared" ? "IR" : "VIS"}_${String(imageCount + 1).padStart(6, "0")}${path.extname(imageFile).toLowerCase()}`
        : path.basename(imageFile);
      const projectImage = await upsertProjectImage(client, {
        projectId: targetProjectId,
        imageAssetId: asset.id,
        importBatchId: batchId,
        displayName,
        sourcePath: toDisplayDataPath(imageFile),
        scene,
        view: meta.view || "UnknownView",
        modality,
        keyword: meta.keyword || "",
      });
      const shapes = Array.isArray(meta.shapes) ? meta.shapes : [];
      if (!shapes.length) unlabeledImageCount += 1;
      for (const shape of shapes) {
        const box = shapeToBox(shape, asset.width, asset.height);
        if (!box) {
          unresolved.push({ labelFile: matched?.labelFile || "", reason: "invalid_shape", imageFile });
          continue;
        }
        await client.query(
          `INSERT INTO image_annotations
           (label_version_id, project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h, shape_type, difficult, score, attributes_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [version.id, projectImage.id, shape.label || "unknown", box.x, box.y, box.width, box.height, shape.shape_type || "rectangle", Boolean(shape.difficult), shape.score, shape.attributes || {}],
        );
        annCount += 1;
      }
      imageCount += 1;
      if (imageCount % 5 === 0 || imageCount === images.length) {
        await query("UPDATE import_batches SET processed_files=$1, message=$2 WHERE id=$3", [imageCount, `正在导入图片 ${imageCount} / ${images.length}`, batchId]);
      }
    }

    let videoCount = 0;
    for (const videoEntry of videos) {
      const videoFile = videoEntry.file;
      if (await importCancelled(batchId)) {
        await query("UPDATE import_batches SET status='cancelled', message=$1, finished_at=now() WHERE id=$2", ["Import cancelled", batchId]);
        return;
      }
      const asset = await upsertVideoAsset(client, videoFile);
      await query(
        `INSERT INTO project_videos (project_id, video_asset_id, import_batch_id, display_name, source_path, label_status)
         VALUES ($1,$2,$3,$4,$5,'unlabeled')`,
        [projectId, asset.id, batchId, path.basename(videoFile), toDisplayDataPath(videoFile)],
      );
      videoCount += 1;
      await query("UPDATE import_batches SET processed_files=$1, message=$2 WHERE id=$3", [images.length + videoCount, `正在导入视频 ${videoCount} / ${videos.length}`, batchId]);
    }

    for (const [splitName, value] of Object.entries(splitResult.splits || {})) {
      value.plannedImages = value.listedImages;
      value.listedImages = actualSplitCounts[splitName] || 0;
      value.importedImages = actualSplitCounts[splitName] || 0;
    }
    const splitMessage = splitResult.detected
      ? `；划分 ${Object.entries(splitResult.splits).map(([name, value]) => `${name}:${value.listedImages}`).join("，")}`
      : "";
    const message = `导入完成：${imageCount} 图片，${unlabeledImageCount} 无目标图片，${videoCount} 视频，${annCount} 标注，${unresolved.length} 条警告；LabelMe ${formatCounts.labelme}，COCO ${formatCounts.coco}，YOLO ${formatCounts.yolo}${splitMessage}`;
    await query("UPDATE import_batches SET status='done', processed_files=$1, message=$2, finished_at=now() WHERE id=$3", [images.length + videos.length, message, batchId]);
  }

  async function upsertProjectImage(client, image) {
    const params = [
      image.projectId,
      image.imageAssetId,
      image.importBatchId,
      image.displayName,
      image.sourcePath || "",
      image.scene,
      image.view,
      image.modality,
      image.keyword,
    ];
    const upsertSql = `
      INSERT INTO project_images (project_id, image_asset_id, import_batch_id, display_name, source_path, scene, view, modality, keyword)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (project_id, image_asset_id, display_name)
      DO UPDATE SET
        import_batch_id=EXCLUDED.import_batch_id,
        source_path=EXCLUDED.source_path,
        scene=EXCLUDED.scene,
        view=EXCLUDED.view,
        modality=EXCLUDED.modality,
        keyword=EXCLUDED.keyword,
        deleted_at=NULL
      RETURNING *`;
    try {
      return (await client.query(upsertSql, params)).rows[0];
    } catch (error) {
      if (error.code !== "23505" || error.constraint !== "idx_project_images_unique_asset") throw error;
      return (await client.query(
        `UPDATE project_images
         SET import_batch_id=$3,
             source_path=$5,
             scene=$6,
             view=$7,
             modality=$8,
             keyword=$9,
             deleted_at=NULL
         WHERE project_id=$1 AND image_asset_id=$2 AND display_name=$4
         RETURNING *`,
        params,
      )).rows[0];
    }
  }

  async function listImports(projectId, trash = false) {
    const result = await query(
      `SELECT *,
        CASE WHEN total_files > 0 THEN round((processed_files::numeric / total_files::numeric) * 100)::int ELSE 0 END AS progress
       FROM import_batches
       WHERE project_id=$1 AND ${trash ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"}
       ORDER BY created_at DESC`,
      [projectId],
    );
    return result.rows;
  }

  async function softDeleteProjectImages(projectId, ids = []) {
    const uniqueIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
    if (!uniqueIds.length) return { deleted: 0 };
    const result = await query(
      `UPDATE project_images
       SET deleted_at=now()
       WHERE project_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
       RETURNING id`,
      [projectId, uniqueIds],
    );
    return { deleted: result.rows.length };
  }

  return {
    ensureSplitProjects,
    upsertImageAsset,
    upsertVideoAsset,
    importPath,
    importCancelled,
    cancelImport,
    runImportBatch,
    upsertProjectImage,
    listImports,
    softDeleteProjectImages,
  };
}

module.exports = { createImportService };
