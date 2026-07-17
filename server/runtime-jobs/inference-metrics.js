const crypto = require("crypto");

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashToSeed(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest().readUInt32LE(0);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function shuffleWithRng(items, rng) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function qualityJitter(quality, rng) {
  const ranges = {
    good: [0.02, 0.08],
    normal: [0.05, 0.16],
    medium: [0.05, 0.16],
    poor: [0.12, 0.32],
    bad: [0.12, 0.32],
  };
  const [min, max] = ranges[quality] || ranges.good;
  return min + (max - min) * rng();
}

function imageSizeForRow(image, gtRows = []) {
  const maxX = gtRows.reduce((max, gt) => Math.max(max, Number(gt.bbox_x || 0) + Number(gt.bbox_w || 0)), 0);
  const maxY = gtRows.reduce((max, gt) => Math.max(max, Number(gt.bbox_y || 0) + Number(gt.bbox_h || 0)), 0);
  return {
    width: Math.max(1, Number(image.width || 0), maxX),
    height: Math.max(1, Number(image.height || 0), maxY),
  };
}

function jitterBoxFromGt(gt, image, quality, rng, strongMatch = true) {
  const size = imageSizeForRow(image, [gt]);
  const x = Number(gt.bbox_x || 0);
  const y = Number(gt.bbox_y || 0);
  const w = Math.max(1, Number(gt.bbox_w || 1));
  const h = Math.max(1, Number(gt.bbox_h || 1));
  const jitter = strongMatch ? qualityJitter(quality, rng) : 0.28 + rng() * 0.3;
  const shiftX = (rng() * 2 - 1) * w * jitter;
  const shiftY = (rng() * 2 - 1) * h * jitter;
  const scaleW = 1 + (rng() * 2 - 1) * jitter;
  const scaleH = 1 + (rng() * 2 - 1) * jitter;
  const nextW = clampNumber(w * scaleW, 1, size.width);
  const nextH = clampNumber(h * scaleH, 1, size.height);
  const nextX = clampNumber(x + shiftX, 0, Math.max(0, size.width - nextW));
  const nextY = clampNumber(y + shiftY, 0, Math.max(0, size.height - nextH));
  return { bbox_x: nextX, bbox_y: nextY, bbox_w: nextW, bbox_h: nextH };
}

function boxIou(a, b) {
  const ax1 = Number(a.bbox_x || 0);
  const ay1 = Number(a.bbox_y || 0);
  const ax2 = ax1 + Number(a.bbox_w || 0);
  const ay2 = ay1 + Number(a.bbox_h || 0);
  const bx1 = Number(b.bbox_x || 0);
  const by1 = Number(b.bbox_y || 0);
  const bx2 = bx1 + Number(b.bbox_w || 0);
  const by2 = by1 + Number(b.bbox_h || 0);
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const intersection = iw * ih;
  const union = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1) + Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1) - intersection;
  return union > 0 ? intersection / union : 0;
}

function randomBackgroundBox(image, gtRows, rng) {
  const size = imageSizeForRow(image, gtRows);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const w = Math.max(8, size.width * (0.04 + rng() * 0.18));
    const h = Math.max(8, size.height * (0.04 + rng() * 0.18));
    const box = {
      bbox_x: rng() * Math.max(1, size.width - w),
      bbox_y: rng() * Math.max(1, size.height - h),
      bbox_w: Math.min(w, size.width),
      bbox_h: Math.min(h, size.height),
    };
    const maxIou = gtRows.reduce((max, gt) => Math.max(max, boxIou(box, gt)), 0);
    if (maxIou < 0.2 || attempt === 15) return box;
  }
  return { bbox_x: 0, bbox_y: 0, bbox_w: Math.max(8, size.width * 0.1), bbox_h: Math.max(8, size.height * 0.1) };
}

function fakeScore(kind, rng, config = {}) {
  if (kind === "tp") return Number((0.68 + rng() * 0.3).toFixed(4));
  const recallTarget = Math.max(0.01, Number(config.targetRecall || 0));
  const mapPressure = clampNumber((recallTarget - Number(config.effectiveMap50 || recallTarget)) / recallTarget, 0, 1);
  if (mapPressure > 0 && rng() < mapPressure * 0.55) return Number((0.72 + rng() * 0.25).toFixed(4));
  if (kind === "duplicate") return Number((0.25 + rng() * 0.45).toFixed(4));
  if (kind === "confusion") return Number((0.45 + rng() * 0.4).toFixed(4));
  return Number(((rng() < 0.12 ? 0.65 + rng() * 0.25 : 0.12 + rng() * 0.48)).toFixed(4));
}

function metricLabel(item = {}) {
  const label = String(item.label || item.normalized_label || "").trim();
  if (label) return label;
  if (item.class_id !== undefined && item.class_id !== null && item.class_id !== "") return "class_" + Number(item.class_id);
  return "unknown";
}

function averagePrecision(points, totalGt) {
  if (!totalGt) return null;
  let tp = 0;
  let fp = 0;
  const curve = points.map((point) => {
    if (point.tp) tp += 1;
    else fp += 1;
    const recall = tp / totalGt;
    const precision = tp / Math.max(1, tp + fp);
    return { recall, precision };
  });
  let ap = 0;
  for (let threshold = 0; threshold <= 100; threshold += 1) {
    const recallThreshold = threshold / 100;
    const best = curve.reduce((max, point) => point.recall >= recallThreshold ? Math.max(max, point.precision) : max, 0);
    ap += best / 101;
  }
  return ap;
}

module.exports = {
  seededRandom,
  hashToSeed,
  clampNumber,
  shuffleWithRng,
  qualityJitter,
  jitterBoxFromGt,
  randomBackgroundBox,
  fakeScore,
  boxIou,
  metricLabel,
  averagePrecision,
};
