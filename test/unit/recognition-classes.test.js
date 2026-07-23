const test = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultRecognitionClasses,
  isRecognizedClass,
  mapClassName,
  mapPredictionClassName,
  mappedRecognitionClasses,
  normalizeClassMappings,
  normalizeRecognitionClasses,
  recognitionInputClasses,
} = require("../../server/recognition-classes");

test("recognition classes default to the configured eight targets", () => {
  assert.deepEqual(defaultRecognitionClasses, [
    "car", "tank", "zhuangjiache", "fasheche",
    "hanma", "buzhanche", "kache", "daodanfasheche",
  ]);
  assert.deepEqual(normalizeRecognitionClasses(), defaultRecognitionClasses);
});

test("class mappings merge aliases into targets and block unmapped labels", () => {
  const mappings = normalizeClassMappings([
    { sources: ["Car", "vehicle"], target: "car" },
    { sources: ["Tank", "MBT"], target: "armor" },
  ], ["car", "armor"]);
  assert.deepEqual(mappings, [
    { target: "car", sources: ["car", "vehicle"] },
    { target: "armor", sources: ["tank", "mbt"] },
  ]);
  assert.equal(mapClassName("VEHICLE", mappings), "car");
  assert.equal(mapClassName("tank", mappings), "armor");
  assert.equal(mapClassName("person", mappings), null);
  assert.deepEqual(mappedRecognitionClasses(mappings), ["car", "armor"]);
  assert.deepEqual(recognitionInputClasses(mappings), ["car", "vehicle", "tank", "mbt"]);
  assert.deepEqual(normalizeClassMappings([], []), []);
  assert.equal(mapClassName("car", [], []), null);
  assert.equal(mapClassName("armor", mappings), null);
  assert.deepEqual(normalizeClassMappings(undefined, ["car", "tank"]), [
    { target: "car", sources: ["car"] },
    { target: "tank", sources: ["tank"] },
  ]);
  assert.deepEqual(normalizeClassMappings([
    { target: "vehicle", sources: ["car"] },
    { target: "civilian", sources: ["car", "bus"] },
  ]), [
    { target: "vehicle", sources: ["car"] },
    { target: "civilian", sources: ["bus"] },
  ]);
  assert.equal(mapPredictionClassName("person", mappings), null);
  assert.equal(mapPredictionClassName("armor", mappings), "armor");
});

test("recognition class matching is case-insensitive and deduplicated", () => {
  assert.deepEqual(normalizeRecognitionClasses([" Tank ", "tank", "CAR"]), ["tank", "car"]);
  assert.equal(isRecognizedClass("Tank", ["tank"]), true);
  assert.equal(isRecognizedClass("person", ["tank"]), false);
});
