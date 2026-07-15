const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bboxIou,
  normalizeLabel,
  analyzeImageGroup,
  applyConflictDecision,
} = require("../../server/dataset/baseline-core");

function annotation(label, x = 0, y = 0, width = 10, height = 10) {
  return { id: `${label}-${x}-${y}`, label, bbox_x: x, bbox_y: y, bbox_w: width, bbox_h: height };
}

function imageRow(projectId, annotations) {
  return { id: `image-${projectId}`, project_id: projectId, project_name: `Project ${projectId}`, annotations };
}

test("bboxIou handles identical, partial, and disjoint boxes", () => {
  const box = annotation("car", 0, 0, 10, 10);
  assert.equal(bboxIou(box, box), 1);
  assert.equal(bboxIou(box, annotation("car", 5, 0, 10, 10)), 1 / 3);
  assert.equal(bboxIou(box, annotation("car", 20, 20, 5, 5)), 0);
});

test("normalizeLabel trims labels, applies mappings, and defaults empty labels", () => {
  assert.equal(normalizeLabel(" sedan ", { sedan: "car" }), "car");
  assert.equal(normalizeLabel("truck", { sedan: "car" }), "truck");
  assert.equal(normalizeLabel("   "), "unknown");
});

test("analyzeImageGroup keeps the highest-priority source and detects label conflicts", () => {
  const rows = [
    imageRow("project-a", [annotation("sedan")]),
    imageRow("project-b", [annotation("truck")]),
  ];
  const result = analyzeImageGroup(rows, {
    sourcePriority: ["project-b", "project-a"],
    labelMap: { sedan: "car" },
  });

  assert.equal(result.chosenRow.project_id, "project-b");
  assert.equal(result.annotations[0].source_project_id, "project-b");
  assert.equal(result.conflictType, "label_conflict");
  assert.equal(result.severity, "high");
  assert.equal(result.autoResolved, false);
});

test("analyzeImageGroup reports annotation count conflicts", () => {
  const result = analyzeImageGroup([
    imageRow("project-a", [annotation("car")]),
    imageRow("project-b", []),
  ], { sourcePriority: ["project-a", "project-b"] });

  assert.equal(result.conflictType, "count_conflict");
  assert.equal(result.severity, "high");
  assert.equal(result.autoResolved, false);
});

test("applyConflictDecision honors a selected source and normalizes its labels", () => {
  const rows = [
    imageRow("project-a", [annotation("sedan")]),
    imageRow("project-b", [annotation("truck")]),
  ];
  const result = applyConflictDecision(rows, { labelMap: { sedan: "car" } }, {
    resolution: "source_project:project-a",
    conflict_type: "label_conflict",
    severity: "high",
  });

  assert.equal(result.chosenRow.project_id, "project-a");
  assert.equal(result.annotations[0].normalized_label, "car");
  assert.equal(result.annotations[0].source_project_image_id, "image-project-a");
  assert.equal(result.conflictType, "label_conflict");
  assert.equal(result.autoResolved, false);
});

test("applyConflictDecision falls back to automatic analysis without a source resolution", () => {
  const rows = [imageRow("project-a", [annotation("car")])];
  const result = applyConflictDecision(rows, {}, { resolution: "pending" });

  assert.equal(result.chosenRow.project_id, "project-a");
  assert.equal(result.conflictType, "");
  assert.equal(result.autoResolved, true);
});
