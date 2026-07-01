const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".avi", ".mov", ".mkv", ".wmv"]);
const STRUCTURAL_DATA_DIRS = new Set([
  "image", "images", "img", "imgs", "jpegimage", "jpegimages",
  "json", "jsons", "annotation", "annotations", "label", "labels",
  "train", "training", "val", "valid", "validation", "test", "testing",
  "rgb", "visible", "visiblelight", "infrared", "ir", "thermal",
  "可见光", "红外", "图像", "图片", "标注",
  "data", "dataset", "datasets",
]);

function normalizedDirName(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_.-]+/g, "");
}

function meaningfulSceneName(value) {
  const text = String(value || "").trim();
  const normalized = normalizedDirName(text);
  if (!text || !normalized || normalized === "unknownscene" || STRUCTURAL_DATA_DIRS.has(normalized)) return "";
  return text;
}

function inferSceneFromPath(meta, filePath, sourceRoot) {
  const explicit = meaningfulSceneName(meta?.scene);
  if (explicit) return explicit;

  const root = path.resolve(sourceRoot || path.dirname(filePath));
  let current = path.dirname(path.resolve(filePath));
  const relative = path.relative(root, current);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "UnknownScene";

  while (true) {
    const inferred = meaningfulSceneName(path.basename(current));
    if (inferred) return inferred;
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "UnknownScene";
}

async function inferSceneFromImportRoot(sourceRoot, depth = 0) {
  const inferred = meaningfulSceneName(path.basename(path.resolve(sourceRoot || "")));
  let entries;
  try {
    entries = await fs.promises.readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return "";
  }
  const hasDirectImage = entries.some((entry) => entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()));
  const hasStructuralChild = entries.some((entry) => entry.isDirectory() && STRUCTURAL_DATA_DIRS.has(normalizedDirName(entry.name)));
  if ((hasDirectImage || hasStructuralChild) && inferred) return inferred;

  const meaningfulChildren = entries
    .filter((entry) => entry.isDirectory() && meaningfulSceneName(entry.name))
    .map((entry) => path.join(sourceRoot, entry.name));
  if (depth < 8 && meaningfulChildren.length === 1) {
    return inferSceneFromImportRoot(meaningfulChildren[0], depth + 1);
  }
  return "";
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

async function walkAsync(root, options = {}) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    if (options.shouldStop && await options.shouldStop()) {
      const error = new Error("directory scan cancelled");
      error.code = "SCAN_CANCELLED";
      throw error;
    }
    const dir = pending.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function hashFile(filePath, algorithm = "sha256") {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function quickHash(filePath) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, "r");
  const len = Math.min(1024 * 1024, stat.size);
  const start = Buffer.alloc(len);
  fs.readSync(fd, start, 0, len, 0);
  const end = Buffer.alloc(len);
  fs.readSync(fd, end, 0, len, Math.max(0, stat.size - len));
  fs.closeSync(fd);
  const h = crypto.createHash("sha1");
  h.update(String(stat.size));
  h.update(start);
  h.update(end);
  return h.digest("hex");
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function basenameNoExt(filePath = "") {
  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

function cleanName(value, fallback) {
  const text = String(value || fallback)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "");
  return text || fallback;
}

function modalityCode(modality) {
  if (modality === "infrared") return "IR";
  if (modality === "visible") return "VIS";
  return cleanName(modality, "UNK").toUpperCase();
}

function bboxFromPoints(points = []) {
  const xs = points.map((p) => Number(p[0]));
  const ys = points.map((p) => Number(p[1]));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x, y, width: maxX - x, height: maxY - y };
}

function inferModality(meta, fileName) {
  const text = `${meta.imagePath || ""} ${fileName || ""} ${meta.keyword || ""}`.toLowerCase();
  if (text.includes("infrared") || text.includes("thermal") || text.includes("_ir") || text.includes("ir_") || text.includes("红外")) return "infrared";
  return "visible";
}

function exportBaseName(item, sequence) {
  return `${cleanName(item.view, "UnknownView")}_${cleanName(item.scene, "UnknownScene")}_${modalityCode(item.modality)}_${String(sequence).padStart(6, "0")}`;
}

module.exports = {
  IMAGE_EXTS,
  VIDEO_EXTS,
  walk,
  walkAsync,
  hashFile,
  quickHash,
  safeReadJson,
  basenameNoExt,
  cleanName,
  bboxFromPoints,
  inferModality,
  exportBaseName,
  inferSceneFromPath,
  inferSceneFromImportRoot,
};
