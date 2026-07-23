const fs = require("fs");
const path = require("path");

const ROOT = "F:\\ZBH\\阿拉善数据合并-7月训练";
const SCENES = ["沙漠", "山地", "城市", "草地"];
const STAMP = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
const MAX_IMAGES = 2000;
const MAX_IMAGES_PER_SCENE = Math.ceil(MAX_IMAGES / SCENES.length);
const OUTPUT_ROOT = path.join(ROOT, `评估_8类映射_${MAX_IMAGES}_${STAMP}`);
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"];

const mapping = {
  car: "car",
  Car: "car",
  minyongxiaoche: "car",
  pika: "car",
  pikache: "car",
  suv: "car",
  tank: "tank",
  Tank: "tank",
  tanke: "tank",
  zhuangjiache: "zhuangjiache",
  "Infantry chariots": "zhuangjiache",
  lunshibuzhanche: "zhuangjiache",
  lvdaibuzhanche: "zhuangjiache",
  fasheche: "fasheche",
  "120yuanhuo-fasheche": "fasheche",
  fasheche_leiting: "fasheche",
  fasheche_haimasi: "fasheche",
  "Armoured Launch Vehicle": "fasheche",
  "Towed Launch Vehicle": "fasheche",
  hanma: "hanma",
  haimasi: "hanma",
  buzhanche: "buzhanche",
  kache: "kache",
  minyongkache: "kache",
  Truck: "kache",
  truck: "kache",
  junyongkache: "kache",
  daodanfasheche: "daodanfasheche",
  "hongjian10-buzhanfasheche": "daodanfasheche",
  TianGong_DaoDanFaSheChe: "daodanfasheche",
  LuJianII_FangKongDaoDan: "daodanfasheche",
  XiongFengDaoDanChe: "daodanfasheche",
  XiongFengDaoDanChea: "daodanfasheche",
  LuJianII_FangKongDaoDanw: "daodanfasheche",
};

const ignore = new Set([
  "mosaic", "kachepao", "gaoshepao", "ren", "35gai-zixinggaopao", "No", "zhihuiche",
  "35mmQianYinGaoPao", "FengYanLeiDa", "huojianpao small", "Fighter", "huojianpao",
  "Bus", "35gai-zixinggaopaocar", "liudanpao", "Airplane", "1", "Engineering",
  "Towed Artillery", "tuituji", "huopao", "bus", "minyongche", "qingsaoche",
  "bache", "babiao", "yunshuche", "keche", "mianbaoche", "qitache", "zhangpeng",
  "yongshiche", "ZhiHuiChe", "qiaoliang", "leida", "no", "tank_turret", "Person",
  "Tent", "target", "diaobao", "truck_yunbingche", "Bunker", "chuyouguan",
  "gongchengche", "pingbanche", "mingyongxiaoche", "Oilcan", "person",
  "lunshizixinghuopao", "Radar", "manultarget", "Launch Truck", "huosanlun",
  "junyongyueye", "truck_buleiche", "minyongdache", "Helicopter", "dianpingche",
  "yiweike", "lvdaizixinghuopao", "boat", "TianKongWeiShiLeiDa", "td-babiao",
  "Towed Radar", "radar", "35gai-zixinggaopaocard", "huodanlun",
]);

function walk(dir, matcher, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, matcher, output);
    else if (matcher(full)) output.push(full);
  }
  return output;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function findImage(jsonPath, doc) {
  const jsonDir = path.dirname(jsonPath);
  const candidates = [];
  if (doc.imagePath) {
    candidates.push(path.resolve(jsonDir, String(doc.imagePath)));
    candidates.push(path.resolve(jsonDir, "..", "images", path.basename(String(doc.imagePath))));
  }
  const stem = path.basename(jsonPath, path.extname(jsonPath));
  for (const ext of IMAGE_EXTS) candidates.push(path.resolve(jsonDir, "..", "images", `${stem}${ext}`));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function mappedShape(shape, stats) {
  const sourceLabel = String(shape?.label || "").trim();
  if (!sourceLabel) {
    stats.emptyLabel += 1;
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(mapping, sourceLabel)) {
    const target = mapping[sourceLabel];
    stats.keptShapes += 1;
    stats.targets[target] = (stats.targets[target] || 0) + 1;
    stats.sources[sourceLabel] = (stats.sources[sourceLabel] || 0) + 1;
    return {
      ...shape,
      label: target,
      attributes: {
        ...(shape.attributes || {}),
        original_label: sourceLabel,
      },
    };
  }
  if (ignore.has(sourceLabel)) {
    stats.ignoredShapes += 1;
    stats.ignored[sourceLabel] = (stats.ignored[sourceLabel] || 0) + 1;
  } else {
    stats.unknownShapes += 1;
    stats.unknown[sourceLabel] = (stats.unknown[sourceLabel] || 0) + 1;
  }
  return null;
}

function copyPair(jsonPath, imagePath, doc, keptShapes) {
  const relJson = path.relative(ROOT, jsonPath);
  const relParts = relJson.split(path.sep);
  const jsonsIndex = relParts.lastIndexOf("jsons");
  const relBase = jsonsIndex >= 0 ? relParts.slice(0, jsonsIndex).join(path.sep) : path.dirname(relJson);
  const outJsonDir = path.join(OUTPUT_ROOT, relBase, "jsons");
  const outImageDir = path.join(OUTPUT_ROOT, relBase, "images");
  ensureDir(outJsonDir);
  ensureDir(outImageDir);
  const outImageName = path.basename(imagePath);
  const outJson = {
    ...doc,
    shapes: keptShapes,
    imagePath: outImageName,
    evaluation_extract: {
      source_json: jsonPath,
      source_image: imagePath,
      mapping_targets: Array.from(new Set(Object.values(mapping))),
      generated_at: new Date().toISOString(),
    },
  };
  fs.copyFileSync(imagePath, path.join(outImageDir, outImageName));
  fs.writeFileSync(path.join(outJsonDir, path.basename(jsonPath)), JSON.stringify(outJson, null, 2), "utf8");
}

function topEntries(table, limit = 20) {
  return Object.entries(table).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

const stats = {
  outputRoot: OUTPUT_ROOT,
  scannedJson: 0,
  keptImages: 0,
  skippedNoMapping: 0,
  missingImage: 0,
  parseErrors: 0,
  keptShapes: 0,
  ignoredShapes: 0,
  unknownShapes: 0,
  emptyLabel: 0,
  byScene: {},
  targets: {},
  sources: {},
  ignored: {},
  unknown: {},
  errors: [],
};

for (const scene of SCENES) {
  if (stats.keptImages >= MAX_IMAGES) break;
  const sceneRoot = path.join(ROOT, scene);
  const sceneStats = stats.byScene[scene] = { scannedJson: 0, keptImages: 0, keptShapes: 0, skippedNoMapping: 0, missingImage: 0, parseErrors: 0 };
  const jsonFiles = walk(sceneRoot, (file) => path.extname(file).toLowerCase() === ".json" && file.split(path.sep).includes("jsons"));
  for (const jsonPath of jsonFiles) {
    if (stats.keptImages >= MAX_IMAGES) break;
    if (sceneStats.keptImages >= MAX_IMAGES_PER_SCENE) break;
    stats.scannedJson += 1;
    sceneStats.scannedJson += 1;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (error) {
      stats.parseErrors += 1;
      sceneStats.parseErrors += 1;
      stats.errors.push({ file: jsonPath, error: error.message });
      continue;
    }
    const keptShapes = (Array.isArray(doc.shapes) ? doc.shapes : []).map((shape) => mappedShape(shape, stats)).filter(Boolean);
    if (!keptShapes.length) {
      stats.skippedNoMapping += 1;
      sceneStats.skippedNoMapping += 1;
      continue;
    }
    const imagePath = findImage(jsonPath, doc);
    if (!imagePath) {
      stats.missingImage += 1;
      sceneStats.missingImage += 1;
      stats.errors.push({ file: jsonPath, error: "image not found" });
      continue;
    }
    copyPair(jsonPath, imagePath, doc, keptShapes);
    stats.keptImages += 1;
    stats.byScene[scene].keptImages += 1;
    stats.byScene[scene].keptShapes += keptShapes.length;
  }
}

const report = {
  ...stats,
  topSources: topEntries(stats.sources),
  topIgnored: topEntries(stats.ignored),
  topUnknown: topEntries(stats.unknown),
};
ensureDir(OUTPUT_ROOT);
fs.writeFileSync(path.join(OUTPUT_ROOT, "extract-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({
  outputRoot: OUTPUT_ROOT,
  maxImages: MAX_IMAGES,
  maxImagesPerScene: MAX_IMAGES_PER_SCENE,
  scannedJson: stats.scannedJson,
  keptImages: stats.keptImages,
  keptShapes: stats.keptShapes,
  skippedNoMapping: stats.skippedNoMapping,
  missingImage: stats.missingImage,
  parseErrors: stats.parseErrors,
  targets: stats.targets,
  byScene: stats.byScene,
  report: path.join(OUTPUT_ROOT, "extract-report.json"),
}, null, 2));
