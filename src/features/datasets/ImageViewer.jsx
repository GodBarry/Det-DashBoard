import { useEffect, useState } from "react";
import { ChevronRight, Sun, X } from "lucide-react";

import { colors } from "../../shared/presentation.js";
import { modalityLabel, sceneLabel, viewLabel } from "../../shared/datasetMetadata.js";
import { AuthenticatedImage, preloadAuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
function labelColor(label = "") {

let hash = 0;

for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;

return colors[hash % colors.length];

}

function imageMetadata(item, annotations) {
  const keyword = String(item.keyword || item.keywords || "").trim();
  const captureMatch = keyword.match(/(?:多?拍摄日期|拍摄时间|capture(?:d)?(?:At|Time)?)[：:]\s*([^,，;；]+)/i);
  const captureTime = item.capture_time || item.captured_at || item.shooting_time || captureMatch?.[1]?.trim() || "--";
  const remainingKeyword = captureMatch ? keyword.replace(captureMatch[0], "").replace(/^[、,，;；\s]+|[、,，;；\s]+$/g, "") : keyword;
  const ignored = new Set(["source_format", "source_file", "filename", "line", "difficult"]);
  const attributes = [];
  for (const annotation of annotations || []) {
    const raw = annotation.attributes_json || annotation.attributes;
    let values = raw;
    if (typeof raw === "string") {
      try { values = JSON.parse(raw); } catch { values = null; }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      if (ignored.has(key) || value == null || value === "") continue;
      attributes.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
    }
  }
  return { captureTime, otherTags: [...new Set([remainingKeyword, ...attributes].filter(Boolean))] };
}

function AnnotationOverlay({ item, compact = false }) {

const width = Number(item?.image_width || 1);

const height = Number(item?.image_height || 1);

const annotations = item?.annotations || [];

return (

<svg className={`ann-layer ${compact ? "compact" : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">

{annotations.map((ann) => (

<g key={ann.id}>

<rect

x={Number(ann.bbox_x || 0)}

y={Number(ann.bbox_y || 0)}

width={Math.max(1, Number(ann.bbox_w || 0))}

height={Math.max(1, Number(ann.bbox_h || 0))}

fill="none"

stroke={labelColor(ann.label)}

strokeWidth={compact ? Math.max(4, width / 600) : Math.max(3, width / 900)}

/>

{!compact && (

<text x={Number(ann.bbox_x || 0)} y={Math.max(14, Number(ann.bbox_y || 0) - 5)} fill={labelColor(ann.label)} fontSize={Math.max(20, width / 90)}>{ann.label}</text>

)}

</g>

))}

</svg>

);

}

function ImageViewer({ items, index, setIndex, onClose, onSaved, readOnly = false, saveAnnotations, page = 1, pageSize = 48, totalItems = items.length, loadPage, onPageChange, sequenceUrl }) {

const [viewerItems, setViewerItems] = useState(items);
const [viewerPage, setViewerPage] = useState(page);
const [loadingPage, setLoadingPage] = useState(false);
const item = viewerItems[index];

useEffect(() => {
  if (!sequenceUrl) return undefined;
  const controller = new AbortController();
  fetch(sequenceUrl, { signal: controller.signal })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("加载项目图片序列失败")))
    .then((data) => {
      const nextItems = Array.isArray(data.items) ? data.items : [];
      if (!nextItems.length) return;
      const currentId = viewerItems[index]?.id || items[index]?.id;
      const nextIndex = Math.max(0, nextItems.findIndex((row) => row.id === currentId));
      const existing = new Map(viewerItems.map((row) => [row.id, row]));
      setViewerItems(nextItems.map((row) => existing.has(row.id) ? { ...row, annotations: existing.get(row.id).annotations } : row));
      setIndex(nextIndex < 0 ? 0 : nextIndex);
    })
    .catch(() => {})
    .finally(() => {});
  return () => controller.abort();
}, [sequenceUrl]);

const [scale, setScale] = useState(1);

const [pan, setPan] = useState({ x: 0, y: 0 });

const [drag, setDrag] = useState(null);

const [editMode, setEditMode] = useState(false);

const [tool, setTool] = useState("select");

const [draft, setDraft] = useState([]);

const [selectedAnnId, setSelectedAnnId] = useState(null);

const [editDrag, setEditDrag] = useState(null);

const [defaultLabel, setDefaultLabel] = useState("");

const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });

const [loadedItemId, setLoadedItemId] = useState(null);
const [viewerTheme, setViewerTheme] = useState(() => document.querySelector(".app-shell")?.classList.contains("dark") ? "dark" : "light");

useEffect(() => {
  if (!item?.id || Array.isArray(item.annotations)) return undefined;
  const controller = new AbortController();
  fetch(`/api/project-images/${item.id}/annotations`, { signal: controller.signal })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("加载图片标注失败")))
    .then((data) => {
      const annotations = Array.isArray(data.annotations) ? data.annotations : [];
      setViewerItems((rows) => rows.map((row) => row.id === item.id ? { ...row, annotations } : row));
      setDraft(annotations.map((annotation) => ({ ...annotation })));
      setDefaultLabel(annotations[0]?.label || "");
    })
    .catch(() => {});
  return () => controller.abort();
}, [item?.id]);

useEffect(() => {

if (!item?.id || loadedItemId !== item.id) return undefined;

let cancelled = false;

const preloadNeighbors = () => {
  const neighbor = viewerItems[index + 1] || viewerItems[index - 1];
  if (!neighbor?.id) return;
  const run = () => { if (!cancelled) preloadAuthenticatedImage(`/api/project-images/${neighbor.id}/preview?size=1920`); };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 250 });
  else window.setTimeout(run, 80);
};

preloadNeighbors();

return () => { cancelled = true; };

}, [index, item?.id, viewerItems, loadedItemId]);

useEffect(() => {
  if (!loadPage) setViewerItems(items);
}, [items, loadPage]);

useEffect(() => {

setScale(1);

setPan({ x: 0, y: 0 });

setEditMode(false);

setTool("select");

setDraft((item?.annotations || []).map((ann) => ({ ...ann })));

setSelectedAnnId(null);

setDefaultLabel((item?.annotations || [])[0]?.label || "");

setNaturalSize({ width: Number(item?.image_width || 1), height: Number(item?.image_height || 1) });
setLoadedItemId(null);

}, [item?.id]);

useEffect(() => {

const onKey = (event) => {

if (event.key === "Escape") {

if (editMode) setSelectedAnnId(null);

else { onPageChange?.(viewerPage); onClose(); }

}

if (!editMode && event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));

if (!editMode && event.key === "ArrowRight") setIndex((value) => Math.min(items.length - 1, value + 1));

if (editMode && (event.key === "Delete" || event.key === "Backspace") && selectedAnnId) {

setDraft((rows) => rows.filter((ann) => ann.id !== selectedAnnId));

setSelectedAnnId(null);

}

};

window.addEventListener("keydown", onKey);

return () => window.removeEventListener("keydown", onKey);

}, [editMode, viewerItems.length, onClose, onPageChange, selectedAnnId, setIndex, viewerPage]);

const zoom = (delta) => setScale((value) => Math.min(6, Math.max(0.25, Number((value + delta).toFixed(2)))));

const movePage = async (delta) => {
  if (sequenceUrl) return;
  const targetPage = viewerPage + delta;
  const totalPages = Math.max(1, Math.ceil(Number(totalItems || 0) / Math.max(1, Number(pageSize) || 48)));
  if (!loadPage || targetPage < 1 || targetPage > totalPages || loadingPage) return;
  setLoadingPage(true);
  try {
    const nextItems = await loadPage(targetPage);
    if (nextItems?.length) {
      setViewerPage(targetPage);
      setViewerItems(nextItems);
      setIndex(delta > 0 ? 0 : nextItems.length - 1);
    }
  } finally { setLoadingPage(false); }
};
const prev = () => index > 0 ? setIndex(index - 1) : movePage(-1);
const next = () => index < viewerItems.length - 1 ? setIndex(index + 1) : movePage(1);

const width = Number(item.image_width || naturalSize.width || 1);

const height = Number(item.image_height || naturalSize.height || 1);

const shownAnnotations = editMode ? draft : item.annotations || [];
const annotationCounts = shownAnnotations.reduce((rows, annotation) => {
  const label = String(annotation.label || "未分类");
  rows.set(label, (rows.get(label) || 0) + 1);
  return rows;
}, new Map());
const metadata = imageMetadata(item, shownAnnotations);

const selectedAnn = draft.find((ann) => ann.id === selectedAnnId);

const pointFromEvent = (event) => {

const svg = event.currentTarget.closest(".viewer-image-wrap")?.querySelector("svg");

if (!svg) return { x: 0, y: 0 };

const rect = svg.getBoundingClientRect();

return {

x: Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width)),

y: Math.max(0, Math.min(height, ((event.clientY - rect.top) / rect.height) * height)),

};

};

const updateAnn = (id, patch) => setDraft((rows) => rows.map((ann) => ann.id === id ? { ...ann, ...patch } : ann));

const normalizeBox = (box) => {

const x1 = Math.max(0, Math.min(width, Math.min(box.x1, box.x2)));

const y1 = Math.max(0, Math.min(height, Math.min(box.y1, box.y2)));

const x2 = Math.max(0, Math.min(width, Math.max(box.x1, box.x2)));

const y2 = Math.max(0, Math.min(height, Math.max(box.y1, box.y2)));

return { bbox_x: x1, bbox_y: y1, bbox_w: Math.max(1, x2 - x1), bbox_h: Math.max(1, y2 - y1) };

};

const save = async () => {

if (saveAnnotations) {

try {

const data = await saveAnnotations(draft);

const annotations = data?.annotations || draft;

setDraft(annotations.map((ann) => ({ ...ann })));

onSaved?.(item.id, annotations);

setEditMode(false);

} catch (error) {

window.alert("提交失败: " + error.message);

}

return;

}

fetch(`/api/project-images/${item.id}/annotations/save`, {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ annotations: draft }),

})

.then((r) => r.json())

.then((data) => {

const annotations = data.annotations || [];

setDraft(annotations.map((ann) => ({ ...ann })));

onSaved?.(item.id, annotations);

setEditMode(false);

})

.catch((error) => window.alert("保存失败: " + error.message));

};

return (

<div className={`viewer-overlay dataset-image-dialog viewer-${viewerTheme}`} onMouseUp={() => { setDrag(null); setEditDrag(null); }} onMouseLeave={() => { setDrag(null); setEditDrag(null); }}>

<div className="viewer-topbar">

{!readOnly && <button className={editMode ? "active-tool edit-toggle" : "edit-toggle"} onClick={() => setEditMode((value) => !value)}>{editMode ? "退出编" : "编辑"}</button>}

<div className="viewer-file-identity">

<b>{item.display_name}</b>

<code title={item.absolute_path || item.source_path || ""}>{item.absolute_path || item.source_path || "未记录绝对路"}</code>

</div>

<span>{sequenceUrl ? `${index + 1} / ${viewerItems.length}` : (loadPage ? `${(viewerPage - 1) * pageSize + index + 1} / ${totalItems}` : `${index + 1} / ${viewerItems.length}`)}</span>

{editMode && (

<>

<button className={tool === "select" ? "active-tool" : ""} onClick={() => setTool("select")}>选择</button>

<button className={tool === "draw" ? "active-tool" : ""} onClick={() => setTool("draw")}>画框</button>

<input className="label-input" value={defaultLabel} onChange={(event) => setDefaultLabel(event.target.value)} placeholder="标签" />

<button disabled={!selectedAnnId} onClick={() => { setDraft((rows) => rows.filter((ann) => ann.id !== selectedAnnId)); setSelectedAnnId(null); }}>删除</button>

<button className="save-ann" onClick={save}>保存</button>

</>

)}

<button onClick={() => zoom(-0.25)}>-</button>

<button onClick={() => zoom(0.25)}>+</button>

<button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>重置</button>

<button onClick={() => setViewerTheme((value) => value === "dark" ? "light" : "dark")} title="切换明暗模式"><Sun size={16} /></button>

<button onClick={() => { onPageChange?.(viewerPage); onClose(); }}><X size={16} /></button>

</div>

<button className="viewer-page-button viewer-page-prev" title="上一张" disabled={sequenceUrl ? index <= 0 : (loadingPage || (!loadPage && index <= 0) || (loadPage && viewerPage <= 1 && index <= 0))} onClick={prev}><ChevronRight size={28} /></button>

<button className="viewer-page-button viewer-page-next" title="下一张" disabled={sequenceUrl ? index >= viewerItems.length - 1 : (loadingPage || (!loadPage && index >= viewerItems.length - 1) || (loadPage && (viewerPage * pageSize >= totalItems) && index >= viewerItems.length - 1))} onClick={next}><ChevronRight size={28} /></button>

<div

className="viewer-stage"

onWheel={(event) => {

if (!event.ctrlKey) return;
event.preventDefault();

zoom(event.deltaY < 0 ? 0.2 : -0.2);

}}

onMouseDown={(event) => {

if (!editMode) setDrag({ x: event.clientX, y: event.clientY, pan });

}}

onMouseMove={(event) => {

if (!drag) return;

setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });

}}

>

<div className="viewer-image-wrap" style={{ "--image-ratio": Number(item.image_width || 16) / Number(item.image_height || 9), aspectRatio: `${Number(item.image_width || 16)} / ${Number(item.image_height || 9)}`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>

<AuthenticatedImage fetchPriority="high" src={`/api/project-images/${item.id}/preview?size=1920`} placeholderSrc={`/api/project-images/${item.id}/thumb`} draggable="false" onLoad={(event) => { setNaturalSize({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 }); setLoadedItemId(item.id); }} />

{loadedItemId === item.id && (editMode ? (

<EditableAnnotationLayer

width={width}

height={height}

annotations={shownAnnotations}

selectedId={selectedAnnId}

setSelectedId={setSelectedAnnId}

tool={tool}

defaultLabel={defaultLabel}

setDefaultLabel={setDefaultLabel}

setDraft={setDraft}

editDrag={editDrag}

setEditDrag={setEditDrag}

updateAnn={updateAnn}

normalizeBox={normalizeBox}

pointFromEvent={pointFromEvent}

/>

) : (

<AnnotationOverlay item={{ ...item, annotations: shownAnnotations }} />

))}

</div>

</div>

<aside className="viewer-inspector-panel">
<h3>图片信息</h3>
<div><span>文件</span><b>{item.display_name}</b></div>
<div><span>尺寸</span><b>{item.image_width || "--"} × {item.image_height || "--"}</b></div>
<div><span>模态</span><b>{modalityLabel(item.modality)}</b></div>
<div><span>视角</span><b>{viewLabel(item.view)}</b></div>
<div><span>场景</span><b>{sceneLabel(item.scene)}</b></div>
<div><span>拍摄时间</span><b>{metadata.captureTime}</b></div>
<div><span>其他标签</span><b>{metadata.otherTags.length ? metadata.otherTags.join("、") : "--"}</b></div>
<h3>标签（{shownAnnotations.length}）</h3>
{annotationCounts.size ? Array.from(annotationCounts).map(([label, count]) => <div className="viewer-tag-row" key={label}><i style={{ background: labelColor(label) }} /><span>{label}</span><b>{count}</b></div>) : <p className="muted">暂无标签</p>}
</aside>

{editMode && selectedAnn && (

<div className="edit-sidecar">

<label>标签<input value={selectedAnn.label || ""} onChange={(event) => { updateAnn(selectedAnn.id, { label: event.target.value }); setDefaultLabel(event.target.value); }} /></label>

<span>x {Number(selectedAnn.bbox_x).toFixed(1)} · y {Number(selectedAnn.bbox_y).toFixed(1)}</span>

<span>w {Number(selectedAnn.bbox_w).toFixed(1)} · h {Number(selectedAnn.bbox_h).toFixed(1)}</span>

</div>

)}

</div>

);

}

function EditableAnnotationLayer({ width, height, annotations, selectedId, setSelectedId, tool, defaultLabel, setDefaultLabel, setDraft, editDrag, setEditDrag, updateAnn, normalizeBox, pointFromEvent }) {

const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const handlePoint = (ann, handle) => {

const x = Number(ann.bbox_x || 0);

const y = Number(ann.bbox_y || 0);

const w = Number(ann.bbox_w || 1);

const h = Number(ann.bbox_h || 1);

const xs = { w: x, n: x + w / 2, s: x + w / 2, e: x + w, nw: x, sw: x, ne: x + w, se: x + w };

const ys = { n: y, w: y + h / 2, e: y + h / 2, s: y + h, nw: y, ne: y, sw: y + h, se: y + h };

return { x: xs[handle], y: ys[handle] };

};

const beginDraw = (event) => {

if (tool !== "draw") return;

event.stopPropagation();

const p = pointFromEvent(event);

const id = `tmp_${Date.now()}`;

const label = defaultLabel.trim() || "unknown";

setDefaultLabel(label);

setDraft((rows) => [...rows, { id, label, bbox_x: p.x, bbox_y: p.y, bbox_w: 1, bbox_h: 1, shape_type: "rectangle" }]);

setSelectedId(id);

setEditDrag({ type: "draw", id, start: p });

};

const moveDrag = (event) => {

if (!editDrag) return;

event.stopPropagation();

const p = pointFromEvent(event);

const ann = annotations.find((item) => item.id === editDrag.id);

if (!ann) return;

if (editDrag.type === "draw") {

updateAnn(editDrag.id, normalizeBox({ x1: editDrag.start.x, y1: editDrag.start.y, x2: p.x, y2: p.y }));

}

if (editDrag.type === "move") {

const dx = p.x - editDrag.start.x;

const dy = p.y - editDrag.start.y;

updateAnn(editDrag.id, {

bbox_x: Math.max(0, Math.min(width - Number(ann.bbox_w), editDrag.origin.x + dx)),

bbox_y: Math.max(0, Math.min(height - Number(ann.bbox_h), editDrag.origin.y + dy)),

});

}

if (editDrag.type === "resize") {

const o = editDrag.origin;

const left = editDrag.handle.includes("w") ? p.x : o.x;

const right = editDrag.handle.includes("e") ? p.x : o.x + o.w;

const top = editDrag.handle.includes("n") ? p.y : o.y;

const bottom = editDrag.handle.includes("s") ? p.y : o.y + o.h;

updateAnn(editDrag.id, normalizeBox({ x1: left, y1: top, x2: right, y2: bottom }));

}

};

return (

<svg className="ann-layer editable" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onMouseDown={beginDraw} onMouseMove={moveDrag} onMouseUp={() => setEditDrag(null)}>

{annotations.map((ann) => {

const selected = ann.id === selectedId;

const color = labelColor(ann.label);

return (

<g key={ann.id}>

<rect

className={selected ? "edit-box selected" : "edit-box"}

x={Number(ann.bbox_x || 0)}

y={Number(ann.bbox_y || 0)}

width={Math.max(1, Number(ann.bbox_w || 0))}

height={Math.max(1, Number(ann.bbox_h || 0))}

fill="rgba(0,0,0,0.01)"

stroke={color}

strokeWidth={selected ? Math.max(5, width / 550) : Math.max(3, width / 900)}

onMouseDown={(event) => {

if (tool !== "select") return;

event.stopPropagation();

const p = pointFromEvent(event);

setSelectedId(ann.id);

setEditDrag({ type: "move", id: ann.id, start: p, origin: { x: Number(ann.bbox_x), y: Number(ann.bbox_y) } });

}}

/>

<text x={Number(ann.bbox_x || 0)} y={Math.max(18, Number(ann.bbox_y || 0) - 6)} fill={color} fontSize={Math.max(22, width / 85)}>{ann.label}</text>

{selected && handles.map((handle) => {

const p = handlePoint(ann, handle);

return (

<rect

key={handle}

className={`resize-handle ${handle}`}

x={p.x - width / 160}

y={p.y - width / 160}

width={width / 80}

height={width / 80}

fill="#fff"

stroke={color}

strokeWidth={Math.max(2, width / 1200)}

onMouseDown={(event) => {

event.stopPropagation();

const start = pointFromEvent(event);

setEditDrag({ type: "resize", id: ann.id, handle, start, origin: { x: Number(ann.bbox_x), y: Number(ann.bbox_y), w: Number(ann.bbox_w), h: Number(ann.bbox_h) } });

}}

/>

);

})}

</g>

);

})}

</svg>

);

}

export { AnnotationOverlay, EditableAnnotationLayer, ImageViewer, labelColor };
