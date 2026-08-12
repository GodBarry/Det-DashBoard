const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateDetections } = require("../../server/evaluation-metrics");

test("evaluation excludes classes without ground truth from recall and AP averages", () => {
  const evaluation = evaluateDetections({
    expectedLabels: ["tank", "car", "hanma"],
    groundTruthRows: [
      { project_image_id: "image-1", label: "tank", bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
    ],
    predictionRows: [
      { projectImageId: "image-1", predictions: [
        { label: "tank", score: 0.9, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
        { label: "car", score: 0.8, bbox_x: 50, bbox_y: 50, bbox_w: 10, bbox_h: 10 },
      ] },
    ],
  });

  const rows = Object.fromEntries(evaluation.perClass.map((row) => [row.label, row]));
  assert.equal(evaluation.summary.recall, 1);
  assert.equal(evaluation.summary.precision, 0.5);
  assert.equal(evaluation.summary.configuredClasses, 3);
  assert.equal(evaluation.summary.evaluableClasses, 1);
  assert.equal(evaluation.summary.macroRecall, 1);
  assert.equal(rows.tank.recall, 1);
  assert.equal(rows.car.recall, null);
  assert.equal(rows.car.precision, 0);
  assert.equal(rows.car.status, "predictions_without_ground_truth");
  assert.equal(rows.hanma.precision, null);
  assert.equal(rows.hanma.recall, null);
  assert.equal(rows.hanma.ap50, null);
  assert.equal(rows.hanma.status, "no_samples");
});

test("evaluation metrics are deterministic when database and equal-score prediction order changes", () => {
  const groundTruth = [
    { project_image_id: "image-1", label: "tank", bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
    { project_image_id: "image-1", label: "car", bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
  ];
  const predictions = [
    { label: "tank", score: 0.8, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
    { label: "car", score: 0.8, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
  ];
  const evaluate = (gt, preds) => evaluateDetections({
    expectedLabels: ["tank", "car"],
    groundTruthRows: gt,
    predictionRows: [{ projectImageId: "image-1", predictions: preds }],
  });

  const forward = evaluate(groundTruth, predictions);
  const reversed = evaluate([...groundTruth].reverse(), [...predictions].reverse());

  assert.deepEqual(reversed.summary, forward.summary);
  assert.deepEqual(reversed.perClass, forward.perClass);
  assert.deepEqual(reversed.confusionMatrix, forward.confusionMatrix);
});
