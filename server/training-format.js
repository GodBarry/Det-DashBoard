function normalizeProjectIdList(value) {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeTrainingDatasetSplits(body = {}, params = {}, fallbackTrainProjectId = null) {
  const requested = body.datasetSplits || body.dataset_splits || params.datasetSplits || {};
  const read = (name) => normalizeProjectIdList(
    body[`${name}ProjectIds`] || body[`${name}_project_ids`]
      || requested[`${name}ProjectIds`] || requested[`${name}_project_ids`]
      || body[`${name}ProjectId`] || body[`${name}_project_id`]
      || requested[`${name}ProjectId`] || requested[`${name}_project_id`]
      || (name === "train" ? fallbackTrainProjectId : null),
  );
  return { trainProjectIds: read("train"), valProjectIds: read("val"), testProjectIds: read("test") };
}

function normalizeTrainingDatasetFilters(body = {}, params = {}) {
  const requested = body.datasetFilters || body.dataset_filters || params.datasetFilters || params.dataset_filters || {};
  const list = (value) => [...new Set((Array.isArray(value) ? value : String(value || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean))];
  const normalize = (filter = {}) => ({
    scenes: list(filter.scenes || filter.scene),
    views: list(filter.views || filter.view),
    modalities: list(filter.modalities || filter.modality),
    labels: list(filter.labels || filter.label),
    keywords: list(filter.keywords || filter.keyword),
  });
  return { train: normalize(requested.train), val: normalize(requested.val), test: normalize(requested.test) };
}

function trainingImageMatchesFilter(image, annotations = [], filter = {}) {
  const includes = (values, value) => !values?.length || values.includes(String(value || ""));
  if (!includes(filter.scenes, image.scene)) return false;
  if (!includes(filter.views, image.view)) return false;
  if (!includes(filter.modalities, image.modality)) return false;
  if (filter.keywords?.length && !filter.keywords.some((value) => String(image.keyword || "").toLowerCase().includes(value.toLowerCase()))) return false;
  if (filter.labels?.length && !annotations.some((annotation) => filter.labels.includes(String(annotation.label || "")))) return false;
  return true;
}

function yamlScalar(value) {
  return JSON.stringify(String(value ?? ""));
}

function yoloClassLine(ann, width, height, labelIndex) {
  const x = Number(ann.bbox_x || 0);
  const y = Number(ann.bbox_y || 0);
  const w = Number(ann.bbox_w || 0);
  const h = Number(ann.bbox_h || 0);
  const cx = (x + w / 2) / Math.max(1, Number(width || 1));
  const cy = (y + h / 2) / Math.max(1, Number(height || 1));
  return [
    labelIndex,
    Math.max(0, Math.min(1, cx)).toFixed(8),
    Math.max(0, Math.min(1, cy)).toFixed(8),
    Math.max(0, Math.min(1, w / Math.max(1, Number(width || 1)))).toFixed(8),
    Math.max(0, Math.min(1, h / Math.max(1, Number(height || 1)))).toFixed(8),
  ].join(" ");
}

function parseMetricLine(line) {
  const metrics = [];
  const patterns = [
    ["box_loss", /box_loss[=: ]+([0-9.]+)/i],
    ["cls_loss", /cls_loss[=: ]+([0-9.]+)/i],
    ["dfl_loss", /dfl_loss[=: ]+([0-9.]+)/i],
    ["map50", /mAP50(?:\S*)?[=: ]+([0-9.]+)/i],
  ];
  for (const [key, regex] of patterns) {
    const match = String(line).match(regex);
    if (match) metrics.push({ key, value: Number(match[1]) });
  }
  return metrics;
}

module.exports = {
  normalizeProjectIdList,
  normalizeTrainingDatasetSplits,
  normalizeTrainingDatasetFilters,
  trainingImageMatchesFilter,
  yamlScalar,
  yoloClassLine,
  parseMetricLine,
};
