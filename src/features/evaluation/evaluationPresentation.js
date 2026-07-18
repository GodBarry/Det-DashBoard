export const evaluationBarPalette = ["#0d8f89", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#10b981", "#06b6d4", "#f97316"];

export const evaluationErrorLegend = [
  { type: "ground", label: "真值框：实线" },
  { type: "prediction", label: "预测框：虚线（位于最前）" },
];

export const evaluationErrorDefinitions = [
  "漏检：存在真值框，但没有匹配到预测框。",
  "误检（虚警）：预测框没有匹配到任何真值目标。",
  "定位偏差：类别相同且存在对应关系，但 IoU 未达到正确检测阈值。",
  "类别错误：类别不同且 IoU 达到正式匹配阈值，同时计作一次误检和一次漏检。",
  "类别不同但 IoU 未达到正式匹配阈值：按一次误检和一次漏检分别统计，不归入类别错误。",
];

export const evaluationErrorDescriptions = {
  false_negative: "只显示未被正确识别目标的真值实线框。",
  false_positive: "只显示没有匹配真值目标的预测虚线框，并标出预测类别与置信度。",
  localization: "同时显示真值实线框和预测虚线框，类别相同但位置偏差较大。",
  class_error: "同时显示真值类别和预测类别；满足正式 IoU 阈值时计作 FP + FN。",
};

const errorLabels = {
  false_negative: "漏检",
  false_positive: "误检（虚警）",
  localization: "定位偏差",
  class_error: "类别错误",
};

export function evaluationErrorBoxes(row = {}, filter = "false_negative", predictionItems = () => []) {
  const errors = Array.isArray(row.errors) ? row.errors : [];
  const selected = errors.filter((item) => !filter || item.type === filter);

  if (!selected.length) return [];

  return selected.flatMap((error) => {
    const label = errorLabels[error.type] || "错误";
    const itemLabel = (item) => item?.label || item?.class_name || item?.category || "目标";
    const scoreLabel = (item) => item?.score == null ? "" : ` ${(Number(item.score) * 100).toFixed(0)}%`;
    if (error.type === "false_negative" && error.groundTruth) {
      return [{ type: "false_negative ground", item: error.groundTruth, label: `漏检·真值·${itemLabel(error.groundTruth)}` }];
    }
    if (error.type === "false_positive" && error.prediction) {
      return [{ type: "false_positive prediction", item: error.prediction, label: `误检·预测·${itemLabel(error.prediction)}${scoreLabel(error.prediction)}` }];
    }

    const boxes = [];
    if (error.groundTruth) boxes.push({ type: `${error.type} ground`, item: error.groundTruth, label: `${label}·真值·${itemLabel(error.groundTruth)}` });
    if (error.prediction) boxes.push({ type: `${error.type} prediction`, item: error.prediction, label: `${label}·预测·${itemLabel(error.prediction)}${scoreLabel(error.prediction)}` });
    return boxes;
  });
}
