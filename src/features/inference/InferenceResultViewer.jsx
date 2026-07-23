import { useEffect, useRef, useState } from "react";
import { ChevronRight, RotateCcw, Sun, X, ZoomIn, ZoomOut } from "lucide-react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { prefetchImageWindow } from "../media/viewerMediaRepository.js";
import { useViewerNavigation } from "../media/useViewerNavigation.js";
import { useImageViewerTransform } from "../media/useImageViewerTransform.js";

export function InferenceResultViewer({ rows = [], initialIndex = 0, onClose, predictionItems, predictionBoxStyle, predictionColor }) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(rows.length - 1, initialIndex)));
  const [theme, setTheme] = useState(() => document.querySelector(".app-shell")?.classList.contains("dark") ? "dark" : "light");
  const [imageLoaded, setImageLoaded] = useState(false);
  const previousIndexRef = useRef(initialIndex);
  const row = rows[index];
  const { scale, pan, zoom, fit, stageHandlers } = useImageViewerTransform({ resetKey: row?.project_image_id || index });
  const move = (delta) => setIndex((current) => Math.max(0, Math.min(rows.length - 1, current + delta)));
  const imageSrc = row?.project_image_id ? `/api/project-images/${row.project_image_id}/preview?size=1920` : (row?.image_url || row?.thumb_url || "");
  useViewerNavigation({ enabled: true, length: rows.length, setIndex, onEscape: onClose });
  useEffect(() => {
    const direction = index >= previousIndexRef.current ? 1 : -1;
    previousIndexRef.current = index;
    prefetchImageWindow({ items: rows, index, direction, getSource: (item) => item.project_image_id ? `/api/project-images/${item.project_image_id}/preview?size=1920` : (item.image_url || item.thumb_url || "") });
    return undefined;
  }, [index, rows]);
  useEffect(() => { setImageLoaded(false); }, [index]);
  if (!row) return null;
  return <div className={`viewer-overlay evaluation-sample-dialog inference-result-dialog viewer-${theme}`}>
    <div className="viewer-toolbar"><div><b>推理结果预览</b><span>{row.display_name || "未命名图像"}</span></div><span className="viewer-counter">{index + 1} / {rows.length}</span><span className="viewer-zoom-tools"><button onClick={() => zoom(-.25)} title="缩小"><ZoomOut size={16} /></button><button onClick={() => zoom(.25)} title="放大"><ZoomIn size={16} /></button><button onClick={fit} title="重置（V 切换视图）"><RotateCcw size={16} /></button></span><button onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")} title="切换明暗模式"><Sun size={17} /></button><button onClick={onClose} title="关闭"><X size={18} /></button></div>
    <button className="viewer-page-button viewer-page-prev" disabled={index <= 0} onClick={() => move(-1)} title="上一张"><ChevronRight size={28} /></button>
    <div className="viewer-stage shared-image-viewport" {...stageHandlers}><div className="shared-image-canvas" style={{ "--image-ratio": Number(row.image_width || 16) / Number(row.image_height || 9), aspectRatio: `${Number(row.image_width || 16)} / ${Number(row.image_height || 9)}`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}><AuthenticatedImage src={imageSrc} alt={row.display_name || "推理结果"} draggable="false" onSourceReady={() => setImageLoaded(true)} /><div className={`viewer-box-layer ${imageLoaded ? "ready" : "loading"}`}>{imageLoaded && predictionItems(row.predictions_json).map((prediction, predictionIndex) => { const style = predictionBoxStyle(prediction, row); if (!style) return null; const color = predictionColor(prediction.label); return <i className="prediction-box" key={prediction.id || predictionIndex} style={{ ...style, borderColor: color, "--box-color": color }}>{prediction.score != null && <small>{(Number(prediction.score) * 100).toFixed(2)}%</small>}</i>; })}</div></div></div>
    <aside className="viewer-inspector-panel"><h3>图片信息</h3><div><span>文件</span><b>{row.display_name || "--"}</b></div><div><span>尺寸</span><b>{row.image_width || "--"} × {row.image_height || "--"}</b></div><h3>标签（{predictionItems(row.predictions_json).length}）</h3>{Array.from(new Set(predictionItems(row.predictions_json).map((item) => item.label).filter(Boolean))).map((label) => <div className="viewer-tag-row" key={label}><i style={{ background: predictionColor(label) }} />{label}</div>)}</aside><button className="viewer-page-button viewer-page-next" disabled={index >= rows.length - 1} onClick={() => move(1)} title="下一张"><ChevronRight size={28} /></button>
  </div>;
}
