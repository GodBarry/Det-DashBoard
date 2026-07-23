function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function parseRecognitionClasses(value) {
  return Array.from(new Set(
    String(value || "")
      .split(/[\s,，、;；]+/)
      .map(normalize)
      .filter(Boolean),
  ));
}

export function moveRecognitionClass(values, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= values.length || toIndex >= values.length) return values;
  const next = [...values];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export { normalize as normalizeRecognitionClass };
