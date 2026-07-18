export const evaluationBarPalette = ["#0d8f89", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#10b981", "#06b6d4", "#f97316"];

export const evaluationErrorLegend = [
  { type: "ground", label: "真值框：实线" },
  { type: "prediction", label: "预测框：虚线（位于最前）" },
];

export const evaluationErrorDefinitions = [
  "漏检：存在真值框，但没有匹配到预测框。",
  "误检（虚警）：预测框没有匹配到任何真值目标。",
  "定位偏差：类别相同，但框的 IoU 未达到定位阈值。",
  "类别错误：框有足够重叠但类别不同，同时计作一次误检和一次漏检。",
];

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
