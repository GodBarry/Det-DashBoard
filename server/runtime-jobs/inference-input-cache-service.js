function createInferenceInputCacheService({
  query,
  fs,
  path,
  storageRoot,
  writeObjectToFile,
}) {
  function inferenceListParam(source = {}, ...keys) {
    for (const key of keys) {
      const raw = source[key];
      if (!raw || raw === "all") continue;
      if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean);
      const values = String(raw).split(",").map((item) => item.trim()).filter(Boolean);
      if (values.length) return values;
    }
    return [];
  }

  function linkOrCopyFile(source, target, copyOnly = false) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { force: true });
    if (copyOnly) {
      fs.copyFileSync(source, target);
      return;
    }
    try {
      fs.linkSync(source, target);
    } catch {
      try {
        fs.symlinkSync(path.relative(path.dirname(target), source), target);
      } catch {
        fs.copyFileSync(source, target);
      }
    }
  }

  async function ensureImageAssetCache(row) {
    const ext = row.original_ext || path.extname(row.object_key || "") || ".jpg";
    const target = path.join(storageRoot, "runtime", "cache", "assets", "images", `${row.image_asset_id}${ext}`);
    if (!fs.existsSync(target)) await writeObjectToFile(row.object_key, target);
    return target;
  }

  async function prepareInferenceInputCache(job) {
    const paramsJson = typeof job.params_json === "string" ? JSON.parse(job.params_json || "{}") : (job.params_json || {});
    const input = paramsJson.input || {};
    const filters = input.filters || {};
    const sqlParams = [job.dataset_project_id];
    const where = ["pi.project_id=$1", "pi.deleted_at IS NULL", "p.deleted_at IS NULL"];

    const sceneValues = inferenceListParam(filters, "scenes", "scene");
    const viewValues = inferenceListParam(filters, "views", "view");
    const modalityValues = inferenceListParam(filters, "modalities", "modality");
    const importValues = inferenceListParam(filters, "importBatchIds", "importBatchId");
    const labelValues = inferenceListParam(filters, "labels", "label");
    const q = String(filters.q || "").trim();

    if (sceneValues.length) {
      sqlParams.push(sceneValues);
      where.push(`pi.scene = ANY($${sqlParams.length})`);
    }
    if (viewValues.length) {
      sqlParams.push(viewValues);
      where.push(`pi.view = ANY($${sqlParams.length})`);
    }
    if (modalityValues.length) {
      sqlParams.push(modalityValues);
      where.push(`pi.modality = ANY($${sqlParams.length})`);
    }
    if (importValues.length) {
      sqlParams.push(importValues);
      where.push(`pi.import_batch_id = ANY($${sqlParams.length}::uuid[])`);
    }
    if (q) {
      sqlParams.push(`%${q}%`);
      where.push(`(pi.display_name ILIKE $${sqlParams.length} OR pi.scene ILIKE $${sqlParams.length} OR pi.view ILIKE $${sqlParams.length} OR pi.keyword ILIKE $${sqlParams.length})`);
    }
    if (labelValues.length) {
      sqlParams.push(labelValues);
      where.push(`EXISTS (
      SELECT 1 FROM image_annotations a
      JOIN projects p ON p.active_label_version_id = a.label_version_id
      WHERE p.id = pi.project_id AND a.project_image_id = pi.id AND a.label = ANY($${sqlParams.length})
    )`);
    }

    const limit = Math.max(0, Math.min(100000, Number(input.limit || 0)));
    if (limit > 0) sqlParams.push(limit);

    const rows = (await query(
      `SELECT pi.id AS project_image_id, pi.project_id, pi.image_asset_id, pi.import_batch_id, pi.display_name,
            pi.scene, pi.view, pi.modality, pi.keyword,
            ia.object_key, ia.original_ext, ia.width, ia.height, ia.file_size
     FROM project_images pi
     JOIN image_assets ia ON ia.id=pi.image_asset_id
     JOIN projects p ON p.id=pi.project_id
     LEFT JOIN import_batches ib ON ib.id=pi.import_batch_id
     WHERE ${where.join(" AND ")} AND (ib.id IS NULL OR ib.deleted_at IS NULL)
     ORDER BY pi.created_at, pi.id
     ${limit > 0 ? `LIMIT $${sqlParams.length}` : ""}`,
      sqlParams,
    )).rows;
    if (!rows.length) throw new Error("推理输入范围内没有可用图片");

    const preparingParams = {
      ...paramsJson,
      input: { ...input, filters, limit, imageCount: rows.length },
    };
    await query(
      "UPDATE runtime_inference_jobs SET progress=2, params_json=$1, message=$2 WHERE id=$3",
      [JSON.stringify(preparingParams), `Preparing inference input: ${rows.length} images`, job.id],
    );

    const outputRoot = job.output_root || path.join(storageRoot, "runtime", "inference", job.id);
    const cacheRoot = path.join(outputRoot, "input-cache");
    const imagesDir = path.join(cacheRoot, "images");
    const cachePolicy = input.cachePolicy || "reuse_asset_cache";
    fs.mkdirSync(imagesDir, { recursive: true });

    const manifestImages = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const assetPath = await ensureImageAssetCache(row);
      const ext = path.extname(assetPath) || row.original_ext || ".jpg";
      const cachedFileName = `${String(index + 1).padStart(8, "0")}${ext}`;
      const cachedPath = path.join(imagesDir, cachedFileName);
      linkOrCopyFile(assetPath, cachedPath, cachePolicy === "job_copy");
      manifestImages.push({
        index: index + 1,
        projectImageId: row.project_image_id,
        imageAssetId: row.image_asset_id,
        importBatchId: row.import_batch_id,
        objectKey: row.object_key,
        originalFileName: row.display_name,
        cachedFileName,
        localPath: path.join("images", cachedFileName).replaceAll("\\", "/"),
        width: row.width,
        height: row.height,
        scene: row.scene,
        view: row.view,
        modality: row.modality,
        keyword: row.keyword,
      });
    }

    const manifest = {
      jobId: job.id,
      projectId: job.dataset_project_id,
      imageCount: manifestImages.length,
      cacheRoot,
      imagesDir,
      createdAt: new Date().toISOString(),
      images: manifestImages,
    };
    const sourceFilters = {
      sourceType: input.sourceType || "project_images",
      projectId: job.dataset_project_id,
      filters,
      limit,
      cachePolicy,
    };
    fs.writeFileSync(path.join(cacheRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(cacheRoot, "source_filters.json"), JSON.stringify(sourceFilters, null, 2));
    fs.writeFileSync(path.join(cacheRoot, "dataset_meta.json"), JSON.stringify({
      projectId: job.dataset_project_id,
      imageCount: manifestImages.length,
      modalities: Array.from(new Set(manifestImages.map((item) => item.modality).filter(Boolean))),
      scenes: Array.from(new Set(manifestImages.map((item) => item.scene).filter(Boolean))),
      views: Array.from(new Set(manifestImages.map((item) => item.view).filter(Boolean))),
    }, null, 2));

    const nextParams = {
      ...paramsJson,
      input: {
        sourceType: input.sourceType || "project_images",
        filters,
        limit,
        cachePolicy,
        cacheRoot,
        imagesDir,
        manifestPath: path.join(cacheRoot, "manifest.json"),
        imageCount: manifestImages.length,
        preparedAt: manifest.createdAt,
      },
    };
    await query(
      "UPDATE runtime_inference_jobs SET status='pending', progress=5, params_json=$1, message=$2 WHERE id=$3",
      [JSON.stringify(nextParams), `推理输入缓存已准备：${manifestImages.length} 张图片`, job.id],
    );
    return manifest;
  }

  return {
    inferenceListParam,
    linkOrCopyFile,
    ensureImageAssetCache,
    prepareInferenceInputCache,
  };
}

module.exports = { createInferenceInputCacheService };
