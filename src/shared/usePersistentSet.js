import { useState } from "react";

export function usePersistentSet(key, defaults = []) {
  const [value, setValueState] = useState(() => {
    try { const stored = JSON.parse(localStorage.getItem(key) || "null"); return new Set(Array.isArray(stored) ? stored : defaults); } catch { return new Set(defaults); }
  });
  const setValue = (nextOrUpdater) => setValueState((current) => {
    const next = typeof nextOrUpdater === "function" ? nextOrUpdater(current) : nextOrUpdater;
    localStorage.setItem(key, JSON.stringify([...next]));
    return next;
  });
  return [value, setValue];
}
