import { useEffect, useRef } from "react";

export function useViewerNavigation({ enabled, length, setIndex, onEscape }) {
  const stateRef = useRef({ enabled, length, setIndex, onEscape });
  const frameRef = useRef(null);
  const deltaRef = useRef(0);
  stateRef.current = { enabled, length, setIndex, onEscape };

  useEffect(() => {
    const flush = () => {
      frameRef.current = null;
      const delta = deltaRef.current;
      deltaRef.current = 0;
      if (!delta) return;
      const state = stateRef.current;
      state.setIndex((value) => Math.max(0, Math.min(state.length - 1, value + delta)));
    };
    const onKeyDown = (event) => {
      const state = stateRef.current;
      if (event.key === "Escape") {
        state.onEscape?.();
        return;
      }
      if (!state.enabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      deltaRef.current += event.key === "ArrowRight" ? 1 : -1;
      if (frameRef.current == null) frameRef.current = window.requestAnimationFrame(flush);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);
}
