const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateDetections, labelOf } = require("../../server/evaluation-metrics");

test("labelOf prefers semantic labels over numeric class ids", () => {
  assert.equal(labelOf({ label: "person", class_id: 0 }), "person");
  assert.equal(labelOf({ class_id: 3 }), "class_3");
});

test("computes confusion matrix, class metrics and threshold curves", () => {
  const evaluation = evaluateDetections({
    predictionRows: [
      {
        projectImageId: "image-1",
        predictions: [
          { label: "person", score: 0.9, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
          { label: "helmet", score: 0.8, bbox_x: 60, bbox_y: 60, bbox_w: 20, bbox_h: 20 },
        ],
      },
    ],
    groundTruthRows: [
      { project_image_id: "image-1", label: "person", bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
      { project_image_id: "image-1", label: "person", bbox_x: 60, bbox_y: 60, bbox_w: 20, bbox_h: 20 },
    ],
  });
  assert.equal(evaluation.summary.tp, 1);
  assert.equal(evaluation.summary.fp, 1);
  assert.equal(evaluation.summary.fn, 1);
  assert.equal(evaluation.curves.length, 21);
  assert.equal(evaluation.confusionMatrix.labels.includes("背景"), true);
  const person = evaluation.perClass.find((row) => row.label === "person");
  const helmet = evaluation.perClass.find((row) => row.label === "helmet");
  assert.equal(person.tp, 1);
  assert.equal(person.fn, 1);
  assert.equal(helmet.fp, 1);
  assert.equal(evaluation.errors[0].counts.class_error, 1);
});

test("classifies false positives, false negatives and localization errors", () => {
  const evaluation = evaluateDetections({
    predictionRows: [{
      projectImageId: "image-2",
      predictions: [
        { label: "vehicle", score: 0.9, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 },
        { label: "person", score: 0.8, bbox_x: 100, bbox_y: 100, bbox_w: 10, bbox_h: 10 },
      ],
    }],
    groundTruthRows: [
      { project_image_id: "image-2", label: "vehicle", bbox_x: 0, bbox_y: 0, bbox_w: 20, bbox_h: 20 },
      { project_image_id: "image-2", label: "helmet", bbox_x: 50, bbox_y: 50, bbox_w: 10, bbox_h: 10 },
    ],
  });
  const counts = evaluation.errors[0].counts;
  assert.equal(counts.localization, 1);
  assert.equal(counts.false_positive, 1);
  assert.equal(counts.false_negative, 2);
});

