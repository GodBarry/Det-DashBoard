const STORAGE_KEY = "det-dashboard.dataset-activity-logs";
const EVENT_NAME = "det-dashboard:dataset-activity";

export function readDatasetActivityLogs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

export function recordDatasetActivity(action, message, level = "info", details = "") {
  const rows = readDatasetActivityLogs();
  const row = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), action, message, level, details: String(details || "") };
  const next = [row, ...rows];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: row }));
  return row;
}

export function subscribeDatasetActivity(listener) {
  const handler = (event) => listener(event.detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
