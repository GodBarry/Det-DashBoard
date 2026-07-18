export const evaluationBarPalette = ["#0d8f89", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#10b981", "#06b6d4", "#f97316"];

export const evaluationErrorLegend = [
  { type: "false_negative", label: "漏检：真值框" },
  { type: "false_positive", label: "误检（虚警）：预测框" },
  { type: "localization ground", label: "定位偏差：真值框" },
  { type: "localization prediction", label: "定位偏差：预测框" },
  { type: "class_error ground", label: "类别错误：真值框" },
  { type: "class_error prediction", label: "类别错误：预测框" },
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
    if (error.type === "false_negative" && error.groundTruth) {
      return [{ type: "false_negative", item: error.groundTruth, label }];
    }
    if (error.type === "false_positive" && error.prediction) {
      return [{ type: "false_positive", item: error.prediction, label }];
    }

    const boxes = [];
    if (error.groundTruth) boxes.push({ type: `${error.type} ground`, item: error.groundTruth, label: `${label}·真值` });
    if (error.prediction) boxes.push({ type: `${error.type} prediction`, item: error.prediction, label: `${label}·预测` });
    return boxes;
  });
}
