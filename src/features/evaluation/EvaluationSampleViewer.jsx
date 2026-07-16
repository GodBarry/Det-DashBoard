import { useEffect, useState } from "react";
import { ChevronRight, Image as ImageIcon, Sun, X } from "lucide-react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";

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
  const [viewerTheme, setViewerTheme] = useState(() => document.querySelector(".app-shell")?.classList.contains("dark") ? "dark" : "light");
  const row = rows[index];
  const move = (delta) => setIndex((value) => Math.max(0, Math.min(rows.length - 1, value + delta)));

  useEffect(() => {
    setImageFailed(false);
  }, [index]);

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
  const imageSrc = imageId ? `/api/project-images/${imageId}/full` : (row.image_url || row.thumb_url || "");
  const boxes = getErrorBoxes(row, filter);

  return (
    <div className={`viewer-overlay evaluation-sample-dialog viewer-${viewerTheme}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="viewer-toolbar">
        <div><b>错误样本检查</b><span>{row.display_name || "未命名图像"}</span></div>
        <span className="viewer-counter">{index + 1} / {rows.length}</span>
        <em>{filter === "false_negative" ? "漏检" : filter === "false_positive" ? "误检" : filter === "localization" ? "定位偏差" : "类别错误"}</em>
        <button className="viewer-theme-toggle" onClick={() => setViewerTheme((value) => value === "dark" ? "light" : "dark")} title="切换查看器明暗模式"><Sun size={17} /></button>
        <button onClick={onClose} title="关闭"><X size={18} /></button>
      </div>
      <button className="viewer-page-button viewer-page-prev" disabled={index <= 0} onClick={() => move(-1)} title="上一"><ChevronRight size={28} /></button>
      <div className="viewer-stage">
        <div className="evaluation-sample-large">
          {imageSrc && !imageFailed ? <AuthenticatedImage src={imageSrc} draggable="false" alt={row.display_name || "错误样本"} onError={() => setImageFailed(true)} /> : <div className="evaluation-sample-load-error"><ImageIcon size={34} /><b>图片加载失败</b><span>{imageId ? `图片索引：${imageId}` : "该记录没有关联图片索引"}</span></div>}
          {boxes.map((box, boxIndex) => {
            const style = getBoxStyle(box.item, row);
            return style ? <i className={`sample-box ${box.type}`} key={boxIndex} style={style}><small>{box.label}</small>{box.type.includes("false_positive") && <strong>×</strong>}</i> : null;
          })}
        </div>
      </div>
      <button className="viewer-page-button viewer-page-next" disabled={index >= rows.length - 1} onClick={() => move(1)} title="下一"><ChevronRight size={28} /></button>
    </div>
  );
}
