const STORAGE_KEY = "det-dashboard.dataset-activity-logs";
const EVENT_NAME = "det-dashboard:dataset-activity";

function createActivityId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readDatasetActivityLogs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

export function recordDatasetActivity(action, message, level = "info", details = "") {
  const rows = readDatasetActivityLogs();
  const row = { id: createActivityId(), createdAt: new Date().toISOString(), action, message, level, details: String(details || "") };
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
