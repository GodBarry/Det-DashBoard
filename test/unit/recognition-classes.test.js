const test = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultRecognitionClasses,
  isRecognizedClass,
  normalizeRecognitionClasses,
} = require("../../server/recognition-classes");

test("recognition classes default to the configured eight targets", () => {
  assert.deepEqual(defaultRecognitionClasses, [
    "car", "tank", "zhuangjiache", "fasheche",
    "hanma", "buzhanche", "kache", "daodanfasheche",
  ]);
  assert.deepEqual(normalizeRecognitionClasses(), defaultRecognitionClasses);
});

test("recognition class matching is case-insensitive and deduplicated", () => {
  assert.deepEqual(normalizeRecognitionClasses([" Tank ", "tank", "CAR"]), ["tank", "car"]);
  assert.equal(isRecognizedClass("Tank", ["tank"]), true);
  assert.equal(isRecognizedClass("person", ["tank"]), false);
});
