function createDatasetContentService({
  query,
  transaction,
  store,
  resourceAccess,
  lifecycle,
  fs,
  path,
  sharp,
  storageRoot,
  exportRoot,
  exportRootDisplay,
  cleanName,
  exportBaseName,
  normalizeExportFormat,
  labelmeDocument,
  cocoDocument,
  yoloDocuments,
  sendError,
}) {
  const imageVariantTasks = new Map();

  async function saveImageAnnotations(projectImageId, body = {}, actor) {
    const image = (await query(
      `SELECT pi.*, ia.width AS image_width, ia.height AS image_height, p.active_label_version_id, p.id AS project_id
       FROM project_images pi
       JOIN image_assets ia ON ia.id = pi.image_asset_id
       JOIN projects p ON p.id = pi.project_id
       WHERE pi.id=$1 AND pi.deleted_at IS NULL AND p.deleted_at IS NULL`,
      [projectImageId],
    )).rows[0];
    if (!image) throw new Error("image not found");

    let labelVersionId = image.active_label_version_id;
    if (!labelVersionId) {
      const version = (await query(
        `INSERT INTO label_versions (project_id, name, target_type, status)
         VALUES ($1,$2,'image','active') RETURNING *`,
        [image.project_id, `manual_${new Date().toISOString()}`],
      )).rows[0];
      labelVersionId = version.id;
      await resourceAccess.assignOwner("label_versions", labelVersionId, actor);
      await query("UPDATE projects SET active_label_version_id=$1, updated_at=now() WHERE id=$2", [labelVersionId, image.project_id]);
    }

    const maxW = Number(image.image_width || 1);
    const maxH = Number(image.image_height || 1);
    const annotations = Array.isArray(body.annotations) ? body.annotations : [];
    const clean = annotations.map((ann) => {
      const x = Math.max(0, Math.min(maxW - 1, Number(ann.bbox_x || 0)));
      const y = Math.max(0, Math.min(maxH - 1, Number(ann.bbox_y || 0)));
      const w = Math.max(1, Math.min(maxW - x, Number(ann.bbox_w || 1)));
      const h = Math.max(1, Math.min(maxH - y, Number(ann.bbox_h || 1)));
      return {
        label: String(ann.label || "").trim() || "unknown",
        bbox_x: x,
        bbox_y: y,
        bbox_w: w,
        bbox_h: h,
        shape_type: ann.shape_type || "rectangle",
        difficult: Boolean(ann.difficult),
        score: ann.score == null ? null : Number(ann.score),
        attributes_json: ann.attributes_json || ann.attributes || {},
      };
    });

    return transaction(async (client) => {
      await client.query("DELETE FROM image_annotations WHERE label_version_id=$1 AND project_image_id=$2", [labelVersionId, projectImageId]);
      const saved = [];
      for (const ann of clean) {
        const row = (await client.query(
          `INSERT INTO image_annotations
           (label_version_id, project_image_id, label, bbox_x, bbox_y, bbox_w, bbox_h, shape_type, difficult, score, attributes_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [labelVersionId, projectImageId, ann.label, ann.bbox_x, ann.bbox_y, ann.bbox_w, ann.bbox_h, ann.shape_type, ann.difficult, ann.score, ann.attributes_json],
        )).rows[0];
        saved.push(row);
      }
      await client.query("UPDATE projects SET updated_at=now() WHERE id=$1", [image.project_id]);
      return { annotations: saved };
    });
  }

  async function listProjectImages(projectId, queryParams) {
    const page = Math.max(1, Number(queryParams.page || 1));
    const pageSize = Math.min(200, Math.max(12, Number(queryParams.pageSize || 48)));
    const offset = (page - 1) * pageSize;
    const params = [projectId];
    const where = ["pi.project_id=$1", "pi.deleted_at IS NULL"];

    const listParam = (...keys) => {
      for (const key of keys) {
        const raw = queryParams[key];
        if (!raw || raw === "all") continue;
        const values = String(raw).split(",").map((item) => item.trim()).filter(Boolean);
        if (values.length) return values;
      }
      return [];
    };

    const sceneValues = listParam("scenes", "scene");
    const viewValues = listParam("views", "view");
    const modalityValues = listParam("modalities", "modality");
    const labelValues = listParam("labels", "label");
    const importValues = listParam("importBatchIds", "importBatchId");
    const q = String(queryParams.q || "").trim();

    if (sceneValues.length) {
      params.push(sceneValues);
      where.push(`pi.scene = ANY($${params.length})`);
    }
    if (viewValues.length) {
      params.push(viewValues);
      where.push(`pi.view = ANY($${params.length})`);
    }
    if (modalityValues.length) {
      params.push(modalityValues);
      where.push(`pi.modality = ANY($${params.length})`);
    }
    if (importValues.length) {
      params.push(importValues);
      where.push(`pi.import_batch_id = ANY($${params.length}::uuid[])`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(pi.display_name ILIKE $${params.length} OR pi.scene ILIKE $${params.length} OR pi.view ILIKE $${params.length} OR pi.keyword ILIKE $${params.length})`);
    }
    if (labelValues.length) {
      params.push(labelValues);
      where.push(`EXISTS (
        SELECT 1 FROM image_annotations a
        JOIN projects p ON p.active_label_version_id = a.label_version_id
        WHERE p.id = pi.project_id AND p.deleted_at IS NULL AND a.project_image_id = pi.id AND a.label = ANY($${params.length})
      )`);
    }
    params.push(pageSize, offset);
    const rows = await query(
      `SELECT pi.*, ia.width AS image_width, ia.height AS image_height, ia.object_key,
        COALESCE(NULLIF(pi.source_path, ''),
          CASE WHEN ib.source_path IS NOT NULL THEN regexp_replace(ib.source_path, '/+$', '') || '/' || pi.display_name ELSE pi.display_name END
        ) AS absolute_path,
        (SELECT count(*)::int FROM image_annotations a
         JOIN projects p ON p.active_label_version_id = a.label_version_id
         WHERE p.id = pi.project_id AND p.deleted_at IS NULL AND a.project_image_id = pi.id) AS annotation_count
       FROM project_images pi
       JOIN projects p ON p.id = pi.project_id
       JOIN image_assets ia ON ia.id = pi.image_asset_id
       LEFT JOIN import_batches ib ON ib.id = pi.import_batch_id
       WHERE ${where.join(" AND ")} AND (ib.id IS NULL OR ib.deleted_at IS NULL)
       ORDER BY pi.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const count = await query(
      `SELECT count(*)::int AS count
       FROM project_images pi
       JOIN projects p ON p.id = pi.project_id
       LEFT JOIN import_batches ib ON ib.id = pi.import_batch_id
       WHERE ${where.join(" AND ")} AND (ib.id IS NULL OR ib.deleted_at IS NULL)`,
      params.slice(0, -2),
    );

    const items = rows.rows;
    if (!items.length) return { page, pageSize, total: count.rows[0].count, items };

    const annParams = [projectId, items.map((item) => item.id)];
    const annWhere = ["p.id=$1", "p.deleted_at IS NULL", "a.project_image_id = ANY($2::uuid[])"];
    if (labelValues.length) {
      annParams.push(labelValues);
      annWhere.push(`a.label = ANY($${annParams.length})`);
    }
    const annotations = await query(
      `SELECT a.id, a.project_image_id, a.label, a.bbox_x, a.bbox_y, a.bbox_w, a.bbox_h, a.shape_type, a.difficult, a.score
       FROM image_annotations a
       JOIN projects p ON p.active_label_version_id = a.label_version_id
       WHERE ${annWhere.join(" AND ")}
       ORDER BY a.id`,
      annParams,
    );
    const byImage = new Map();
    for (const ann of annotations.rows) {
      const key = String(ann.project_image_id);
      if (!byImage.has(key)) byImage.set(key, []);
      byImage.get(key).push(ann);
    }
    return { page, pageSize, total: count.rows[0].count, items: items.map((item) => ({ ...item, annotations: byImage.get(String(item.id)) || [] })) };
  }

  async function writeStreamToFile(stream, target) {
    await new Promise((resolve, reject) => {
      const write = fs.createWriteStream(target);
      stream.pipe(write);
      write.on("finish", resolve);
      write.on("error", reject);
      stream.on?.("error", reject);
    });
  }

  function normalizedImageVariant(variant, options = {}) {
    if (variant === true || variant === "thumb") return { name: "thumb", width: 420, height: 236, quality: 72 };
    if (variant === "preview") {
      const requested = Number(options.size || 1920);
      const width = [1280, 1920, 2560].includes(requested) ? requested : 1920;
      return { name: "preview", width, height: null, quality: 82 };
    }
    return { name: "full" };
  }

  async function ensureImageVariant(row, config) {
    const cacheKey = config.name === "thumb"
      ? `cache/thumbs/images/${row.id}.webp`
      : `cache/previews/images/${row.id}-${config.width}.webp`;
    if (await store.objectExists(cacheKey)) return cacheKey;
    if (imageVariantTasks.has(cacheKey)) return imageVariantTasks.get(cacheKey);

    const task = (async () => {
      const tempDir = path.join(storageRoot, "tmp", "image-variants");
      fs.mkdirSync(tempDir, { recursive: true });
      const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const src = path.join(tempDir, `${row.id}-${nonce}${row.original_ext || ".jpg"}`);
      const out = path.join(tempDir, `${row.id}-${config.name}-${config.width}-${nonce}.webp`);
      try {
        await writeStreamToFile(await store.getStream(row.object_key), src);
        const resize = config.height
          ? { width: config.width, height: config.height, fit: "inside", withoutEnlargement: true }
          : { width: config.width, fit: "inside", withoutEnlargement: true };
        await sharp(src).rotate().resize(resize).webp({ quality: config.quality, effort: 4 }).toFile(out);
        await store.putFile(cacheKey, out, { "content-type": "image/webp" });
        return cacheKey;
      } finally {
        fs.rmSync(src, { force: true });
        fs.rmSync(out, { force: true });
      }
    })().finally(() => imageVariantTasks.delete(cacheKey));
    imageVariantTasks.set(cacheKey, task);
    return task;
  }

  async function streamProjectImage(res, projectImageId, variant = "full", options = {}) {
    const result = await query(
      `SELECT pi.id AS project_image_id, ia.*
       FROM project_images pi JOIN image_assets ia ON ia.id=pi.image_asset_id
       WHERE pi.id=$1 AND pi.deleted_at IS NULL`,
      [projectImageId],
    );
    const row = result.rows[0];
    if (!row) return sendError(res, 404, "image not found");
    const config = normalizedImageVariant(variant, options);
    if (config.name === "full") {
      const stream = await store.getStream(row.object_key);
      res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "private, max-age=3600" });
      stream.pipe(res);
      return;
    }
    const cacheKey = await ensureImageVariant(row, config);
    const stream = await store.getStream(cacheKey);
    res.writeHead(200, {
      "content-type": "image/webp",
      "cache-control": "private, max-age=604800, immutable",
      "x-image-variant": `${config.name}-${config.width}`,
    });
    stream.pipe(res);
  }

  async function exportProject(projectId, options = {}, actor) {
    if (lifecycle.isShuttingDown()) {
      const error = new Error("服务正在关闭，暂不接受新的导出任务");
      error.statusCode = 503;
      throw error;
    }
    const format = normalizeExportFormat(options.format);
    if (!format) {
      const error = new Error("导出格式仅支持 labelme、coco 或 yolo");
      error.statusCode = 400;
      throw error;
    }
    const project = (await query("SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL", [projectId])).rows[0];
    if (!project) throw new Error("project not found");
    fs.mkdirSync(exportRoot, { recursive: true });
    const job = (await query("INSERT INTO jobs (type,status,progress,payload,message,started_at) VALUES ('export','running',0,$1,$2,now()) RETURNING *", [{ projectId, outputPath: exportRootDisplay, format }, `正在导出 ${format.toUpperCase()}`])).rows[0];

    await resourceAccess.assignOwner("jobs", job.id, actor);
    const exportTask = new Promise((resolve) => setImmediate(resolve))
      .then(() => runExportProject(project, job, format))
      .catch(async (error) => {
        console.error("export failed", error);
        await query(
          "UPDATE jobs SET status='failed', message=$1, finished_at=now() WHERE id=$2",
          [error.message || "导出失败", job.id],
        ).catch(() => {});
      });
    lifecycle.trackExport(exportTask);

    return { jobId: job.id, status: job.status, outputRoot: exportRootDisplay, format };
  }

  async function runExportProject(project, job, format) {
    const projectId = project.id;
    const rows = (await query(
      `SELECT pi.*, ia.object_key, ia.original_ext, ia.width, ia.height
       FROM project_images pi JOIN image_assets ia ON ia.id=pi.image_asset_id
       WHERE pi.project_id=$1 AND pi.deleted_at IS NULL ORDER BY pi.created_at`,
      [projectId],
    )).rows;
    const annotationRows = project.active_label_version_id && rows.length
      ? (await query(
        "SELECT * FROM image_annotations WHERE label_version_id=$1 AND project_image_id = ANY($2::uuid[]) ORDER BY id",
        [project.active_label_version_id, rows.map((row) => row.id)],
      )).rows
      : [];
    const annotationsByImage = new Map();
    for (const annotation of annotationRows) {
      if (!annotationsByImage.has(annotation.project_image_id)) annotationsByImage.set(annotation.project_image_id, []);
      annotationsByImage.get(annotation.project_image_id).push(annotation);
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const exportPrefix = `exports/${project.id}/${format}_${stamp}`;
    const localRoot = path.join(exportRoot, `${cleanName(project.name, "dataset")}_${format}_${stamp}`);
    const displayLocalRoot = path.join(exportRootDisplay, path.basename(localRoot));
    const localImagesDir = path.join(localRoot, "images");
    const localLabelsDir = path.join(localRoot, format === "labelme" ? "jsons" : format === "coco" ? "annotations" : "labels");
    const tempDir = path.join(storageRoot, "tmp", job.id);
    fs.mkdirSync(localImagesDir, { recursive: true });
    fs.mkdirSync(localLabelsDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });
    const entries = [];
    try {
      for (let i = 0; i < rows.length; i += 1) {
        const item = rows[i];
        const base = exportBaseName(item, i + 1);
        const ext = item.original_ext || ".jpg";
        const exportImageName = `${base}${ext}`;
        const exportLabelName = format === "yolo" ? `${base}.txt` : format === "coco" ? "instances.json" : `${base}.json`;
        const imageStream = await store.getStream(item.object_key);
        const tempImage = path.join(tempDir, exportImageName);
        await new Promise((resolve, reject) => {
          const write = fs.createWriteStream(tempImage);
          imageStream.pipe(write);
          write.on("finish", resolve);
          write.on("error", reject);
        });
        await store.putFile(`${exportPrefix}/images/${exportImageName}`, tempImage);
        fs.copyFileSync(tempImage, path.join(localImagesDir, exportImageName));
        const annotations = annotationsByImage.get(item.id) || [];
        entries.push({ item, annotations, imageName: exportImageName, labelName: exportLabelName });
        if (format === "labelme") {
          const document = labelmeDocument(item, annotations, exportImageName);
          await store.putJson(`${exportPrefix}/jsons/${exportLabelName}`, document);
          fs.writeFileSync(path.join(localLabelsDir, exportLabelName), JSON.stringify(document, null, 2), "utf8");
        }
        await query("INSERT INTO export_items (job_id, project_image_id, export_image_name, export_json_name) VALUES ($1,$2,$3,$4)", [job.id, item.id, exportImageName, exportLabelName]);
        await query("UPDATE jobs SET progress=$1, message=$2 WHERE id=$3", [Math.round(((i + 1) / Math.max(1, rows.length)) * 95), `导出 ${format.toUpperCase()} ${i + 1}/${rows.length}`, job.id]);
      }

      if (format === "coco") {
        const document = cocoDocument(entries);
        const target = path.join(localLabelsDir, "instances.json");
        fs.writeFileSync(target, JSON.stringify(document, null, 2), "utf8");
        await store.putJson(`${exportPrefix}/annotations/instances.json`, document);
      } else if (format === "yolo") {
        const documents = yoloDocuments(entries);
        for (const [name, content] of documents.labelFiles) {
          const target = path.join(localLabelsDir, name);
          fs.writeFileSync(target, content, "utf8");
          await store.putFile(`${exportPrefix}/labels/${name}`, target);
        }
        const yamlTarget = path.join(localRoot, "data.yaml");
        fs.writeFileSync(yamlTarget, documents.dataYaml, "utf8");
        await store.putFile(`${exportPrefix}/data.yaml`, yamlTarget);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    const message = `${format.toUpperCase()} 导出完成：${displayLocalRoot}`;
    await query("UPDATE jobs SET status='done', progress=100, message=$1, finished_at=now() WHERE id=$2", [message, job.id]);
    return { jobId: job.id, exportPrefix, outputDir: displayLocalRoot };
  }

  return { saveImageAnnotations, listProjectImages, streamProjectImage, exportProject };
}

module.exports = { createDatasetContentService };
