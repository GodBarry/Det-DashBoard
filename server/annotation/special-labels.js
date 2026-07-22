const SPECIAL_LABELS = new Set(["mosaic"]);

function normalizeAnnotationLabel(value) {
  return String(value || "").trim().toLowerCase();
}

function isSpecialAnnotationLabel(value) {
  return SPECIAL_LABELS.has(normalizeAnnotationLabel(value));
}

function isMosaicAnnotation(annotation) {
  return normalizeAnnotationLabel(annotation?.label) === "mosaic";
}

function mosaicPixelSize(annotation, fallback = 20) {
  const attributes = annotation?.attributes_json || annotation?.attributes || {};
  const explicit = Number(attributes.pixel_size ?? attributes.pixelSize);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const match = String(annotation?.description || attributes.source_description || "").match(/pixel_size\s*:\s*(\d+)/i);
  return match ? Math.max(1, Number(match[1])) : fallback;
}

function importedAnnotationAttributes(shape) {
  const attributes = { ...(shape?.attributes || {}) };
  if (!isMosaicAnnotation(shape)) return attributes;
  attributes.special_annotation = "mosaic";
  attributes.pixel_size = mosaicPixelSize(shape);
  if (shape?.description) attributes.source_description = String(shape.description);
  return attributes;
}

module.exports = {
  importedAnnotationAttributes,
  isMosaicAnnotation,
  isSpecialAnnotationLabel,
  mosaicPixelSize,
  normalizeAnnotationLabel,
};
