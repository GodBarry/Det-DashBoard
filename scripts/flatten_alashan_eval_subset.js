const fs = require("fs");
const path = require("path");

const root = "F:\\ZBH\\阿拉善数据合并-7月训练\\评估_8类映射_2000_20260723025559";
const imageExts = new Set([".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"]);
const targetLabels = new Set(["car", "tank", "zhuangjiache", "fasheche", "hanma", "buzhanche", "kache", "daodanfasheche"]);

function walk(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else output.push(full);
  }
  return output;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeEmptyDirs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) removeEmptyDirs(full);
  }
  const rootKeepDirs = new Set([imagesDir, jsonsDir]);
  if (dir !== root && !rootKeepDirs.has(dir) && fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

function moveUnique(source, targetDir) {
  ensureDir(targetDir);
  const target = path.join(targetDir, path.basename(source));
  if (path.resolve(source) === path.resolve(target)) return target;
  if (fs.existsSync(target)) throw new Error(`Target already exists: ${target}`);
  fs.renameSync(source, target);
  return target;
}

const imagesDir = path.join(root, "images");
const jsonsDir = path.join(root, "jsons");
ensureDir(imagesDir);
ensureDir(jsonsDir);

const allFiles = walk(root);
const imageFiles = allFiles.filter((file) => imageExts.has(path.extname(file).toLowerCase()) && path.dirname(file) !== imagesDir);
const jsonFiles = allFiles.filter((file) => path.extname(file).toLowerCase() === ".json" && path.basename(file) !== "extract-report.json" && path.dirname(file) !== jsonsDir);

const imageNames = new Set();
for (const file of imageFiles) {
  const name = path.basename(file);
  if (imageNames.has(name) || fs.existsSync(path.join(imagesDir, name))) throw new Error(`Duplicate image filename: ${name}`);
  imageNames.add(name);
}

const jsonNames = new Set();
for (const file of jsonFiles) {
  const name = path.basename(file);
  if (jsonNames.has(name) || fs.existsSync(path.join(jsonsDir, name))) throw new Error(`Duplicate json filename: ${name}`);
  jsonNames.add(name);
}

for (const file of imageFiles) moveUnique(file, imagesDir);

const stats = { movedImages: imageFiles.length, movedJsons: 0, rewrittenJsons: 0, invalidLabels: {}, labels: {} };
for (const file of jsonFiles) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const imageName = path.basename(String(doc.imagePath || path.basename(file, ".json") + ".jpg"));
  doc.imagePath = `../images/${imageName}`;
  doc.shapes = (Array.isArray(doc.shapes) ? doc.shapes : []).map((shape) => {
    const label = String(shape.label || "").trim();
    if (!targetLabels.has(label)) stats.invalidLabels[label] = (stats.invalidLabels[label] || 0) + 1;
    stats.labels[label] = (stats.labels[label] || 0) + 1;
    const attributes = { ...(shape.attributes || {}) };
    delete attributes.original_label;
    return { ...shape, label, attributes };
  });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2), "utf8");
  moveUnique(file, jsonsDir);
  stats.movedJsons += 1;
  stats.rewrittenJsons += 1;
}

removeEmptyDirs(root);
fs.writeFileSync(path.join(root, "flatten-report.json"), JSON.stringify({
  root,
  imagesDir,
  jsonsDir,
  ...stats,
  generatedAt: new Date().toISOString(),
}, null, 2), "utf8");

console.log(JSON.stringify({
  root,
  movedImages: stats.movedImages,
  movedJsons: stats.movedJsons,
  labels: stats.labels,
  invalidLabels: stats.invalidLabels,
  report: path.join(root, "flatten-report.json"),
}, null, 2));
