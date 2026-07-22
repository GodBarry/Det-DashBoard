const defaultRecognitionClasses = require("../shared/recognition-classes.json");

function normalizeClassName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRecognitionClasses(value) {
  const source = Array.isArray(value) && value.length ? value : defaultRecognitionClasses;
  const seen = new Set();
  return source.reduce((classes, item) => {
    const normalized = normalizeClassName(item);
    if (!normalized || seen.has(normalized)) return classes;
    seen.add(normalized);
    classes.push(normalized);
    return classes;
  }, []);
}

function recognitionClassSet(value) {
  return new Set(normalizeRecognitionClasses(value));
}

function isRecognizedClass(label, classes) {
  return recognitionClassSet(classes).has(normalizeClassName(label));
}

module.exports = {
  defaultRecognitionClasses,
  isRecognizedClass,
  normalizeClassName,
  normalizeRecognitionClasses,
  recognitionClassSet,
};
