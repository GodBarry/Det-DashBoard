const test = require("node:test");
const assert = require("node:assert/strict");

const {
  seededRandom,
  hashToSeed,
  clampNumber,
  shuffleWithRng,
  qualityJitter,
  jitterBoxFromGt,
  randomBackgroundBox,
  fakeScore,
  boxIou,
  metricLabel,
  averagePrecision,
} = require("../../server/runtime-jobs/inference-metrics");

test("seededRandom and hashToSeed preserve deterministic outputs", () => {
  const first = seededRandom(123);
  const second = seededRandom(123);
  const expected = [
    0.7872516233474016,
    0.1785435655619949,
    0.49531551403924823,
    0.23136196262203157,
    0.375791602069512,
  ];

  assert.deepEqual(expected.map(() => first()), expected);
  assert.deepEqual(expected.map(() => second()), expected);
  assert.equal(hashToSeed("job-42"), 313416019);
  assert.equal(hashToSeed(null), hashToSeed(""));
});

test("clampNumber coerces numeric inputs and enforces both boundaries", () => {
  assert.equal(clampNumber("4.5", 0, 4), 4);
  assert.equal(clampNumber(-1, 0, 4), 0);
  assert.equal(clampNumber(2, 0, 4), 2);
  assert.equal(Number.isNaN(clampNumber("not-a-number", 0, 4)), true);
});

test("shuffleWithRng is deterministic and leaves its input unchanged", () => {
  const input = [1, 2, 3, 4, 5, 6];
  const shuffled = shuffleWithRng(input, seededRandom(123));

  assert.deepEqual(shuffled, [4, 3, 6, 2, 1, 5]);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
});

test("quality and score jitter preserve configured ranges and rounding", () => {
  assert.equal(qualityJitter("good", () => 0), 0.02);
  assert.equal(qualityJitter("bad", () => 1), 0.32);
  assert.equal(qualityJitter("unknown", () => 0.5), 0.05);
  assert.equal(fakeScore("tp", () => 0.5), 0.83);
  assert.equal(fakeScore("duplicate", () => 0.5), 0.475);
  assert.equal(fakeScore("confusion", () => 0.5), 0.65);
  assert.equal(fakeScore("background", () => 0.5), 0.36);
});

test("jitterBoxFromGt is deterministic and clamps boxes to image bounds", () => {
  const gt = { bbox_x: 90, bbox_y: 45, bbox_w: 20, bbox_h: 10 };
  const image = { width: 100, height: 50 };
  const first = jitterBoxFromGt(gt, image, "poor", seededRandom(9));
  const second = jitterBoxFromGt(gt, image, "poor", seededRandom(9));

  assert.deepEqual(first, second);
  assert.ok(first.bbox_x >= 0 && first.bbox_y >= 0);
  assert.ok(first.bbox_w >= 1 && first.bbox_h >= 1);
  assert.ok(first.bbox_x + first.bbox_w <= 110);
  assert.ok(first.bbox_y + first.bbox_h <= 55);
});

test("randomBackgroundBox is deterministic and avoids strong GT overlap", () => {
  const image = { width: 640, height: 480 };
  const gtRows = [{ bbox_x: 200, bbox_y: 150, bbox_w: 100, bbox_h: 100 }];
  const first = randomBackgroundBox(image, gtRows, seededRandom(77));
  const second = randomBackgroundBox(image, gtRows, seededRandom(77));

  assert.deepEqual(first, second);
  assert.ok(first.bbox_x >= 0 && first.bbox_y >= 0);
  assert.ok(first.bbox_x + first.bbox_w <= image.width);
  assert.ok(first.bbox_y + first.bbox_h <= image.height);
  assert.ok(boxIou(first, gtRows[0]) < 0.2);
});

test("boxIou handles identical, partial, disjoint, and empty boxes", () => {
  const box = { bbox_x: 0, bbox_y: 0, bbox_w: 10, bbox_h: 10 };
  assert.equal(boxIou(box, box), 1);
  assert.equal(boxIou(box, { bbox_x: 5, bbox_y: 0, bbox_w: 10, bbox_h: 10 }), 1 / 3);
  assert.equal(boxIou(box, { bbox_x: 20, bbox_y: 20, bbox_w: 5, bbox_h: 5 }), 0);
  assert.equal(boxIou(box, { bbox_x: 0, bbox_y: 0, bbox_w: 0, bbox_h: 0 }), 0);
});

test("metricLabel follows label, normalized label, class id, and unknown precedence", () => {
  assert.equal(metricLabel({ label: " car ", normalized_label: "vehicle", class_id: 2 }), "car");
  assert.equal(metricLabel({ normalized_label: " vehicle ", class_id: 2 }), "vehicle");
  assert.equal(metricLabel({ class_id: 0 }), "class_0");
  assert.equal(metricLabel({}), "unknown");
});

test("averagePrecision preserves the 101-point interpolated AP contract", () => {
  assert.equal(averagePrecision([], 0), null);
  assert.equal(averagePrecision([{ tp: true }], 1), 1.0000000000000007);
  assert.equal(averagePrecision([{ tp: false }, { tp: true }], 1), 0.5000000000000003);
  assert.ok(Math.abs(averagePrecision([{ tp: true }, { tp: false }, { tp: true }], 2) - (253 / 303)) < 1e-12);
});
