const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { IMAGE_EXTS, safeReadJson, basenameNoExt } = require("./utils");

function normalizedPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function imageKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function createImageIndex(images, sourceRoot) {
  const absolute = new Map();
  const byName = new Map();
  const relative = [];
  for (const image of images) {
    const resolved = path.resolve(image);
    absolute.set(imageKey(resolved), resolved);
    const name = normalizedPath(path.basename(resolved));
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(resolved);
    relative.push({ file: resolved, value: normalizedPath(path.relative(sourceRoot, resolved)) });
  }
  return { absolute, byName, relative, sourceRoot: path.resolve(sourceRoot) };
}

function findImage(index, reference, labelDir) {
  if (!reference) return "";
  const ref = String(reference).replace(/\\/g, path.sep);
  const candidates = [
    path.resolve(labelDir, ref),
    path.resolve(labelDir, "..", ref),
    path.resolve(index.sourceRoot, ref),
    path.resolve(index.sourceRoot, "images", ref),
  ];
  for (const candidate of candidates) {
    const found = index.absolute.get(imageKey(candidate));
    if (found) return found;
  }

  const normalizedRef = normalizedPath(reference);
  const suffixMatches = index.relative.filter((item) => item.value === normalizedRef || item.value.endsWith(`/${normalizedRef}`));
  if (suffixMatches.length === 1) return suffixMatches[0].file;
  const nameMatches = index.byName.get(normalizedPath(path.basename(ref))) || [];
  return nameMatches.length === 1 ? nameMatches[0] : "";
}

function cocoShape(annotation, label) {
  const bbox = Array.isArray(annotation.bbox) ? annotation.bbox.map(Number) : [];
  if (bbox.length < 4 || bbox.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = bbox;
  if (width < 0 || height < 0) return null;
  return {
    label,
    points: [[x, y], [x + width, y + height]],
    shape_type: "rectangle",
    difficult: Boolean(annotation.iscrowd),
    score: Number.isFinite(Number(annotation.score)) ? Number(annotation.score) : null,
    attributes: {
      source_format: "coco",
      coco_annotation_id: annotation.id ?? null,
      area: annotation.area ?? width * height,
      iscrowd: Number(annotation.iscrowd || 0),
      segmentation: annotation.segmentation || [],
    },
  };
}

function addMatch(matches, imageFile, match, unresolved) {
  const key = imageKey(imageFile);
  const existing = matches.get(key);
  if (!existing || match.priority > existing.priority) {
    if (existing) unresolved.push({ labelFile: existing.labelFile, reason: "lower_priority_duplicate", imageFile });
    matches.set(key, match);
    return;
  }
  unresolved.push({ labelFile: match.labelFile, reason: "duplicate_annotation", imageFile });
}

function parseLabelMe(jsonFiles, index, matches, unresolved, usedLabelFiles) {
  let count = 0;
  for (const jsonFile of jsonFiles) {
    const meta = safeReadJson(jsonFile);
    if (!meta || !Array.isArray(meta.shapes)) continue;
    const candidates = [
      meta.imagePath && findImage(index, meta.imagePath, path.dirname(jsonFile)),
      findImage(index, `${basenameNoExt(jsonFile)}.jpg`, path.dirname(jsonFile)),
      findImage(index, `${basenameNoExt(jsonFile)}.jpeg`, path.dirname(jsonFile)),
      findImage(index, `${basenameNoExt(jsonFile)}.png`, path.dirname(jsonFile)),
      findImage(index, `${basenameNoExt(jsonFile)}.webp`, path.dirname(jsonFile)),
      findImage(index, `${basenameNoExt(jsonFile)}.bmp`, path.dirname(jsonFile)),
    ].filter(Boolean);
    const imageFile = candidates[0] || "";
    if (!imageFile) {
      unresolved.push({ labelFile: jsonFile, reason: "labelme_image_not_found" });
      continue;
    }
    addMatch(matches, imageFile, { labelFile: jsonFile, meta, format: "labelme", priority: 30 }, unresolved);
    usedLabelFiles.add(jsonFile);
    count += 1;
  }
  return count;
}

function parseCoco(jsonFiles, index, matches, unresolved, usedLabelFiles) {
  let count = 0;
  for (const jsonFile of jsonFiles) {
    const document = safeReadJson(jsonFile);
    if (!document || !Array.isArray(document.images) || !Array.isArray(document.annotations) || !Array.isArray(document.categories)) continue;
    const categories = new Map(document.categories.map((category) => [String(category.id), String(category.name || category.id)]));
    const annotations = new Map();
    for (const annotation of document.annotations) {
      const key = String(annotation.image_id);
      if (!annotations.has(key)) annotations.set(key, []);
      const shape = cocoShape(annotation, categories.get(String(annotation.category_id)) || String(annotation.category_id));
      if (shape) annotations.get(key).push(shape);
      else unresolved.push({ labelFile: jsonFile, reason: "invalid_coco_bbox", annotationId: annotation.id ?? null });
    }
    for (const image of document.images) {
      const imageFile = findImage(index, image.file_name, path.dirname(jsonFile));
      if (!imageFile) {
        unresolved.push({ labelFile: jsonFile, reason: "coco_image_not_found", imageName: image.file_name });
        continue;
      }
      const meta = {
        imagePath: image.file_name,
        imageWidth: Number(image.width) || null,
        imageHeight: Number(image.height) || null,
        scene: image.scene || image.attributes?.scene || "",
        view: image.view || image.attributes?.view || "",
        keyword: image.keyword || image.attributes?.keyword || "",
        shapes: annotations.get(String(image.id)) || [],
      };
      addMatch(matches, imageFile, { labelFile: jsonFile, meta, format: "coco", priority: 20 }, unresolved);
      count += 1;
    }
    usedLabelFiles.add(jsonFile);
  }
  return count;
}

function readYoloNames(files) {
  const yamlFiles = files.filter((file) => /(^|[\\/])(data|dataset)\.ya?ml$/i.test(file));
  for (const file of yamlFiles) {
    try {
      const value = YAML.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(value?.names)) return value.names.map(String);
      if (value?.names && typeof value.names === "object") {
        return Object.entries(value.names)
          .sort(([left], [right]) => Number(left) - Number(right))
          .map(([, name]) => String(name));
      }
    } catch {}
  }
  const namesFile = files.find((file) => /\.names$/i.test(file));
  if (!namesFile) return [];
  try {
    return fs.readFileSync(namesFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function yoloLabelPath(imageFile, sourceRoot, textFiles) {
  const textSet = new Map(textFiles.map((file) => [imageKey(file), file]));
  const relative = path.relative(sourceRoot, imageFile);
  const segments = relative.split(path.sep);
  const imageDirIndex = segments.findIndex((segment) => /^(images?|imgs?|jpegimages)$/i.test(segment));
  const candidates = [];
  if (imageDirIndex >= 0) {
    const labelSegments = [...segments];
    labelSegments[imageDirIndex] = "labels";
    labelSegments[labelSegments.length - 1] = `${basenameNoExt(imageFile)}.txt`;
    candidates.push(path.resolve(sourceRoot, ...labelSegments));
  }
  candidates.push(path.join(path.dirname(imageFile), `${basenameNoExt(imageFile)}.txt`));
  candidates.push(path.resolve(sourceRoot, "labels", `${basenameNoExt(imageFile)}.txt`));
  return candidates.map((candidate) => textSet.get(imageKey(candidate))).find(Boolean) || "";
}

function yoloShape(line, names, labelFile, lineNumber) {
  const values = line.trim().split(/\s+/).map(Number);
  if (values.length < 5 || values.some((value) => !Number.isFinite(value))) return null;
  const classId = Math.trunc(values[0]);
  if (classId < 0) return null;
  let points;
  if (values.length === 5) {
    const [, cx, cy, width, height] = values;
    points = [[cx - width / 2, cy - height / 2], [cx + width / 2, cy + height / 2]];
  } else if ((values.length - 1) % 2 === 0) {
    const xs = [];
    const ys = [];
    for (let index = 1; index < values.length; index += 2) {
      xs.push(values[index]);
      ys.push(values[index + 1]);
    }
    points = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  } else {
    return null;
  }
  return {
    label: names[classId] || `class_${classId}`,
    points,
    normalized: true,
    shape_type: "rectangle",
    difficult: false,
    attributes: { source_format: "yolo", class_id: classId, label_file: labelFile, line: lineNumber },
  };
}

function parseYolo(files, images, sourceRoot, matches, unresolved, usedLabelFiles) {
  const textFiles = files.filter((file) => path.extname(file).toLowerCase() === ".txt");
  if (!textFiles.length) return 0;
  const names = readYoloNames(files);
  let count = 0;
  for (const imageFile of images) {
    const labelFile = yoloLabelPath(imageFile, sourceRoot, textFiles);
    if (!labelFile) continue;
    let lines;
    try {
      lines = fs.readFileSync(labelFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    } catch {
      unresolved.push({ labelFile, reason: "unreadable_yolo_label" });
      continue;
    }
    const shapes = [];
    lines.forEach((line, index) => {
      const shape = yoloShape(line, names, labelFile, index + 1);
      if (shape) shapes.push(shape);
      else unresolved.push({ labelFile, reason: "invalid_yolo_line", line: index + 1 });
    });
    addMatch(matches, imageFile, {
      labelFile,
      meta: { imagePath: path.basename(imageFile), shapes },
      format: "yolo",
      priority: 10,
    }, unresolved);
    usedLabelFiles.add(labelFile);
    count += 1;
  }
  return count;
}

function buildDatasetMatches({ files, images, sourceRoot }) {
  const jsonFiles = files.filter((file) => path.extname(file).toLowerCase() === ".json");
  const index = createImageIndex(images, sourceRoot);
  const matches = new Map();
  const unresolved = [];
  const usedLabelFiles = new Set();
  const formatCounts = {
    coco: parseCoco(jsonFiles, index, matches, unresolved, usedLabelFiles),
    labelme: parseLabelMe(jsonFiles, index, matches, unresolved, usedLabelFiles),
  };
  formatCounts.yolo = parseYolo(files, images, sourceRoot, matches, unresolved, usedLabelFiles);
  for (const jsonFile of jsonFiles) {
    if (!usedLabelFiles.has(jsonFile)) unresolved.push({ labelFile: jsonFile, reason: "unsupported_json" });
  }
  return { matches, unresolved, usedLabelFiles: [...usedLabelFiles], formatCounts };
}

function shapeToBox(shape, width, height) {
  if (!shape || !Array.isArray(shape.points) || shape.points.length < 2) return null;
  const points = shape.points.map((point) => [Number(point?.[0]), Number(point?.[1])]);
  if (points.some((point) => point.some((value) => !Number.isFinite(value)))) return null;
  const scaleX = shape.normalized ? Number(width) : 1;
  const scaleY = shape.normalized ? Number(height) : 1;
  if (shape.normalized && (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0)) return null;
  const xs = points.map((point) => point[0] * scaleX);
  const ys = points.map((point) => point[1] * scaleY);
  const maxWidth = Number(width) || Infinity;
  const maxHeight = Number(height) || Infinity;
  const x1 = Math.max(0, Math.min(...xs));
  const y1 = Math.max(0, Math.min(...ys));
  const x2 = Math.min(maxWidth, Math.max(...xs));
  const y2 = Math.min(maxHeight, Math.max(...ys));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

module.exports = {
  buildDatasetMatches,
  createImageIndex,
  findImage,
  imageKey,
  readYoloNames,
  shapeToBox,
};
