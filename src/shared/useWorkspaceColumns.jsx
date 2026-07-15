import { useEffect, useState } from "react";

export function useWorkspaceColumns(storageKey, defaults) {
  const [columns, setColumns] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey));
      return saved && Number(saved.left) && Number(saved.right) ? saved : defaults;
    } catch {
      return defaults;
    }
  });
  const beginResize = (side, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startValue = columns[side];
    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const min = side === "left" ? 220 : 300;
      const max = side === "left" ? 460 : 620;
      setColumns((current) => ({ ...current, [side]: Math.max(min, Math.min(max, startValue + (side === "left" ? delta : -delta))) }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      document.body.classList.remove("resizing-workspace");
    };
    document.body.classList.add("resizing-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };
  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(columns));
  }, [columns, storageKey]);
  return { columns, beginResize };
}

export function WorkspaceResizeHandle({ side, onPointerDown }) {
  return <div className={`workspace-resize-handle ${side}`} role="separator" aria-orientation="vertical" aria-label={`调整${side === "left" ? "左侧" : "右侧"}栏宽度`} onPointerDown={(event) => onPointerDown(side, event)} />;
}
