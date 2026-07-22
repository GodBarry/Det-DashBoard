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

function normalizeClassMappings(value, recognitionClasses) {
  const targets = Array.isArray(recognitionClasses)
    ? Array.from(new Set(recognitionClasses.map(normalizeClassName).filter(Boolean)))
    : normalizeRecognitionClasses();
  const source = Array.isArray(value) ? value : targets.map((target) => ({ target, sources: [target] }));
  const byTarget = new Map();
  const claimedSources = new Set();
  for (const item of source) {
    const target = normalizeClassName(item?.target);
    if (!target) continue;
    const sources = Array.isArray(item?.sources) ? item.sources : [item?.source];
    const row = byTarget.get(target) || { target, sources: [] };
    for (const entry of sources) {
      const normalized = normalizeClassName(entry);
      if (!normalized || claimedSources.has(normalized)) continue;
      row.sources.push(normalized);
      claimedSources.add(normalized);
    }
    if (row.sources.length) byTarget.set(target, row);
  }
  return Array.from(byTarget.values());
}

function classMappingLookup(value, recognitionClasses) {
  if (value instanceof Map) return value;
  const lookup = new Map();
  for (const row of normalizeClassMappings(value, recognitionClasses)) {
    for (const source of row.sources) lookup.set(source, row.target);
  }
  return lookup;
}

function mapClassName(label, mappings, recognitionClasses) {
  return classMappingLookup(mappings, recognitionClasses).get(normalizeClassName(label)) || null;
}

function mappedRecognitionClasses(mappings, recognitionClasses) {
  return normalizeClassMappings(mappings, recognitionClasses).map((row) => row.target);
}

function recognitionInputClasses(mappings, recognitionClasses) {
  return Array.from(new Set(normalizeClassMappings(mappings, recognitionClasses).flatMap((row) => row.sources)));
}

function isRecognizedClass(label, classes) {
  return recognitionClassSet(classes).has(normalizeClassName(label));
}

module.exports = {
  defaultRecognitionClasses,
  isRecognizedClass,
  normalizeClassName,
  normalizeClassMappings,
  normalizeRecognitionClasses,
  classMappingLookup,
  mapClassName,
  mappedRecognitionClasses,
  recognitionInputClasses,
  recognitionClassSet,
};
