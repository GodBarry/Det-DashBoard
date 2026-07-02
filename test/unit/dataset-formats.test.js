const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { buildDatasetMatches, imageKey, shapeToBox } = require("../../server/dataset-formats");

const roots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "det-formats-"));
  roots.push(root);
  return root;
}

function write(file, value = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test("imports LabelMe JSON by imagePath", () => {
  const root = fixture();
  const image = write(path.join(root, "scene-a", "images", "one.jpg"));
  const label = write(path.join(root, "scene-a", "jsons", "one.json"), JSON.stringify({
    imagePath: "../images/one.jpg",
    imageWidth: 100,
    imageHeight: 80,
    scene: "explicit-scene",
    shapes: [{ label: "car", points: [[10, 20], [30, 50]], shape_type: "rectangle" }],
  }));
  const result = buildDatasetMatches({ files: [image, label], images: [image], sourceRoot: root });
  const match = result.matches.get(imageKey(image));
  assert.equal(match.format, "labelme");
  assert.equal(match.meta.scene, "explicit-scene");
  assert.equal(match.meta.shapes[0].label, "car");
  assert.equal(result.formatCounts.labelme, 1);
  assert.equal(result.unresolved.length, 0);
});

test("imports standard COCO single JSON", () => {
  const root = fixture();
  const image = write(path.join(root, "images", "one.jpg"));
  const label = write(path.join(root, "annotations", "instances.json"), JSON.stringify({
    images: [{ id: 7, file_name: "one.jpg", width: 200, height: 100, scene: "dock" }],
    categories: [{ id: 3, name: "ship" }],
    annotations: [{ id: 9, image_id: 7, category_id: 3, bbox: [20, 10, 50, 30], area: 1500, iscrowd: 0 }],
  }));
  const result = buildDatasetMatches({ files: [image, label], images: [image], sourceRoot: root });
  const match = result.matches.get(imageKey(image));
  assert.equal(match.format, "coco");
  assert.equal(match.meta.imageWidth, 200);
  assert.equal(match.meta.shapes[0].label, "ship");
  assert.deepEqual(shapeToBox(match.meta.shapes[0], 200, 100), { x: 20, y: 10, width: 50, height: 30 });
  assert.equal(result.formatCounts.coco, 1);
});

test("imports YOLO detection and segmentation labels using data.yaml names", () => {
  const root = fixture();
  const imageA = write(path.join(root, "images", "train", "a.jpg"));
  const imageB = write(path.join(root, "images", "train", "b.jpg"));
  const labelA = write(path.join(root, "labels", "train", "a.txt"), "1 0.5 0.5 0.4 0.2\n");
  const labelB = write(path.join(root, "labels", "train", "b.txt"), "0 0.1 0.1 0.7 0.1 0.8 0.9 0.2 0.8\n");
  const yaml = write(path.join(root, "data.yaml"), "names:\n  0: person\n  1: vehicle\n");
  const files = [imageA, imageB, labelA, labelB, yaml];
  const result = buildDatasetMatches({ files, images: [imageA, imageB], sourceRoot: root });
  const matchA = result.matches.get(imageKey(imageA));
  const matchB = result.matches.get(imageKey(imageB));
  assert.equal(matchA.meta.shapes[0].label, "vehicle");
  assert.deepEqual(shapeToBox(matchA.meta.shapes[0], 1000, 500), { x: 300, y: 200, width: 400, height: 100 });
  assert.equal(matchB.meta.shapes[0].label, "person");
  assert.deepEqual(shapeToBox(matchB.meta.shapes[0], 100, 100), { x: 10, y: 10, width: 70, height: 80 });
  assert.equal(result.formatCounts.yolo, 2);
});

test("LabelMe takes precedence over COCO and YOLO for the same image", () => {
  const root = fixture();
  const image = write(path.join(root, "images", "one.jpg"));
  const yolo = write(path.join(root, "labels", "one.txt"), "0 0.5 0.5 1 1\n");
  const coco = write(path.join(root, "annotations", "instances.json"), JSON.stringify({
    images: [{ id: 1, file_name: "one.jpg", width: 10, height: 10 }],
    categories: [{ id: 1, name: "coco" }],
    annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] }],
  }));
  const labelme = write(path.join(root, "jsons", "one.json"), JSON.stringify({
    imagePath: "../images/one.jpg",
    shapes: [{ label: "labelme", points: [[0, 0], [4, 4]] }],
  }));
  const result = buildDatasetMatches({ files: [image, yolo, coco, labelme], images: [image], sourceRoot: root });
  assert.equal(result.matches.get(imageKey(image)).format, "labelme");
  assert.ok(result.unresolved.some((item) => item.reason.includes("duplicate")));
});

test("rejects malformed annotations without producing infinite boxes", () => {
  assert.equal(shapeToBox({ points: [] }, 100, 100), null);
  assert.equal(shapeToBox({ points: [["bad", 1], [2, 3]] }, 100, 100), null);
  assert.equal(shapeToBox({ points: [[5, 5], [5, 9]] }, 100, 100), null);
  assert.deepEqual(shapeToBox({ normalized: true, points: [[-1, -1], [2, 2]] }, 100, 50), { x: 0, y: 0, width: 100, height: 50 });
});
