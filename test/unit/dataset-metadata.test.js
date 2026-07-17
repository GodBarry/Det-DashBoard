const test = require("node:test");
const assert = require("node:assert/strict");

const { inferModality, normalizeModality } = require("../../server/utils.js");

test("explicit LabelMe modality metadata takes priority over filename inference", () => {
  assert.equal(inferModality({ modality: "IR" }, "DJI_20260605112450_0013_T_00000.jpg"), "infrared");
  assert.equal(inferModality({ modality: "RGB" }, "thermal-looking-name.jpg"), "visible");
  assert.equal(inferModality({ modality: "Gray" }, "image.jpg"), "grayscale");
});

test("modality inference recognizes directory segments and common aliases", () => {
  assert.equal(inferModality({}, "E:\\datasets\\hanma\\IR\\images\\image.jpg"), "infrared");
  assert.equal(inferModality({}, "E:\\datasets\\hanma\\Gray\\images\\image.jpg"), "grayscale");
  assert.equal(normalizeModality("CCD"), "visible");
  assert.equal(normalizeModality("thermal infrared"), "infrared");
});

test("dataset metadata presentation uses Chinese labels without changing stored values", async () => {
  const presentation = await import("../../src/shared/datasetMetadata.js");
  assert.equal(presentation.modalityLabel("infrared"), "红外");
  assert.equal(presentation.modalityLabel("RGB"), "彩色");
  assert.equal(presentation.modalityLabel("Gray"), "灰度");
  assert.equal(presentation.viewLabel("oblique"), "斜视");
  assert.equal(presentation.sceneLabel("urban"), "城市");
  assert.deepEqual(presentation.metadataOption("oblique", "view"), ["oblique", "斜视"]);
});
