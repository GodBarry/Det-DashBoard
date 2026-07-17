export const evaluationBarPalette = ["#0d8f89", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#10b981", "#06b6d4", "#f97316"];
export function evaluationErrorBoxes(row = {}, filter = "false_negative", predictionItems) {

  const errors = Array.isArray(row.errors) ? row.errors : [];

  const selected = errors.filter((item) => !filter || item.type === filter);

  if (!selected.length) return predictionItems(row.predictions_json).slice(0, 3).map((prediction) => ({ type: "prediction", item: prediction, label: prediction.label || "目标" }));

  return selected.flatMap((error) => {

    if (error.type === "false_negative" && error.groundTruth) return [{ type: "false_negative", item: error.groundTruth, label: error.groundTruth.label || "漏检" }];

    if (error.type === "false_positive" && error.prediction) return [{ type: "false_positive", item: error.prediction, label: error.prediction.label || "误检" }];

    const rows = [];

    if (error.groundTruth) rows.push({ type: error.type + " ground", item: error.groundTruth, label: error.groundTruth.label || "真实" });

    if (error.prediction) rows.push({ type: error.type + " prediction", item: error.prediction, label: error.prediction.label || "预测" });

    return rows;

  });

}
