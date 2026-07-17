import { useEffect, useState } from "react";
import { ChevronRight, Image as ImageIcon, RotateCcw, Sun, X, ZoomIn, ZoomOut } from "lucide-react";
import { AuthenticatedImage, preloadAuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { EvaluationErrorLegend } from "./EvaluationErrorLegend.jsx";

export function EvaluationSampleViewer({
  rows = [],
  initialIndex = 0,
  filter,
  onClose,
  getErrorBoxes,
  getBoxStyle,
}) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(rows.length - 1, initialIndex)));
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const [viewerTheme, setViewerTheme] = useState(() => document.querySelector(".app-shell")?.classList.contains("dark") ? "dark" : "light");
  const row = rows[index];
  const move = (delta) => setIndex((value) => Math.max(0, Math.min(rows.length - 1, value + delta)));

  useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [index]);

  useEffect(() => {
    [-2, -1, 1, 2].forEach((offset) => {
      const neighbor = rows[index + offset];
      const neighborId = neighbor?.project_image_id || neighbor?.projectImageId || neighbor?.id;
      const src = neighborId ? `/api/project-images/${neighborId}/preview?size=1920` : (neighbor?.image_url || neighbor?.thumb_url);
      if (src) preloadAuthenticatedImage(src);
    });
  }, [index, rows]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows.length, onClose]);

  if (!row) return null;
  const imageId = row.project_image_id || row.projectImageId || row.id;
  const imageSrc = imageId ? `/api/project-images/${imageId}/preview?size=1920` : (row.image_url || row.thumb_url || "");
  const boxes = getErrorBoxes(row, filter);
  const zoom = (delta) => setScale((current) => Math.max(.5, Math.min(6, Number((current + delta).toFixed(2)))));

  return (
    <div className={`viewer-overlay evaluation-sample-dialog viewer-${viewerTheme}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="viewer-toolbar">
        <div><b>错误样本检查</b><span>{row.display_name || "未命名图像"}</span></div>
        <span className="viewer-counter">{index + 1} / {rows.length}</span>
        <em>{filter === "false_negative" ? "漏检" : filter === "false_positive" ? "误检" : filter === "localization" ? "定位偏差" : "类别错误"}</em>
        <span className="viewer-zoom-tools"><button onClick={() => zoom(-.25)} title="缩小"><ZoomOut size={16} /></button><button onClick={() => zoom(.25)} title="放大"><ZoomIn size={16} /></button><button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }} title="重置"><RotateCcw size={16} /></button></span>
        <button className="viewer-theme-toggle" onClick={() => setViewerTheme((value) => value === "dark" ? "light" : "dark")} title="切换查看器明暗模式"><Sun size={17} /></button>
        <button onClick={onClose} title="关闭"><X size={18} /></button>
      </div>
      <button className="viewer-page-button viewer-page-prev" disabled={index <= 0} onClick={() => move(-1)} title="上一"><ChevronRight size={28} /></button>
      <div className="viewer-stage shared-image-viewport" onWheel={(event) => { if (!event.ctrlKey) return; event.preventDefault(); zoom(event.deltaY < 0 ? .2 : -.2); }} onMouseDown={(event) => setDrag({ x: event.clientX, y: event.clientY, pan })} onMouseMove={(event) => drag && setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y })} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
        <div className="shared-image-canvas evaluation-sample-large" style={{ "--image-ratio": Number(row.image_width || 16) / Number(row.image_height || 9), aspectRatio: `${Number(row.image_width || 16)} / ${Number(row.image_height || 9)}`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
          {imageSrc && !imageFailed ? <AuthenticatedImage src={imageSrc} draggable="false" alt={row.display_name || "错误样本"} onLoad={() => setImageLoaded(true)} onError={() => { setImageLoaded(false); setImageFailed(true); }} /> : <div className="evaluation-sample-load-error"><ImageIcon size={34} /><b>图片加载失败</b><span>{imageId ? `图片索引：${imageId}` : "该记录没有关联图片索引"}</span></div>}
          {imageLoaded && boxes.map((box, boxIndex) => {
            const style = getBoxStyle(box.item, row);
            return style ? <i className={`sample-box ${box.type}`} key={boxIndex} style={style}><small>{box.label}</small></i> : null;
          })}
        </div>
      </div>
      <EvaluationErrorLegend filter={filter} />
      <aside className="viewer-inspector-panel"><h3>图片信息</h3><div><span>文件</span><b>{row.display_name || "--"}</b></div><div><span>尺寸</span><b>{row.image_width || "--"} × {row.image_height || "--"}</b></div><h3>标签（{boxes.length}）</h3>{Array.from(new Set(boxes.map((box) => box.label).filter(Boolean))).map((label) => <div className="viewer-tag-row" key={label}><i />{label}</div>)}</aside><button className="viewer-page-button viewer-page-next" disabled={index >= rows.length - 1} onClick={() => move(1)} title="下一"><ChevronRight size={28} /></button>
    </div>
  );
}
