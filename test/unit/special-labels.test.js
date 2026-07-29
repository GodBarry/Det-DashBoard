const test = require("node:test");
const assert = require("node:assert/strict");

const {
  importedAnnotationAttributes,
  isMosaicAnnotation,
  isSpecialAnnotationLabel,
  mosaicPixelSize,
} = require("../../server/annotation/special-labels");
const { cocoDocument, labelmeDocument, yoloDocuments } = require("../../server/export-formats");

test("mosaic labels are special annotations rather than detection targets", () => {
  assert.equal(isSpecialAnnotationLabel(" mosaic "), true);
  assert.equal(isSpecialAnnotationLabel("Mosaic"), true);
  assert.equal(isSpecialAnnotationLabel("tank"), false);
  assert.equal(isMosaicAnnotation({ label: "MOSAIC" }), true);
});

test("mosaic metadata preserves the LabelMe description and pixel size", () => {
  const shape = { label: "mosaic", description: "pixel_size:20", attributes: {} };
  assert.equal(mosaicPixelSize(shape), 20);
  assert.deepEqual(importedAnnotationAttributes(shape), {
    special_annotation: "mosaic",
    pixel_size: 20,
    source_description: "pixel_size:20",
  });
});

test("LabelMe preserves mosaic regions while COCO and YOLO exclude them from target classes", () => {
  const annotations = [
    { label: "mosaic", bbox_x: 1, bbox_y: 2, bbox_w: 20, bbox_h: 10, attributes_json: { pixel_size: 20, source_description: "pixel_size:20" } },
    { label: "tank", bbox_x: 10, bbox_y: 20, bbox_w: 30, bbox_h: 40 },
  ];
  const entry = { item: { width: 100, height: 100 }, imageName: "image.jpg", labelName: "image.txt", annotations };
  const labelme = labelmeDocument(entry.item, annotations, entry.imageName);
  assert.deepEqual(labelme.shapes.map((shape) => shape.label), ["mosaic", "tank"]);
  assert.equal(labelme.shapes[0].description, "pixel_size:20");
  assert.deepEqual(cocoDocument([entry]).categories.map((category) => category.name), ["tank"]);
  assert.deepEqual(yoloDocuments([entry]).labels, ["tank"]);
  assert.match(yoloDocuments([entry]).labelFiles.get("image.txt"), /^0 /);
});
