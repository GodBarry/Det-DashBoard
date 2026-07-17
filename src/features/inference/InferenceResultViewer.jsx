import { useEffect, useState } from "react";
import { ChevronRight, Sun, X } from "lucide-react";
import { AuthenticatedImage, preloadAuthenticatedImage } from "../../components/AuthenticatedImage.jsx";

export function InferenceResultViewer({ rows = [], initialIndex = 0, onClose, predictionItems, predictionBoxStyle, predictionColor }) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(rows.length - 1, initialIndex)));
  const [theme, setTheme] = useState(() => document.querySelector(".app-shell")?.classList.contains("dark") ? "dark" : "light");
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
  if (!row) return null;
  return <div className={`viewer-overlay evaluation-sample-dialog inference-result-dialog viewer-${theme}`}>
    <div className="viewer-toolbar"><div><b>推理结果预览</b><span>{row.display_name || "未命名图像"}</span></div><span className="viewer-counter">{index + 1} / {rows.length}</span><button onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")} title="切换明暗模式"><Sun size={17} /></button><button onClick={onClose} title="关闭"><X size={18} /></button></div>
    <button className="viewer-page-button viewer-page-prev" disabled={index <= 0} onClick={() => move(-1)} title="上一张"><ChevronRight size={28} /></button>
    <div className="viewer-stage"><div className="evaluation-sample-large" style={{ aspectRatio: `${Number(row.image_width || 16)} / ${Number(row.image_height || 9)}` }}><AuthenticatedImage src={imageSrc} alt={row.display_name || "推理结果"} />{predictionItems(row.predictions_json).map((prediction, predictionIndex) => { const style = predictionBoxStyle(prediction, row); if (!style) return null; const color = predictionColor(prediction.label); return <i className="prediction-box" key={prediction.id || predictionIndex} style={{ ...style, borderColor: color, "--box-color": color }}>{prediction.score != null && <small>{(Number(prediction.score) * 100).toFixed(0)}%</small>}</i>; })}</div></div>
    <button className="viewer-page-button viewer-page-next" disabled={index >= rows.length - 1} onClick={() => move(1)} title="下一张"><ChevronRight size={28} /></button>
  </div>;
}
