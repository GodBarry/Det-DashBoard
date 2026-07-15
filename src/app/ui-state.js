const uiStateStorageKey = "det-dashboard-ui-state-v1";

export const restorableViews = new Set(["home", "workspace", "models", "training", "inference", "evaluation"]);

export function readUiState() {
  try {
    return JSON.parse(window.localStorage.getItem(uiStateStorageKey) || "{}") || {};
  } catch {
    return {};
  }
}

export function updateUiState(patch) {
  try {
    window.localStorage.setItem(uiStateStorageKey, JSON.stringify({ ...readUiState(), ...patch }));
  } catch {
    // State restoration is best-effort when storage is unavailable.
  }
}
