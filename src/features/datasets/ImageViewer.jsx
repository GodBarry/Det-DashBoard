import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { colors } from "../../shared/presentation.js";
import { AuthenticatedImage, preloadAuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
function labelColor(label = "") {

let hash = 0;

for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;

return colors[hash % colors.length];

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

function ImageViewer({ items, index, setIndex, onClose, onSaved, readOnly = false, saveAnnotations }) {

const item = items[index];

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

useEffect(() => {

if (!item?.id || loadedItemId !== item.id) return undefined;

let cancelled = false;

const preloadNeighbors = async () => {

for (const offset of [1, -1, 2, -2]) {

if (cancelled) return;

const neighbor = items[index + offset];

if (neighbor?.id) await preloadAuthenticatedImage(`/api/project-images/${neighbor.id}/preview?size=1920`);

}

};

preloadNeighbors();

return () => { cancelled = true; };

}, [index, item?.id, items, loadedItemId]);

useEffect(() => {

setScale(1);

setPan({ x: 0, y: 0 });

setEditMode(false);

setTool("select");

setDraft((item?.annotations || []).map((ann) => ({ ...ann })));

setSelectedAnnId(null);

setDefaultLabel((item?.annotations || [])[0]?.label || "");

setNaturalSize({ width: Number(item?.image_width || 1), height: Number(item?.image_height || 1) });

}, [item?.id]);

useEffect(() => {

const onKey = (event) => {

if (event.key === "Escape") {

if (editMode) setSelectedAnnId(null);

else onClose();

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

}, [editMode, items.length, onClose, selectedAnnId, setIndex]);

const zoom = (delta) => setScale((value) => Math.min(6, Math.max(0.25, Number((value + delta).toFixed(2)))));

const prev = () => setIndex(Math.max(0, index - 1));

const next = () => setIndex(Math.min(items.length - 1, index + 1));

const width = Number(item.image_width || naturalSize.width || 1);

const height = Number(item.image_height || naturalSize.height || 1);

const shownAnnotations = editMode ? draft : item.annotations || [];

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

<div className="viewer-overlay" onMouseUp={() => { setDrag(null); setEditDrag(null); }} onMouseLeave={() => { setDrag(null); setEditDrag(null); }}>

<div className="viewer-topbar">

{!readOnly && <button className={editMode ? "active-tool edit-toggle" : "edit-toggle"} onClick={() => setEditMode((value) => !value)}>{editMode ? "退出编" : "编辑"}</button>}

<div className="viewer-file-identity">

<b>{item.display_name}</b>

<code title={item.absolute_path || item.source_path || ""}>{item.absolute_path || item.source_path || "未记录绝对路"}</code>

</div>

<span>{index + 1} / {items.length}</span>

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

<button onClick={onClose}><X size={16} /></button>

</div>

<button className="viewer-nav prev" disabled={index <= 0} onClick={prev}></button>

<button className="viewer-nav next" disabled={index >= items.length - 1} onClick={next}></button>

<div

className="viewer-stage"

onWheel={(event) => {

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

<div className="viewer-image-wrap" style={{ aspectRatio: `${Number(item.image_width || 16)} / ${Number(item.image_height || 9)}`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>

<AuthenticatedImage src={`/api/project-images/${item.id}/preview?size=1920`} placeholderSrc={`/api/project-images/${item.id}/thumb`} draggable="false" onSourceReady={() => setLoadedItemId(item.id)} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })} />

{editMode ? (

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

)}

</div>

</div>

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
