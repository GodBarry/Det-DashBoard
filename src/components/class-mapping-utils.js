const clean = (value) => String(value || "").trim().toLowerCase();
const unique = (values) => Array.from(new Set((values || []).map(clean).filter(Boolean)));

export function normalizeClassMappings(mappings = []) {
  return (mappings || []).map((row) => ({
    target: clean(row.target),
    sources: unique(row.sources),
  })).filter((row) => row.target && row.sources.length);
}

export function reconcileClassMappings(mappings, availableSources = []) {
  const available = new Set(unique(availableSources));
  return normalizeClassMappings(mappings)
    .map((row) => ({ ...row, sources: row.sources.filter((source) => available.has(source)) }))
    .filter((row) => row.sources.length);
}
