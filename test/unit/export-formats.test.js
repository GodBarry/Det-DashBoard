const assert = require("node:assert/strict");
const { test } = require("node:test");
const YAML = require("yaml");
const { normalizeExportFormat, labelmeDocument, cocoDocument, yoloDocuments } = require("../../server/export-formats");

const item = { width: 200, height: 100, scene: "dock", view: "aerial", keyword: "night" };
const annotations = [
  { label: "ship", bbox_x: 20, bbox_y: 10, bbox_w: 50, bbox_h: 30, difficult: false, attributes_json: { source: "manual" } },
  { label: "person", bbox_x: 100, bbox_y: 20, bbox_w: 20, bbox_h: 40, difficult: true, attributes_json: {} },
];
const entries = [{ item, annotations, imageName: "one.jpg", labelName: "one.txt" }];

test("normalizes supported export formats", () => {
  assert.equal(normalizeExportFormat("COCO"), "coco");
  assert.equal(normalizeExportFormat(""), "labelme");
  assert.equal(normalizeExportFormat("voc"), "");
});

test("creates LabelMe export documents", () => {
  const document = labelmeDocument(item, annotations, "one.jpg");
  assert.equal(document.imagePath, "../images/one.jpg");
  assert.equal(document.scene, "dock");
  assert.deepEqual(document.shapes[0].points, [[20, 10], [70, 40]]);
});

test("creates standard COCO images, categories and annotations", () => {
  const document = cocoDocument(entries);
  assert.equal(document.images[0].file_name, "one.jpg");
  assert.equal(document.annotations.length, 2);
  assert.equal(document.annotations[0].area, 1500);
  assert.deepEqual(document.categories.map((category) => category.name), ["person", "ship"]);
});

test("creates YOLO labels and parseable data.yaml", () => {
  const output = yoloDocuments(entries);
  const lines = output.labelFiles.get("one.txt").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^1 0\.225000 0\.250000 0\.250000 0\.300000$/);
  const config = YAML.parse(output.dataYaml);
  assert.equal(config.names[1], "ship");
});
