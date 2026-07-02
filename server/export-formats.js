const YAML = require("yaml");

const EXPORT_FORMATS = new Set(["labelme", "coco", "yolo"]);

function normalizeExportFormat(value) {
  const format = String(value || "labelme").trim().toLowerCase();
  return EXPORT_FORMATS.has(format) ? format : "";
}

function boxPoints(annotation) {
  const x = Number(annotation.bbox_x) || 0;
  const y = Number(annotation.bbox_y) || 0;
  const width = Number(annotation.bbox_w) || 0;
  const height = Number(annotation.bbox_h) || 0;
  return [[x, y], [x + width, y + height]];
}

function labelmeDocument(item, annotations, imageName) {
  return {
    version: "5.5.0",
    flags: {},
    shapes: annotations.map((annotation) => ({
      label: annotation.label,
      score: annotation.score == null ? null : Number(annotation.score),
      points: boxPoints(annotation),
      group_id: null,
      description: "",
      difficult: Boolean(annotation.difficult),
      shape_type: annotation.shape_type || "rectangle",
      flags: {},
      attributes: annotation.attributes_json || {},
      kie_linking: [],
    })),
    imagePath: `../images/${imageName}`,
    imageData: null,
    imageHeight: Number(item.height) || 1,
    imageWidth: Number(item.width) || 1,
    description: "",
    view: item.view || "",
    scene: item.scene || "",
    keyword: item.keyword || "",
  };
}

function sortedLabels(entries) {
  return [...new Set(entries.flatMap((entry) => entry.annotations.map((annotation) => String(annotation.label || "unknown"))))]
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function cocoDocument(entries) {
  const labels = sortedLabels(entries);
  const categoryIds = new Map(labels.map((label, index) => [label, index + 1]));
  const images = [];
  const annotations = [];
  let annotationId = 1;
  entries.forEach((entry, imageIndex) => {
    const imageId = imageIndex + 1;
    images.push({
      id: imageId,
      file_name: entry.imageName,
      width: Number(entry.item.width) || 1,
      height: Number(entry.item.height) || 1,
      scene: entry.item.scene || "",
      view: entry.item.view || "",
      keyword: entry.item.keyword || "",
    });
    entry.annotations.forEach((annotation) => {
      const x = Number(annotation.bbox_x) || 0;
      const y = Number(annotation.bbox_y) || 0;
      const width = Math.max(0, Number(annotation.bbox_w) || 0);
      const height = Math.max(0, Number(annotation.bbox_h) || 0);
      annotations.push({
        id: annotationId,
        image_id: imageId,
        category_id: categoryIds.get(String(annotation.label || "unknown")),
        bbox: [x, y, width, height],
        area: width * height,
        iscrowd: annotation.difficult ? 1 : 0,
        score: annotation.score == null ? undefined : Number(annotation.score),
        attributes: annotation.attributes_json || {},
      });
      annotationId += 1;
    });
  });
  return {
    info: { description: "Exported by Det-DashBoard", version: "1.0", date_created: new Date().toISOString() },
    licenses: [],
    images,
    annotations,
    categories: labels.map((name, index) => ({ id: index + 1, name, supercategory: "" })),
  };
}

function yoloLine(annotation, width, height, labelIndex) {
  const imageWidth = Number(width);
  const imageHeight = Number(height);
  if (!imageWidth || !imageHeight) return "";
  const classId = labelIndex.get(String(annotation.label || "unknown"));
  if (classId == null) return "";
  const x = Number(annotation.bbox_x) || 0;
  const y = Number(annotation.bbox_y) || 0;
  const boxWidth = Math.max(0, Number(annotation.bbox_w) || 0);
  const boxHeight = Math.max(0, Number(annotation.bbox_h) || 0);
  const centerX = (x + boxWidth / 2) / imageWidth;
  const centerY = (y + boxHeight / 2) / imageHeight;
  return [classId, centerX, centerY, boxWidth / imageWidth, boxHeight / imageHeight]
    .map((value, index) => index === 0 ? value : Math.max(0, Math.min(1, value)).toFixed(6))
    .join(" ");
}

function yoloDocuments(entries) {
  const labels = sortedLabels(entries);
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const labelFiles = new Map();
  for (const entry of entries) {
    const lines = entry.annotations
      .map((annotation) => yoloLine(annotation, entry.item.width, entry.item.height, labelIndex))
      .filter(Boolean);
    labelFiles.set(entry.labelName, `${lines.join("\n")}${lines.length ? "\n" : ""}`);
  }
  const dataYaml = YAML.stringify({ path: ".", train: "images", val: "images", names: Object.fromEntries(labels.map((label, index) => [index, label])) });
  return { labels, labelFiles, dataYaml };
}

module.exports = {
  EXPORT_FORMATS,
  normalizeExportFormat,
  labelmeDocument,
  cocoDocument,
  yoloLine,
  yoloDocuments,
};
