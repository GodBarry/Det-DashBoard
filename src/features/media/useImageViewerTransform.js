import { useEffect, useRef, useState } from "react";

export function useImageViewerTransform({ enabled = true, resetKey } = {}) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const lastZoomScaleRef = useRef(1.5);

  const zoom = (delta) => setScale((current) => {
    const next = Math.max(.5, Math.min(6, Number((current + delta).toFixed(2))));
    if (next > 1.01) lastZoomScaleRef.current = next;
    return next;
  });
  const fit = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };
  const toggleZoomMode = () => {
    if (Math.abs(scale - 1) > .01) fit();
    else setScale(Math.max(1.1, lastZoomScaleRef.current || 1.5));
  };

  useEffect(() => { fit(); }, [resetKey]);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!typing && String(event.key || "").toLowerCase() === "v") {
        event.preventDefault();
        toggleZoomMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, scale]);

  return {
    scale,
    pan,
    zoom,
    fit,
    toggleZoomMode,
    stageHandlers: {
      onWheel: (event) => {
        event.preventDefault();
        zoom(event.deltaY < 0 ? .2 : -.2);
      },
      onMouseDown: (event) => setDrag({ x: event.clientX, y: event.clientY, pan }),
      onMouseMove: (event) => drag && setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y }),
      onMouseUp: () => setDrag(null),
      onMouseLeave: () => setDrag(null),
    },
  };
}
