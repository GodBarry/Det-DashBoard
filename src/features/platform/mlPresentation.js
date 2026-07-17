import { colors, formatDateTime } from "../../shared/presentation.js";

export function modelFamilyLabel(name = "") {
  const text = String(name || "").trim();
  const yolo = text.match(/\bYOLOv?(\d+)[nslmx]?\b/i) || text.match(/\byolov?(\d+)[nslmx]?\b/i);
  if (yolo) return `YOLOv${yolo[1]}`;
  if (/rt[-_ ]?detr/i.test(text)) return "RT-DETR";
  if (/pp[-_ ]?yoloe/i.test(text)) return "PP-YOLOE";
  return text || "未命名模型簇";
}

export function envTooltip(env = {}) {
  return [
    `环境：${env.name || "未命名环境"}`,
    `创建时间：${formatDateTime(env.created_at)}`,
    `Python：${env.python_version || "未检测"}`,
    `Torch：${env.torch_version || "未检测"}`,
    `加速：${env.cuda_available ? `CUDA ${env.cuda_version || ""}` : (env.accelerator || "CPU").toUpperCase()}`,
  ].join("\n");
}

export function versionTooltip(version = {}) {
  const params = parseMaybeJson(version.params_json);
  const inferredEpoch = String(version.version_name || "").match(/epoch[_-]?(\d+)/i)?.[1];
  const epochText = version.training_current_epoch != null
    ? `${version.training_current_epoch}/${version.training_total_epochs || "--"}`
    : (params.epoch ?? inferredEpoch ?? "未记录");

  return [
    `模型：${version.model_name || "未命名模型"}`,
    `版本：${version.version_name || "未命名版本"}`,
    `来源任务：${version.training_job_name || (version.training_job_id ? version.training_job_id : "手动登记/预训练")}`,
    `训练数据集：${version.dataset_project_name || "未绑"}`,
    `训练轮次：${epochText}`,
    `模型阶段：${version.stage || "未记录"}`,
    `生成时间：${formatDateTime(version.created_at)}`,
  ].join("\n");
}

export function bestAssetLink(assetLinks = [], algorithmId = "") {
  return assetLinks
    .filter((link) => !algorithmId || link.algorithm_asset_id === algorithmId)
    .slice()
    .sort((a, b) => {
      const countDelta = Number(b.success_count || 0) - Number(a.success_count || 0);
      if (countDelta) return countDelta;
      return new Date(b.last_success_at || 0) - new Date(a.last_success_at || 0);
    })[0] || null;
}

export function projectTreeRows(projects = []) {
  const byParent = new Map();
  for (const project of projects) {
    const key = project.parent_id || "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(project);
  }

  const rows = [];
  const visit = (parentId = "", depth = 0) => {
    for (const project of byParent.get(parentId) || []) {
      rows.push({ ...project, depth, hasChildren: Boolean((byParent.get(project.id) || []).length) });
      if (depth < 2) visit(project.id, depth + 1);
    }
  };

  visit();
  return rows;
}

export function predictionLegend(previewItems = []) {
  const labels = [];
  for (const item of previewItems) {
    const predictions = Array.isArray(item.predictions_json) ? item.predictions_json : parseMaybeJson(item.predictions_json);
    for (const prediction of Array.isArray(predictions) ? predictions : []) {
      if (prediction && typeof prediction === "object" && prediction.label) labels.push(String(prediction.label));
      if (typeof prediction === "string") {
        const match = prediction.match(/label=([^;},]+)/);
        if (match) labels.push(match[1].trim());
      }
    }
  }

  const unique = Array.from(new Set(labels));
  return unique.length ? unique : ["目标"];
}

export function predictionBoxStyle(prediction, row) {
  const imageWidth = Math.max(1, Number(row.image_width || row.width || 1));
  const imageHeight = Math.max(1, Number(row.image_height || row.height || 1));
  const x = Number(prediction.bbox_x ?? prediction.x ?? 0);
  const y = Number(prediction.bbox_y ?? prediction.y ?? 0);
  const width = Number(prediction.bbox_w ?? prediction.width ?? 0);
  const height = Number(prediction.bbox_h ?? prediction.height ?? 0);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  const normalized = imageWidth === 1 && imageHeight === 1 && Math.max(x, y, width, height) <= 1;
  const left = normalized ? x * 100 : x / imageWidth * 100;
  const top = normalized ? y * 100 : y / imageHeight * 100;
  const boxWidth = normalized ? width * 100 : width / imageWidth * 100;
  const boxHeight = normalized ? height * 100 : height / imageHeight * 100;
  return {
    left: Math.max(0, Math.min(100, left)) + "%",
    top: Math.max(0, Math.min(100, top)) + "%",
    width: Math.max(0, Math.min(100 - left, boxWidth)) + "%",
    height: Math.max(0, Math.min(100 - top, boxHeight)) + "%",
  };
}

export function predictionColor(label = "") {
  let hash = 0;
  for (const char of String(label)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function predictionItems(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value.predictions) ? value.predictions : [];
}

export function parseMaybeJson(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

export function metricValue(metrics, keys) {
  for (const key of keys) {
    const value = metrics?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function formatMetric(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number >= 0 && number <= 1) return `${(number * 100).toFixed(2)}%`;
  return number.toFixed(2);
}
