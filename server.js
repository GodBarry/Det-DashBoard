const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = Number(process.env.PORT || 4177);
const DATA_ROOT = path.resolve(process.env.DATA_ROOT || process.argv[2] || "F:\\ZBH");
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || path.join(DATA_ROOT, "zhuji"));
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  sharp = null;
}

let activeDataset = "";
let datasetRoot = "";
let index = [];
let imageCache = new Map();
let jsonCache = new Map();
let scanWarnings = [];
let scanState = { running: false, phase: "idle", dataset: "", progress: 0, total: 0, current: 0, message: "未扫描", startedAt: null, finishedAt: null };
let exportState = { running: false, phase: "idle", progress: 0, total: 0, current: 0, message: "未导出", outputDir: "", startedAt: null, finishedAt: null };

function sendJson(res, data) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function sendError(res, code, message) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(JSON.stringify({ error: message }));
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listDatasets() {
  ensureDir(DATA_ROOT);
  return fs.readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name.toLowerCase() !== "zhuji")
    .map((entry) => ({ name: entry.name, path: entry.name, fullPath: path.join(DATA_ROOT, entry.name) }));
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    scanWarnings.push(`Skip unreadable directory: ${dir} (${error.message})`);
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".det-dashboard-cache")) walk(full, out);
      } else {
        out.push(full);
      }
    } catch (error) {
      scanWarnings.push(`Skip entry: ${full} (${error.message})`);
    }
  }
  return out;
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function basenameNoExt(file = "") {
  return path.basename(file, path.extname(file)).toLowerCase();
}

function buildImageMaps(images) {
  return {
    byBase: new Map(images.map((file) => [basenameNoExt(file), file])),
    byRel: new Map(images.map((file) => [path.relative(datasetRoot, file).replaceAll("\\", "/").toLowerCase(), file])),
  };
}

function findImageForJson(jsonFile, meta, maps) {
  const jsonDir = path.dirname(jsonFile);
  const candidates = [];
  if (meta.imagePath) {
    candidates.push(path.resolve(jsonDir, meta.imagePath));
    candidates.push(path.resolve(datasetRoot, meta.imagePath));
    candidates.push(path.resolve(datasetRoot, "images", path.basename(meta.imagePath)));
  }
  for (const ext of IMAGE_EXTS) candidates.push(path.join(jsonDir, `${basenameNoExt(jsonFile)}${ext}`));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const rel = meta.imagePath ? meta.imagePath.replaceAll("\\", "/").toLowerCase() : "";
  return maps.byBase.get(basenameNoExt(meta.imagePath || jsonFile)) || maps.byRel.get(rel) || "";
}

function inferModality(meta, imageFile) {
  const text = `${meta.imagePath || ""} ${imageFile || ""} ${meta.keyword || ""}`.toLowerCase();
  if (text.includes("infrared") || text.includes("thermal") || text.includes("_ir") || text.includes("ir_") || text.includes("红外")) return "infrared";
  return "visible";
}

function setScanProgress(patch) {
  scanState = { ...scanState, ...patch };
}

function setExportProgress(patch) {
  exportState = { ...exportState, ...patch };
}

async function scanDataset(datasetName) {
  const targetRoot = path.resolve(DATA_ROOT, datasetName);
  if (!isInsideRoot(DATA_ROOT, targetRoot) || !fs.existsSync(targetRoot)) throw new Error("数据集路径不在服务根目录内");
  activeDataset = datasetName;
  datasetRoot = targetRoot;
  index = [];
  imageCache = new Map();
  jsonCache = new Map();
  scanWarnings = [];
  setScanProgress({ running: true, phase: "walking", dataset: datasetName, progress: 2, total: 0, current: 0, message: "正在扫描文件列表", startedAt: new Date().toISOString(), finishedAt: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const files = walk(datasetRoot);
  const images = files.filter((file) => IMAGE_EXTS.has(path.extname(file).toLowerCase()));
  const jsons = files.filter((file) => path.extname(file).toLowerCase() === ".json");
  const maps = buildImageMaps(images);
  setScanProgress({ phase: "indexing", total: jsons.length, current: 0, progress: 8, message: `发现 ${jsons.length} 个 JSON，正在建立索引` });
  const nextIndex = [];
  const nextImageCache = new Map();
  const nextJsonCache = new Map();
  for (let n = 0; n < jsons.length; n += 1) {
    const jsonFile = jsons[n];
    const meta = safeReadJson(jsonFile);
    if (!meta) {
      scanWarnings.push(`Skip invalid JSON: ${jsonFile}`);
      continue;
    }
    const imageFile = findImageForJson(jsonFile, meta, maps);
    const id = String(nextIndex.length);
    nextImageCache.set(id, imageFile);
    nextJsonCache.set(id, jsonFile);
    nextIndex.push({
      id,
      fileName: path.basename(imageFile || meta.imagePath || jsonFile),
      jsonPath: path.relative(datasetRoot, jsonFile),
      imagePath: meta.imagePath || "",
      imageWidth: meta.imageWidth || 1,
      imageHeight: meta.imageHeight || 1,
      scene: meta.scene || "UnknownScene",
      view: meta.view || "UnknownView",
      keyword: meta.keyword || "",
      modality: inferModality(meta, imageFile),
      shapes: Array.isArray(meta.shapes) ? meta.shapes : [],
      thumbUrl: `/api/thumb/${id}`,
      fullUrl: `/api/image/${id}`,
    });
    if (n % 200 === 0 || n === jsons.length - 1) {
      setScanProgress({ current: n + 1, progress: Math.min(99, 8 + Math.round(((n + 1) / Math.max(1, jsons.length)) * 90)), message: `正在解析标注 ${n + 1} / ${jsons.length}` });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  index = nextIndex;
  imageCache = nextImageCache;
  jsonCache = nextJsonCache;
  setScanProgress({ running: false, phase: "done", progress: 100, current: jsons.length, message: `完成：${index.length} 张图片，${scanWarnings.length} 个警告`, finishedAt: new Date().toISOString() });
}

function filteredItems(query) {
  const modality = query.modality || "all";
  const scene = query.scene || "all";
  const label = query.label || "all";
  const q = String(query.q || "").toLowerCase();
  return index.filter((item) => {
    const labels = item.shapes.map((shape) => shape.label);
    const text = `${item.fileName} ${item.scene} ${item.view} ${labels.join(" ")}`.toLowerCase();
    return (modality === "all" || item.modality === modality) && (scene === "all" || item.scene === scene) && (label === "all" || labels.includes(label)) && text.includes(q);
  });
}

function summary(items = index) {
  return {
    dataRoot: DATA_ROOT,
    storageRoot: STORAGE_ROOT,
    activeDataset,
    datasetRoot,
    imageCount: index.length,
    filteredCount: items.length,
    boxCount: index.reduce((n, item) => n + item.shapes.length, 0),
    visibleCount: index.filter((item) => item.modality === "visible").length,
    infraredCount: index.filter((item) => item.modality === "infrared").length,
    scenes: [...new Set(index.map((item) => item.scene))],
    labels: [...new Set(index.flatMap((item) => item.shapes.map((shape) => shape.label)))],
    warnings: scanWarnings.slice(0, 50),
    warningCount: scanWarnings.length,
    scan: scanState,
    export: exportState,
  };
}

function streamFile(res, imageFile, asThumb) {
  if (!imageFile || !fs.existsSync(imageFile)) return sendError(res, 404, "source image not found");
  const ext = path.extname(imageFile).toLowerCase();
  const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  res.writeHead(200, { "content-type": type, "cache-control": asThumb ? "public, max-age=86400" : "public, max-age=3600", "access-control-allow-origin": "*" });
  fs.createReadStream(imageFile).pipe(res);
}

async function streamThumb(res, id) {
  const imageFile = imageCache.get(String(id));
  if (!imageFile || !fs.existsSync(imageFile)) return sendError(res, 404, "source image not found");
  if (!sharp) return streamFile(res, imageFile, true);
  const thumbDir = path.join(STORAGE_ROOT, "cache", "thumbs");
  ensureDir(thumbDir);
  const stat = fs.statSync(imageFile);
  const cacheName = `${activeDataset || "dataset"}-${id}-${stat.size}-${Math.floor(stat.mtimeMs)}.webp`;
  const cachePath = path.join(thumbDir, cacheName);
  if (!fs.existsSync(cachePath)) {
    await sharp(imageFile).resize({ width: 420, height: 236, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toFile(cachePath);
  }
  res.writeHead(200, { "content-type": "image/webp", "cache-control": "public, max-age=604800, immutable", "access-control-allow-origin": "*" });
  fs.createReadStream(cachePath).pipe(res);
}

function cleanName(value, fallback) {
  const text = String(value || fallback).trim().replace(/\s+/g, "").replace(/[\\/:*?"<>|]/g, "").replace(/[^\w\u4e00-\u9fa5-]+/g, "");
  return text || fallback;
}

function modalityCode(modality) {
  if (modality === "infrared") return "IR";
  if (modality === "visible") return "VIS";
  return cleanName(modality, "UNK").toUpperCase();
}

function exportBaseName(item, sequence) {
  return `${cleanName(item.view, "UnknownView")}_${cleanName(item.scene, "UnknownScene")}_${modalityCode(item.modality)}_${String(sequence).padStart(6, "0")}`;
}

function jsonWithExportPath(meta, item, exportImageName) {
  return {
    version: meta.version || "3.2.3",
    flags: meta.flags || {},
    shapes: Array.isArray(meta.shapes) ? meta.shapes : [],
    imagePath: `../images/${exportImageName}`,
    imageData: null,
    imageHeight: meta.imageHeight || item.imageHeight || 1,
    imageWidth: meta.imageWidth || item.imageWidth || 1,
    description: meta.description || "",
    view: item.view || meta.view || "",
    scene: item.scene || meta.scene || "",
    keyword: item.keyword || meta.keyword || "",
  };
}

async function exportDataset() {
  if (!activeDataset || !index.length) throw new Error("请先选择并扫描数据集");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  const projectName = cleanName(activeDataset, "project");
  const outputDir = path.join(STORAGE_ROOT, "exports", projectName, `export_${stamp}`);
  const imagesDir = path.join(outputDir, "images");
  const jsonsDir = path.join(outputDir, "jsons");
  ensureDir(imagesDir);
  ensureDir(jsonsDir);
  setExportProgress({ running: true, phase: "exporting", progress: 0, total: index.length, current: 0, outputDir, message: "正在导出 dataset/images 和 dataset/jsons", startedAt: new Date().toISOString(), finishedAt: null });
  const usedNames = new Set();
  for (let n = 0; n < index.length; n += 1) {
    const item = index[n];
    const imageFile = imageCache.get(String(item.id));
    const jsonFile = jsonCache.get(String(item.id));
    if (!imageFile || !fs.existsSync(imageFile)) {
      scanWarnings.push(`Export skip missing image: ${item.fileName}`);
      continue;
    }
    const ext = path.extname(imageFile) || ".jpg";
    let baseName = exportBaseName(item, n + 1);
    if (usedNames.has(baseName)) baseName = `${baseName}_${item.id}`;
    usedNames.add(baseName);
    const exportImageName = `${baseName}${ext.toLowerCase()}`;
    fs.copyFileSync(imageFile, path.join(imagesDir, exportImageName));
    const meta = jsonFile ? safeReadJson(jsonFile) || {} : {};
    fs.writeFileSync(path.join(jsonsDir, `${baseName}.json`), JSON.stringify(jsonWithExportPath(meta, item, exportImageName), null, 2), "utf8");
    if (n % 100 === 0 || n === index.length - 1) {
      setExportProgress({ current: n + 1, progress: Math.round(((n + 1) / Math.max(1, index.length)) * 100), message: `正在导出 ${n + 1} / ${index.length}` });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  setExportProgress({ running: false, phase: "done", progress: 100, current: index.length, outputDir, message: `导出完成：${outputDir}`, finishedAt: new Date().toISOString() });
}

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === "/api/datasets") return sendJson(res, { dataRoot: DATA_ROOT, storageRoot: STORAGE_ROOT, datasets: listDatasets() });
  if (parsed.pathname === "/api/scan") {
    if (scanState.running) return sendError(res, 409, "已有扫描任务正在运行");
    const dataset = String(parsed.query.dataset || "");
    scanDataset(dataset).catch((error) => {
      setScanProgress({ running: false, phase: "error", message: error.message, finishedAt: new Date().toISOString() });
      console.error(error);
    });
    return sendJson(res, { ok: true, scan: scanState });
  }
  if (parsed.pathname === "/api/scan/status") return sendJson(res, scanState);
  if (parsed.pathname === "/api/export") {
    if (exportState.running) return sendError(res, 409, "已有导出任务正在运行");
    exportDataset().catch((error) => {
      setExportProgress({ running: false, phase: "error", message: error.message, finishedAt: new Date().toISOString() });
      console.error(error);
    });
    return sendJson(res, { ok: true, export: exportState });
  }
  if (parsed.pathname === "/api/export/status") return sendJson(res, exportState);
  if (parsed.pathname === "/api/summary") return sendJson(res, summary());
  if (parsed.pathname === "/api/items") {
    const page = Math.max(1, Number(parsed.query.page || 1));
    const pageSize = Math.min(200, Math.max(12, Number(parsed.query.pageSize || 48)));
    const items = filteredItems(parsed.query);
    return sendJson(res, { ...summary(items), page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) });
  }
  if (parsed.pathname === "/api/rescan") {
    if (!activeDataset) return sendError(res, 400, "尚未选择数据集");
    scanDataset(activeDataset).catch((error) => {
      setScanProgress({ running: false, phase: "error", message: error.message, finishedAt: new Date().toISOString() });
      console.error(error);
    });
    return sendJson(res, { ok: true, scan: scanState });
  }
  const thumb = parsed.pathname.match(/^\/api\/thumb\/(\d+)/);
  if (thumb) return streamThumb(res, thumb[1]).catch((error) => sendError(res, 500, error.message));
  const image = parsed.pathname.match(/^\/api\/image\/(\d+)/);
  if (image) return streamFile(res, imageCache.get(image[1]), false);
  sendError(res, 404, "not found");
}).listen(PORT, () => {
  ensureDir(STORAGE_ROOT);
  console.log(`Dataset API: http://localhost:${PORT}`);
  console.log(`Data root: ${DATA_ROOT}`);
  console.log(`Storage root: ${STORAGE_ROOT}`);
  console.log(sharp ? "Thumbnail cache: enabled" : "Thumbnail cache: sharp not installed, fallback to original image stream");
});
