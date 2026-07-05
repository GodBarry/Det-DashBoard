function labelOf(item = {}) {
  const label = String(item.label || item.normalized_label || "").trim();
  if (label) return label;
  if (item.class_id !== undefined && item.class_id !== null && item.class_id !== "") return "class_" + Number(item.class_id);
  return "unknown";
}

function boxIou(a = {}, b = {}) {
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

function averagePrecision(points, totalGt) {
  if (!totalGt) return null;
  let tp = 0;
  let fp = 0;
  const curve = points.map((point) => {
    if (point.tp) tp += 1;
    else fp += 1;
    return { recall: tp / totalGt, precision: tp / Math.max(1, tp + fp) };
  });
  let ap = 0;
  for (let index = 0; index <= 100; index += 1) {
    const threshold = index / 100;
    const best = curve.reduce((max, point) => point.recall >= threshold ? Math.max(max, point.precision) : max, 0);
    ap += best / 101;
  }
  return ap;
}

function matchAtThreshold(predictions, groundTruth, minScore, iouThreshold, sameLabelOnly = true) {
  const used = new Set();
  let tp = 0;
  let fp = 0;
  let iouSum = 0;
  const sorted = predictions.filter((row) => row.score >= minScore).sort((a, b) => b.score - a.score);
  for (const prediction of sorted) {
    let bestIndex = -1;
    let bestIou = 0;
    for (let index = 0; index < groundTruth.length; index += 1) {
      if (used.has(index)) continue;
      if (sameLabelOnly && groundTruth[index].label !== prediction.label) continue;
      const iou = boxIou(prediction, groundTruth[index]);
      if (iou > bestIou) {
        bestIou = iou;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestIou >= iouThreshold) {
      used.add(bestIndex);
      tp += 1;
      iouSum += bestIou;
    } else {
      fp += 1;
    }
  }
  return { tp, fp, fn: Math.max(0, groundTruth.length - used.size), iouSum };
}

function evaluateDetections({ predictionRows = [], groundTruthRows = [], iouThreshold = 0.5 } = {}) {
  const predictions = [];
  for (const row of predictionRows) {
    const imageId = row.projectImageId || row.project_image_id;
    for (const prediction of row.predictions || row.predictions_json || []) {
      predictions.push({ ...prediction, imageId, label: labelOf(prediction), score: Number(prediction.score ?? 0) });
    }
  }
  const groundTruth = groundTruthRows.map((row, index) => ({
    ...row,
    index,
    imageId: row.projectImageId || row.project_image_id,
    label: labelOf(row),
  }));
  const labels = Array.from(new Set([...groundTruth.map((row) => row.label), ...predictions.map((row) => row.label)].filter(Boolean))).sort();
  const allLabels = [...labels, "背景"];
  const matrix = allLabels.map(() => allLabels.map(() => 0));
  const labelIndex = new Map(allLabels.map((label, index) => [label, index]));
  const perClass = new Map(labels.map((label) => [label, { label, groundTruth: 0, predictions: 0, tp: 0, fp: 0, fn: 0, ap50: null }]));
  for (const row of groundTruth) perClass.get(row.label).groundTruth += 1;
  for (const row of predictions) perClass.get(row.label).predictions += 1;

  const imageIds = Array.from(new Set([...groundTruth.map((row) => row.imageId), ...predictions.map((row) => row.imageId)].filter(Boolean)));
  const errors = [];
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  let matchedIouSum = 0;

  for (const imageId of imageIds) {
    const imageGt = groundTruth.filter((row) => row.imageId === imageId);
    const imagePreds = predictions.filter((row) => row.imageId === imageId).sort((a, b) => b.score - a.score);
    const used = new Set();
    const imageErrors = [];
    for (const prediction of imagePreds) {
      let bestIndex = -1;
      let bestIou = 0;
      for (let index = 0; index < imageGt.length; index += 1) {
        if (used.has(index)) continue;
        const iou = boxIou(prediction, imageGt[index]);
        if (iou > bestIou) {
          bestIou = iou;
          bestIndex = index;
        }
      }
      const predictedClass = perClass.get(prediction.label);
      if (bestIndex >= 0 && bestIou >= iouThreshold) {
        used.add(bestIndex);
        const truth = imageGt[bestIndex];
        matrix[labelIndex.get(truth.label)][labelIndex.get(prediction.label)] += 1;
        if (truth.label === prediction.label) {
          totalTp += 1;
          predictedClass.tp += 1;
          matchedIouSum += bestIou;
        } else {
          totalFp += 1;
          totalFn += 1;
          predictedClass.fp += 1;
          perClass.get(truth.label).fn += 1;
          imageErrors.push({ type: "class_error", prediction, groundTruth: truth, iou: bestIou });
        }
      } else {
        totalFp += 1;
        predictedClass.fp += 1;
        matrix[labelIndex.get("背景")][labelIndex.get(prediction.label)] += 1;
        imageErrors.push({ type: bestIou >= 0.1 ? "localization" : "false_positive", prediction, groundTruth: bestIndex >= 0 ? imageGt[bestIndex] : null, iou: bestIou });
      }
    }
    for (let index = 0; index < imageGt.length; index += 1) {
      if (used.has(index)) continue;
      const truth = imageGt[index];
      totalFn += 1;
      perClass.get(truth.label).fn += 1;
      matrix[labelIndex.get(truth.label)][labelIndex.get("背景")] += 1;
      imageErrors.push({ type: "false_negative", prediction: null, groundTruth: truth, iou: 0 });
    }
    if (imageErrors.length) {
      const counts = imageErrors.reduce((result, row) => ({ ...result, [row.type]: (result[row.type] || 0) + 1 }), {});
      errors.push({ projectImageId: imageId, counts, errors: imageErrors });
    }
  }

  for (const label of labels) {
    const labelGt = groundTruth.filter((row) => row.label === label);
    const labelPreds = predictions.filter((row) => row.label === label).sort((a, b) => b.score - a.score);
    const used = new Set();
    const points = [];
    for (const prediction of labelPreds) {
      let best = -1;
      let bestIou = 0;
      for (let index = 0; index < labelGt.length; index += 1) {
        if (used.has(index) || labelGt[index].imageId !== prediction.imageId) continue;
        const iou = boxIou(prediction, labelGt[index]);
        if (iou > bestIou) {
          bestIou = iou;
          best = index;
        }
      }
      const matched = best >= 0 && bestIou >= iouThreshold;
      if (matched) used.add(best);
      points.push({ tp: matched });
    }
    const row = perClass.get(label);
    row.ap50 = averagePrecision(points, labelGt.length);
    row.precision = row.tp / Math.max(1, row.tp + row.fp);
    row.recall = row.tp / Math.max(1, row.tp + row.fn);
    row.f1 = 2 * row.precision * row.recall / Math.max(1e-9, row.precision + row.recall);
  }

  const thresholds = Array.from({ length: 21 }, (_, index) => Number((index * 0.05).toFixed(2)));
  const curves = thresholds.map((confidence) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const imageId of imageIds) {
      const matched = matchAtThreshold(
        predictions.filter((row) => row.imageId === imageId),
        groundTruth.filter((row) => row.imageId === imageId),
        confidence,
        iouThreshold,
      );
      tp += matched.tp;
      fp += matched.fp;
      fn += matched.fn;
    }
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    const f1 = 2 * precision * recall / Math.max(1e-9, precision + recall);
    return { confidence, precision, recall, f1, tp, fp, fn };
  });
  const recommended = curves.reduce((best, row) => row.f1 > best.f1 ? row : best, curves[0] || { confidence: 0, f1: 0 });
  const precision = totalTp / Math.max(1, totalTp + totalFp);
  const recall = totalTp / Math.max(1, totalTp + totalFn);
  const f1 = 2 * precision * recall / Math.max(1e-9, precision + recall);

  return {
    evaluated: groundTruth.length > 0,
    iouThreshold,
    summary: {
      images: predictionRows.length,
      predictions: predictions.length,
      groundTruth: groundTruth.length,
      tp: totalTp,
      fp: totalFp,
      fn: totalFn,
      precision,
      recall,
      f1,
      avgIou: totalTp ? matchedIouSum / totalTp : 0,
      recommendedConfidence: recommended.confidence,
    },
    labels,
    perClass: Array.from(perClass.values()),
    confusionMatrix: { labels: allLabels, values: matrix },
    curves,
    errors,
  };
}

module.exports = { labelOf, boxIou, averagePrecision, evaluateDetections };
