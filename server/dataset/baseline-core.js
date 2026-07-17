function bboxIou(a, b) {
  const ax1 = Number(a.bbox_x || 0);
  const ay1 = Number(a.bbox_y || 0);
  const ax2 = ax1 + Number(a.bbox_w || 0);
  const ay2 = ay1 + Number(a.bbox_h || 0);
  const bx1 = Number(b.bbox_x || 0);
  const by1 = Number(b.bbox_y || 0);
  const bx2 = bx1 + Number(b.bbox_w || 0);
  const by2 = by1 + Number(b.bbox_h || 0);
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = ix * iy;
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  return inter / Math.max(1, areaA + areaB - inter);
}

function normalizeLabel(label, mapping = {}) {
  const key = String(label || "unknown").trim() || "unknown";
  return mapping[key] || key;
}

function analyzeImageGroup(rows, params) {
  const iouSame = Number(params.iouSame ?? 0.9);
  const iouLight = Number(params.iouLight ?? 0.75);
  const labelMap = params.labelMap || {};
  const priority = params.sourcePriority || [];
  const priorityIndex = (projectId) => {
    const index = priority.indexOf(projectId);
    return index >= 0 ? index : 9999;
  };
  const sorted = [...rows].sort((a, b) => priorityIndex(a.project_id) - priorityIndex(b.project_id) || String(a.project_id).localeCompare(String(b.project_id)));
  const chosenRow = sorted[0];
  const all = rows.flatMap((row) => row.annotations.map((ann) => ({ ...ann, source_project_id: row.project_id, source_project_name: row.project_name, source_project_image_id: row.id })));
  const normalized = all.map((ann) => ({ ...ann, normalized_label: normalizeLabel(ann.label, labelMap) }));
  const chosen = normalized.filter((ann) => String(ann.source_project_id) === String(chosenRow.project_id));
  let conflictType = "";
  let severity = "low";
  let autoResolved = true;
  const log = [];

  if (!normalized.length) {
    log.push("Annotation counts differ across sources.");
    return { chosenRow, annotations: [], conflictType: "", severity: "low", autoResolved: true, log };
  }
  const counts = new Map(rows.map((row) => [row.project_id, row.annotations.length]));
  if (new Set(counts.values()).size > 1) {
    conflictType = "count_conflict";
    severity = "high";
    autoResolved = false;
    log.push("Annotation counts differ across sources.");
  }
  for (const ann of normalized) {
    const best = chosen.reduce((acc, item) => {
      const iou = bboxIou(ann, item);
      return iou > acc.iou ? { iou, item } : acc;
    }, { iou: 0, item: null });
    if (best.item && best.iou >= iouSame && ann.normalized_label !== best.item.normalized_label) {
      conflictType ||= "label_conflict";
      severity = "high";
      autoResolved = false;
      log.push(`同位置类别不一致：${ann.label} / ${best.item.label}`);
    } else if (best.item && best.iou >= iouLight && best.iou < iouSame && ann.normalized_label === best.item.normalized_label) {
      conflictType ||= "bbox_conflict";
      severity = severity === "high" ? "high" : "medium";
      log.push(`轻微框偏差：${ann.normalized_label} IoU=${best.iou.toFixed(2)}`);
    }
  }
  if (!conflictType && rows.length > 1) log.push("多来源标注一致，按来源优先级保留");
  return { chosenRow, annotations: chosen, conflictType, severity, autoResolved, log };
}

function applyConflictDecision(group, params, conflict) {
  if (!conflict?.resolution?.startsWith("source_project:")) return analyzeImageGroup(group, params);
  const sourceProjectId = conflict.resolution.split(":")[1];
  const chosenRow = group.find((row) => String(row.project_id) === sourceProjectId) || group[0];
  const labelMap = params.labelMap || {};
  const annotations = chosenRow.annotations.map((ann) => ({
    ...ann,
    source_project_id: chosenRow.project_id,
    source_project_name: chosenRow.project_name,
    source_project_image_id: chosenRow.id,
    normalized_label: normalizeLabel(ann.label, labelMap),
  }));
  return {
    chosenRow,
    annotations,
    conflictType: conflict.conflict_type,
    severity: conflict.severity,
    autoResolved: false,
    log: [`人工选择保留来源：${chosenRow.project_name}`],
  };
}

module.exports = { bboxIou, normalizeLabel, analyzeImageGroup, applyConflictDecision };
