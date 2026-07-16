export const DATASET_WORKSPACE_PAGE_SIZE = 48;
export const DATASET_WORKSPACE_POLL_INTERVAL = 1500;

const FILTER_KEYS = ["scenes", "views", "modalities", "labels", "importBatchIds"];
const RUNNING_IMPORT_STATUSES = ["scanning", "running", "cancel_requested"];
const TERMINAL_IMPORT_STATUSES = ["done", "failed", "cancelled"];

export function createDatasetWorkspaceFilters() {
  return { q: "", scenes: [], views: [], modalities: [], labels: [], importBatchIds: [] };
}
export function buildWorkspaceSearchParams(page, filters) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(DATASET_WORKSPACE_PAGE_SIZE),
    q: filters.q || "",
  });

  for (const key of FILTER_KEYS) {
    if (filters[key]?.length) params.set(key, filters[key].join(","));
  }

  return params;
}

export function datasetTotalPages(totalItems, pageSize = DATASET_WORKSPACE_PAGE_SIZE) {
  return Math.max(1, Math.ceil(Math.max(0, Number(totalItems) || 0) / Math.max(1, Number(pageSize) || 1)));
}

export function clampDatasetPage(page, totalItems, pageSize = DATASET_WORKSPACE_PAGE_SIZE) {
  return Math.min(datasetTotalPages(totalItems, pageSize), Math.max(1, Math.trunc(Number(page) || 1)));
}

export function findRunningImport(imports) {
  return imports.find((row) => RUNNING_IMPORT_STATUSES.includes(row.status)) || null;
}

export function buildTerminalImportRefreshKey(activeProject, imports) {
  const terminalImport = imports.find((row) => TERMINAL_IMPORT_STATUSES.includes(row.status));

  return terminalImport
    ? `${activeProject.id}:${terminalImport.id}:${terminalImport.status}:${terminalImport.finished_at || ""}`
    : "";
}
