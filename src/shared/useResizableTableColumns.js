import { useMemo, useRef, useState } from "react";

export function useResizableTableColumns({ storageKey, defaults, minimums }) {
  const tableRef = useRef(null);
  const [widths, setWidths] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      return Array.isArray(saved) && saved.length === defaults.length ? saved : null;
    } catch {
      return null;
    }
  });

  const template = useMemo(
    () => widths ? widths.map((width) => `${Math.round(width)}px`).join(" ") : defaults.join(" "),
    [defaults, widths],
  );

  const beginResize = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    const header = tableRef.current?.querySelector(".asset-table-head");
    const cells = Array.from(header?.children || []).filter((node) => node.tagName === "SPAN");
    if (!cells[index] || !cells[index + 1]) return;
    const initial = cells.map((cell) => cell.getBoundingClientRect().width);
    const startX = event.clientX;
    document.body.classList.add("resizing-table-column");

    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const leftMin = minimums[index] || 64;
      const rightMin = minimums[index + 1] || 64;
      const bounded = Math.max(leftMin - initial[index], Math.min(delta, initial[index + 1] - rightMin));
      const next = [...initial];
      next[index] += bounded;
      next[index + 1] -= bounded;
      setWidths(next);
    };
    const end = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      document.body.classList.remove("resizing-table-column");
      setWidths((current) => {
        if (current) window.localStorage.setItem(storageKey, JSON.stringify(current));
        return current;
      });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
  };

  const resetWidths = () => {
    window.localStorage.removeItem(storageKey);
    setWidths(null);
  };

  return { tableRef, template, beginResize, resetWidths };
}
