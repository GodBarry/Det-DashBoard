import { useEffect, useState } from "react";
import { ChevronRight, RotateCcw, Sun, X, ZoomIn, ZoomOut } from "lucide-react";
import { AuthenticatedImage, preloadAuthenticatedImage } from "../../components/AuthenticatedImage.jsx";

export function InferenceResultViewer({ rows = [], initialIndex = 0, onClose, predictionItems, predictionBoxStyle, predictionColor }) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(rows.length - 1, initialIndex)));
  const [theme, setTheme] = useState(() => document.querySelector(".app-shell")?.classList.contains("dark") ? "dark" : "light");
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const row = rows[index];
  const move = (delta) => setIndex((current) => Math.max(0, Math.min(rows.length - 1, current + delta)));
  const imageSrc = row?.project_image_id ? `/api/project-images/${row.project_image_id}/preview?size=1920` : (row?.image_url || row?.thumb_url || "");
  useEffect(() => {
    const keydown = (event) => { if (event.key === "ArrowLeft") move(-1); if (event.key === "ArrowRight") move(1); if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [rows.length, onClose]);
  useEffect(() => {
    [-2, -1, 1, 2].forEach((offset) => {
      const neighbor = rows[index + offset];
      if (neighbor?.project_image_id) preloadAuthenticatedImage(`/api/project-images/${neighbor.project_image_id}/preview?size=1920`);
      else if (neighbor?.image_url || neighbor?.thumb_url) preloadAuthenticatedImage(neighbor.image_url || neighbor.thumb_url);
    });
  }, [index, rows]);
  useEffect(() => { setScale(1); setPan({ x: 0, y: 0 }); }, [index]);
  const zoom = (delta) => setScale((current) => Math.max(.5, Math.min(6, Number((current + delta).toFixed(2)))));
  if (!row) return null;
  return <div className={`viewer-overlay evaluation-sample-dialog inference-result-dialog viewer-${theme}`}>
    <div className="viewer-toolbar"><div><b>推理结果预览</b><span>{row.display_name || "未命名图像"}</span></div><span className="viewer-counter">{index + 1} / {rows.length}</span><span className="viewer-zoom-tools"><button onClick={() => zoom(-.25)} title="缩小"><ZoomOut size={16} /></button><button onClick={() => zoom(.25)} title="放大"><ZoomIn size={16} /></button><button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }} title="重置"><RotateCcw size={16} /></button></span><button onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")} title="切换明暗模式"><Sun size={17} /></button><button onClick={onClose} title="关闭"><X size={18} /></button></div>
    <button className="viewer-page-button viewer-page-prev" disabled={index <= 0} onClick={() => move(-1)} title="上一张"><ChevronRight size={28} /></button>
    <div className="viewer-stage shared-image-viewport" onWheel={(event) => { if (!event.ctrlKey) return; event.preventDefault(); zoom(event.deltaY < 0 ? .2 : -.2); }} onMouseDown={(event) => setDrag({ x: event.clientX, y: event.clientY, pan })} onMouseMove={(event) => drag && setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y })} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}><div className="shared-image-canvas" style={{ "--image-ratio": Number(row.image_width || 16) / Number(row.image_height || 9), aspectRatio: `${Number(row.image_width || 16)} / ${Number(row.image_height || 9)}`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}><AuthenticatedImage src={imageSrc} alt={row.display_name || "推理结果"} draggable="false" />{predictionItems(row.predictions_json).map((prediction, predictionIndex) => { const style = predictionBoxStyle(prediction, row); if (!style) return null; const color = predictionColor(prediction.label); return <i className="prediction-box" key={prediction.id || predictionIndex} style={{ ...style, borderColor: color, "--box-color": color }}>{prediction.score != null && <small>{(Number(prediction.score) * 100).toFixed(0)}%</small>}</i>; })}</div></div>
    <aside className="viewer-inspector-panel"><h3>图片信息</h3><div><span>文件</span><b>{row.display_name || "--"}</b></div><div><span>尺寸</span><b>{row.image_width || "--"} × {row.image_height || "--"}</b></div><h3>标签（{predictionItems(row.predictions_json).length}）</h3>{Array.from(new Set(predictionItems(row.predictions_json).map((item) => item.label).filter(Boolean))).map((label) => <div className="viewer-tag-row" key={label}><i style={{ background: predictionColor(label) }} />{label}</div>)}</aside><button className="viewer-page-button viewer-page-next" disabled={index >= rows.length - 1} onClick={() => move(1)} title="下一张"><ChevronRight size={28} /></button>
  </div>;
}
