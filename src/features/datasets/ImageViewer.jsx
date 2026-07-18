import { useEffect, useRef, useState } from "react";
import { ChevronRight, History, MousePointer2, Route, ScanLine, ScrollText, Sun, Undo2, X, XCircle } from "lucide-react";

import { categoryColor } from "../../shared/presentation.js";
import { modalityLabel, sceneLabel, viewLabel } from "../../shared/datasetMetadata.js";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { prefetchViewerWindow, setViewerAnnotations, useViewerAnnotations } from "../media/viewerMediaRepository.js";
import { useViewerNavigation } from "../media/useViewerNavigation.js";
function labelColor(label = "") {
return categoryColor(label);
}

function algorithmCapabilities(algorithm) {
  let capabilities = algorithm?.capabilities_json || {};
  if (typeof capabilities === "string") {
    try { capabilities = JSON.parse(capabilities); } catch { capabilities = {}; }
  }
  return capabilities;
}

function supportsAnnotationOperation(algorithm, operation) {
  return (algorithmCapabilities(algorithm).operations || []).some((entry) => entry?.name === operation);
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

function ImageViewer({ items, index: externalIndex, setIndex: setExternalIndex, onClose, onSaved, readOnly = false, saveAnnotations, page = 1, pageSize = 48, totalItems = items.length, loadPage, onPageChange, sequenceUrl }) {

const [viewerItems, setViewerItems] = useState(items);
const [viewerPage, setViewerPage] = useState(page);
const [loadingPage, setLoadingPage] = useState(false);
const [sequenceIndex, setSequenceIndex] = useState(externalIndex);
const previousIndexRef = useRef(externalIndex);
const index = sequenceUrl ? sequenceIndex : externalIndex;
const setIndex = sequenceUrl ? setSequenceIndex : setExternalIndex;
const item = viewerItems[index];
const annotations = useViewerAnnotations(item?.id, item?.annotations);

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
const [annotationMode, setAnnotationMode] = useState("manual");
const [annotationAlgorithms, setAnnotationAlgorithms] = useState([]);
const [annotationAlgorithmId, setAnnotationAlgorithmId] = useState("");
const [annotationModels, setAnnotationModels] = useState([]);
const [annotationModelId, setAnnotationModelId] = useState("");
const [annotationEnvironments, setAnnotationEnvironments] = useState([]);
const [annotationEnvironmentId, setAnnotationEnvironmentId] = useState("");
const [annotationAssetLinks, setAnnotationAssetLinks] = useState([]);
const [annotationSession, setAnnotationSession] = useState(null);
const [annotationTask, setAnnotationTask] = useState(null);
const [annotationMessage, setAnnotationMessage] = useState("");
const [annotationSuggestions, setAnnotationSuggestions] = useState([]);
const [showTaskHistory, setShowTaskHistory] = useState(false);
const [annotationTaskHistory, setAnnotationTaskHistory] = useState([]);
const [annotationTaskLogs, setAnnotationTaskLogs] = useState([]);
const [annotationLastCommit, setAnnotationLastCommit] = useState(null);

const [tool, setTool] = useState("select");

const [draft, setDraft] = useState([]);

const [selectedAnnId, setSelectedAnnId] = useState(null);

const [editDrag, setEditDrag] = useState(null);

const [defaultLabel, setDefaultLabel] = useState("");

const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });

const [loadedItemId, setLoadedItemId] = useState(null);
const [viewerTheme, setViewerTheme] = useState(() => document.querySelector(".app-shell")?.classList.contains("dark") ? "dark" : "light");

useEffect(() => {
  if (!item?.id) return undefined;

  const direction = index >= previousIndexRef.current ? 1 : -1;
  previousIndexRef.current = index;
  const projectId = sequenceUrl?.match(/^\/api\/projects\/([^/]+)\/images/)?.[1];
  prefetchViewerWindow({ projectId, items: viewerItems, index, direction }).catch(() => {});
  return undefined;
}, [index, item?.id, viewerItems, sequenceUrl]);

useEffect(() => {
  if (!loadPage) setViewerItems(items);
}, [items, loadPage]);

useEffect(() => {

setScale(1);

setPan({ x: 0, y: 0 });

setEditMode(false);

setAnnotationMode("manual");

setAnnotationSession(null);

setAnnotationTask(null);

setAnnotationMessage("");
setAnnotationSuggestions([]);

setTool("select");

setDraft([]);

setSelectedAnnId(null);

setDefaultLabel("");

setNaturalSize({ width: Number(item?.image_width || 1), height: Number(item?.image_height || 1) });
setLoadedItemId(null);

}, [item?.id]);

useEffect(() => {
  if (annotationAlgorithms.length) return;
  fetch("/api/ml/algorithm-assets?scope=all")
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("无法加载算法资产")))
    .then((data) => setAnnotationAlgorithms(data.algorithms || []))
    .catch((error) => setAnnotationMessage(error.message));
  fetch("/api/ml/model-versions?scope=all")
    .then((response) => response.ok ? response.json() : ({ versions: [] }))
    .then((data) => setAnnotationModels(data.versions || []));
  fetch("/api/ml/python-envs?scope=all")
    .then((response) => response.ok ? response.json() : ({ envs: [] }))
    .then((data) => setAnnotationEnvironments(data.envs || []));
  fetch("/api/ml/asset-links?scope=all")
    .then((response) => response.ok ? response.json() : ({ links: [] }))
    .then((data) => setAnnotationAssetLinks(data.links || []));
}, [annotationAlgorithms.length]);

useEffect(() => {
  if (annotationMode === "manual") { setAnnotationAlgorithmId(""); return; }
  const operation = annotationMode === "segmentation" ? "segment" : "propagate";
  const available = annotationAlgorithms.filter((algorithm) => supportsAnnotationOperation(algorithm, operation));
  if (!available.some((algorithm) => String(algorithm.id) === String(annotationAlgorithmId))) {
    setAnnotationAlgorithmId(available[0]?.id || "");
  }
}, [annotationMode, annotationAlgorithms, annotationAlgorithmId]);

const selectedAnnotationAlgorithm = annotationAlgorithms.find((algorithm) => String(algorithm.id) === String(annotationAlgorithmId));
const linkedAnnotationAssets = annotationAssetLinks.filter((link) => String(link.algorithm_asset_id || "") === String(annotationAlgorithmId || ""));
const compatibleAnnotationModels = annotationModels.filter((model) => {
  if (linkedAnnotationAssets.length) return linkedAnnotationAssets.some((link) => String(link.model_version_id || "") === String(model.id));
  const framework = String(model.model_framework || "").toLowerCase();
  const selectedFramework = String(selectedAnnotationAlgorithm?.framework || "").toLowerCase();
  if (["sam2", "samurai"].includes(selectedFramework)) return ["sam2", "samurai"].includes(framework);
  return !selectedFramework || framework === selectedFramework;
});
const compatibleAnnotationEnvironments = annotationEnvironments.filter((environment) => {
  if (linkedAnnotationAssets.length) return linkedAnnotationAssets.some((link) => String(link.python_env_id || "") === String(environment.id));
  if (!selectedAnnotationAlgorithm) return true;
  const name = String(environment.name || "").toLowerCase();
  return name.includes("samurai") || name.includes("sam2");
});

useEffect(() => {
  if (!compatibleAnnotationModels.some((model) => String(model.id) === String(annotationModelId))) {
    setAnnotationModelId(compatibleAnnotationModels[0]?.id || "");
  }
  if (!compatibleAnnotationEnvironments.some((environment) => String(environment.id) === String(annotationEnvironmentId))) {
    setAnnotationEnvironmentId(compatibleAnnotationEnvironments[0]?.id || "");
  }
}, [annotationAlgorithmId, annotationModels, annotationEnvironments, annotationAssetLinks]);

useEffect(() => {
  if (!annotationTask?.id || !annotationSession?.id || ["done", "failed", "cancelled"].includes(annotationTask.status)) return undefined;
  let stopped = false;
  const poll = async () => {
    try {
      const response = await fetch(`/api/compute/tasks?purpose=annotation&sessionKey=${annotationSession.id}`);
      const data = await response.json();
      setAnnotationTaskHistory(data.tasks || []);
      const current = (data.tasks || []).find((row) => row.id === annotationTask.id);
      if (!current || stopped) return;
      setAnnotationTask(current);
      setAnnotationMessage(current.message || current.status);
      if (current.status === "done") {
        const suggestionResponse = await fetch(`/api/annotation/sessions/${annotationSession.id}/suggestions`);
        const suggestionData = await suggestionResponse.json();
        if (!stopped) setAnnotationSuggestions(suggestionData.suggestions || []);
      }
    } catch (error) {
      if (!stopped) setAnnotationMessage(error.message);
    }
  };
  poll();
  const timer = window.setInterval(poll, 900);
  return () => { stopped = true; window.clearInterval(timer); };
}, [annotationTask?.id, annotationTask?.status, annotationSession?.id]);

useEffect(() => {
  if (!showTaskHistory) return;
  fetch("/api/compute/tasks?purpose=annotation")
    .then((response) => response.json())
    .then((data) => setAnnotationTaskHistory(data.tasks || []))
    .catch(() => setAnnotationTaskHistory([]));
}, [showTaskHistory, annotationTask?.status]);

useEffect(() => {
  if (!editMode || !annotationSuggestions.length || !item?.id) return;
  const current = annotationSuggestions.filter((row) => String(row.project_image_id) === String(item.id));
  setDraft((rows) => [
    ...rows.filter((row) => !row.algorithmSuggestion),
    ...current.map((row) => {
      const geometry = typeof row.geometry_json === "string" ? JSON.parse(row.geometry_json || "{}") : (row.geometry_json || {});
      const [x1, y1, x2, y2] = geometry.bbox || [0, 0, 1, 1];
      return { id: row.id, label: row.label, bbox_x: x1, bbox_y: y1, bbox_w: Math.max(1, x2 - x1), bbox_h: Math.max(1, y2 - y1), shape_type: row.shape_type, track_id: row.track_id, algorithmSuggestion: true };
    }),
  ]);
}, [annotationSuggestions, item?.id, editMode]);

useEffect(() => {
  if (editMode) return;
  setDraft(annotations.map((annotation) => ({ ...annotation })));
  setDefaultLabel(annotations[0]?.label || "");
}, [annotations, editMode, item?.id]);

useViewerNavigation({
  enabled: !editMode,
  length: viewerItems.length,
  setIndex,
  onEscape: () => editMode ? setSelectedAnnId(null) : (onPageChange?.(viewerPage), onClose()),
});

useEffect(() => {
  const onDelete = (event) => {
    if (!editMode || !selectedAnnId || !["Delete", "Backspace"].includes(event.key)) return;
    setDraft((rows) => rows.filter((ann) => ann.id !== selectedAnnId));
    setSelectedAnnId(null);
  };
  window.addEventListener("keydown", onDelete);
  return () => window.removeEventListener("keydown", onDelete);
}, [editMode, selectedAnnId]);

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

const shownAnnotations = editMode ? draft : annotations;
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

setViewerAnnotations(item.id, annotations);
setDraft(annotations.map((ann) => ({ ...ann })));

onSaved?.(item.id, annotations);

setEditMode(false);

setAnnotationMode("manual");

setAnnotationSession(null);

setAnnotationTask(null);

setAnnotationMessage("");

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

setViewerAnnotations(item.id, annotations);
setDraft(annotations.map((ann) => ({ ...ann })));

onSaved?.(item.id, annotations);

setEditMode(false);

})

.catch((error) => window.alert("保存失败: " + error.message));

};

const runAnnotationAlgorithm = async () => {
  if (annotationMode === "manual") return;
  if (!annotationAlgorithmId) { setAnnotationMessage("请先选择可用的标注方法"); return; }
  if (!selectedAnn) { setAnnotationMessage("请先选择或绘制一个目标区域作为提示"); return; }
  const projectId = item.project_id || sequenceUrl?.match(/^\/api\/projects\/([^/]+)\/images/)?.[1];
  if (!projectId) { setAnnotationMessage("无法确定当前数据集项目"); return; }
  setAnnotationMessage("正在创建标注计算任务...");
  try {
    let session = annotationSession;
    if (!session || session.mode !== annotationMode
      || String(session.adapter_id) !== String(annotationAlgorithmId)
      || String(session.model_asset_id || "") !== String(annotationModelId || "")
      || String(session.environment_asset_id || "") !== String(annotationEnvironmentId || "")) {
      const createResponse = await fetch("/api/annotation/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, mode: annotationMode, adapterId: annotationAlgorithmId, modelAssetId: annotationModelId || null, environmentAssetId: annotationEnvironmentId || null }),
      });
      const createData = await createResponse.json();
      if (!createResponse.ok) throw new Error(createData.error || "创建标注会话失败");
      session = createData.session;
      setAnnotationSession(session);
    }
    const prompt = {
      type: "box",
      bbox: [Number(selectedAnn.bbox_x), Number(selectedAnn.bbox_y), Number(selectedAnn.bbox_x) + Number(selectedAnn.bbox_w), Number(selectedAnn.bbox_y) + Number(selectedAnn.bbox_h)],
      label: selectedAnn.label || defaultLabel || "unknown",
      trackId: selectedAnn.track_id || `track-${String(selectedAnn.id).replace(/^tmp_/, "")}`,
    };
    const operation = annotationMode === "segmentation" ? "segment" : "propagate";
    const selectedSequence = viewerItems.slice(index);
    const input = annotationMode === "segmentation"
      ? { projectImageId: item.id, prompt }
      : { imageIds: selectedSequence.map((row) => row.id), startFrame: 0, frameOffset: index, prompts: [prompt] };
    const operationResponse = await fetch(`/api/annotation/sessions/${session.id}/operations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, input, parameters: {} }),
    });
    const operationData = await operationResponse.json();
    if (!operationResponse.ok) throw new Error(operationData.error || "提交标注任务失败");
    setAnnotationTask(operationData.task);
    setAnnotationMessage(operation === "segment" ? "分割任务已提交" : "跟踪任务已提交");
  } catch (error) {
    setAnnotationMessage(error.message);
  }
};

const controlAnnotationTask = async (action) => {
  if (!annotationTask?.id) return;
  const response = await fetch(`/api/compute/tasks/${annotationTask.id}/${action}`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) { setAnnotationMessage(data.error || "任务操作失败"); return; }
  setAnnotationTask(data.task);
  setAnnotationMessage(data.task.message);
};

const commitAlgorithmSuggestions = async () => {
  if (!annotationSession?.id || !annotationSuggestions.length) return;
  const response = await fetch(`/api/annotation/sessions/${annotationSession.id}/commit`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
  });
  const data = await response.json();
  if (!response.ok) { setAnnotationMessage(data.error || "确认算法标注失败"); return; }
  setAnnotationMessage(`已确认 ${data.accepted} 条标注，并生成新标签版本`);
  setAnnotationLastCommit(data.labelVersion || null);
  setAnnotationSuggestions([]);
  setAnnotationTask(null);
  onSaved?.();
};

const reviewAlgorithmSuggestions = async (status, suggestionIds = []) => {
  if (!annotationSession?.id) return;
  const response = await fetch(`/api/annotation/sessions/${annotationSession.id}/suggestions`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, suggestionIds }),
  });
  const data = await response.json();
  if (!response.ok) { setAnnotationMessage(data.error || "审核标注建议失败"); return; }
  if (status === "rejected") {
    const changed = new Set((data.suggestions || []).map((row) => row.id));
    setAnnotationSuggestions((rows) => rows.filter((row) => !changed.has(row.id)));
    setSelectedAnnId(null);
  }
  setAnnotationMessage(status === "rejected" ? `已拒绝 ${data.suggestions?.length || 0} 条建议` : `已恢复 ${data.suggestions?.length || 0} 条建议`);
};

const undoAnnotationCommit = async () => {
  if (!annotationSession?.id || !annotationLastCommit) return;
  const response = await fetch(`/api/annotation/sessions/${annotationSession.id}/undo-commit`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) { setAnnotationMessage(data.error || "撤销提交失败"); return; }
  setAnnotationLastCommit(null);
  setAnnotationMessage("已撤销最近一次智能标注提交");
  onSaved?.();
};

const loadAnnotationTaskLogs = async (taskId) => {
  const response = await fetch(`/api/compute/tasks/${taskId}/logs`);
  const data = await response.json();
  setAnnotationTaskLogs(response.ok ? (data.logs || []) : []);
};

const correctTrackingFromCurrentFrame = async () => {
  if (!annotationSession?.id || annotationMode !== "tracking" || !selectedAnn) return;
  const trackId = selectedAnn.track_id || `track-${String(selectedAnn.id)}`;
  const prompt = {
    type: "box", trackId, label: selectedAnn.label || "unknown",
    bbox: [Number(selectedAnn.bbox_x), Number(selectedAnn.bbox_y), Number(selectedAnn.bbox_x) + Number(selectedAnn.bbox_w), Number(selectedAnn.bbox_y) + Number(selectedAnn.bbox_h)],
  };
  setAnnotationMessage("正在从当前帧建立修正关键帧...");
  try {
    const correctionResponse = await fetch(`/api/annotation/sessions/${annotationSession.id}/corrections`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId, frameIndex: index, prompt }),
    });
    const correctionData = await correctionResponse.json();
    if (!correctionResponse.ok) throw new Error(correctionData.error || "创建修正关键帧失败");
    const operationResponse = await fetch(`/api/annotation/sessions/${annotationSession.id}/operations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "correct", input: { imageIds: viewerItems.slice(index).map((row) => row.id), startFrame: 0, frameOffset: index, prompts: [prompt] }, parameters: { revision: correctionData.revision.revision } }),
    });
    const operationData = await operationResponse.json();
    if (!operationResponse.ok) throw new Error(operationData.error || "提交重新跟踪任务失败");
    setAnnotationSuggestions((rows) => rows.filter((row) => !(row.track_id === trackId && Number(row.frame_index) >= index)));
    setAnnotationTask(operationData.task);
    setAnnotationMessage("修正关键帧已建立，正在重新跟踪");
  } catch (error) {
    setAnnotationMessage(error.message);
  }
};

return (

<div className={`viewer-overlay dataset-image-dialog viewer-${viewerTheme} ${editMode ? "viewer-editing" : ""}`} onMouseUp={() => { setDrag(null); setEditDrag(null); }} onMouseLeave={() => { setDrag(null); setEditDrag(null); }}>

<div className={`viewer-topbar ${editMode ? "annotation-editor-topbar" : ""}`}>

<div className="viewer-context-row">

{!readOnly && <button className={editMode ? "active-tool edit-toggle" : "edit-toggle"} onClick={() => setEditMode((value) => !value)}>{editMode ? "退出编" : "编辑"}</button>}

<div className="viewer-file-identity">

<b>{item.display_name}</b>

<code title={item.absolute_path || item.source_path || ""}>{item.absolute_path || item.source_path || "未记录绝对路"}</code>

</div>

<span>{sequenceUrl ? `${index + 1} / ${viewerItems.length}` : (loadPage ? `${(viewerPage - 1) * pageSize + index + 1} / ${totalItems}` : `${index + 1} / ${viewerItems.length}`)}</span>

<div className="viewer-utility-actions">
<button onClick={() => zoom(-0.25)}>-</button>
<button onClick={() => zoom(0.25)}>+</button>
<button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>重置</button>
<button onClick={() => setViewerTheme((value) => value === "dark" ? "light" : "dark")} title="切换明暗模式"><Sun size={16} /></button>
<button onClick={() => { onPageChange?.(viewerPage); onClose(); }}><X size={16} /></button>
</div>

</div>

{editMode && (

<div className="annotation-action-row">

<div className="annotation-mode-control" role="tablist" aria-label="标注模式">
<button className={annotationMode === "manual" ? "active-tool" : ""} onClick={() => setAnnotationMode("manual")}><MousePointer2 size={15} />手动标注</button>
<button className={annotationMode === "segmentation" ? "active-tool" : ""} onClick={() => setAnnotationMode("segmentation")}><ScanLine size={15} />分割标注</button>
<button className={annotationMode === "tracking" ? "active-tool" : ""} onClick={() => setAnnotationMode("tracking")}><Route size={15} />跟踪标注</button>
</div>

<button className={tool === "select" ? "active-tool" : ""} onClick={() => setTool("select")}>选择</button>

<button className={tool === "draw" ? "active-tool" : ""} onClick={() => setTool("draw")}>画框</button>

<input className="label-input" value={defaultLabel} onChange={(event) => setDefaultLabel(event.target.value)} placeholder="标签" />

{annotationMode !== "manual" && <select className="annotation-method-select" value={annotationAlgorithmId} onChange={(event) => setAnnotationAlgorithmId(event.target.value)}>
{!annotationAlgorithms.length && <option value="">正在加载方法...</option>}
{annotationAlgorithms.filter((algorithm) => supportsAnnotationOperation(algorithm, annotationMode === "segmentation" ? "segment" : "propagate")).map((algorithm) => <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>)}
</select>}

{annotationMode !== "manual" && <select className="annotation-method-select annotation-model-select" value={annotationModelId} onChange={(event) => setAnnotationModelId(event.target.value)} aria-label="模型权重">
<option value="">选择模型权重</option>
{compatibleAnnotationModels.map((model) => <option key={model.id} value={model.id}>{model.model_name || model.version_name}</option>)}
</select>}

{annotationMode !== "manual" && <select className="annotation-method-select annotation-env-select" value={annotationEnvironmentId} onChange={(event) => setAnnotationEnvironmentId(event.target.value)} aria-label="Python环境">
<option value="">选择运行环境</option>
{compatibleAnnotationEnvironments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
</select>}

{annotationMode !== "manual" && <button className="run-annotation-method" disabled={!selectedAnn || !annotationAlgorithmId || !annotationModelId || !annotationEnvironmentId} onClick={runAnnotationAlgorithm}>{annotationMode === "segmentation" ? "生成分割" : "开始跟踪"}</button>}

<button disabled={!selectedAnnId} onClick={() => { setDraft((rows) => rows.filter((ann) => ann.id !== selectedAnnId)); setSelectedAnnId(null); }}>删除</button>

<button className="save-ann" onClick={save}>保存</button>
<button title="计算任务记录" onClick={() => setShowTaskHistory((value) => !value)}><History size={15} /></button>

</div>

)}

</div>

{editMode && annotationMessage && <div className="annotation-task-status" title={annotationTask?.id || ""}>{annotationMessage}{annotationTask ? ` · ${annotationTask.status}` : ""}</div>}

{editMode && annotationTask && <div className="annotation-task-actions">
{["pending", "running"].includes(annotationTask.status) && <button onClick={() => controlAnnotationTask("pause")}>暂停</button>}
{annotationTask.status === "paused" && <button onClick={() => controlAnnotationTask("resume")}>继续</button>}
{!["done", "failed", "cancelled"].includes(annotationTask.status) && <button onClick={() => controlAnnotationTask("cancel")}>取消</button>}
{annotationSuggestions.length > 0 && <button className="primary" onClick={commitAlgorithmSuggestions}>确认结果</button>}
{annotationSuggestions.length > 0 && <button onClick={() => reviewAlgorithmSuggestions("rejected")}><XCircle size={14} />全部拒绝</button>}
{selectedAnn?.algorithmSuggestion && <button onClick={() => reviewAlgorithmSuggestions("rejected", [selectedAnn.id])}><XCircle size={14} />拒绝当前</button>}
{annotationLastCommit && <button onClick={undoAnnotationCommit}><Undo2 size={14} />撤销提交</button>}
{annotationMode === "tracking" && annotationSession && selectedAnn && <button onClick={correctTrackingFromCurrentFrame}>从此帧修正</button>}
</div>}

{editMode && showTaskHistory && <aside className="annotation-task-history">
<header><div><History size={15} /><b>计算任务</b></div><button title="关闭任务记录" onClick={() => setShowTaskHistory(false)}><X size={14} /></button></header>
<div className="annotation-task-history-list">
{annotationTaskHistory.length ? annotationTaskHistory.map((task) => <button key={task.id} className={annotationTaskLogs.length && annotationTaskLogs[0]?.task_id === task.id ? "active" : ""} onClick={() => loadAnnotationTaskLogs(task.id)}>
<span><i className={`task-state ${task.status}`} />{task.operation}</span><em>{task.progress}% · {task.status}</em><small>{task.message}</small>
</button>) : <p>暂无计算任务</p>}
</div>
<div className="annotation-task-log"><b><ScrollText size={14} />任务日志</b>{annotationTaskLogs.length ? annotationTaskLogs.slice(-80).map((row) => <code key={row.id}>{row.line}</code>) : <p>选择任务查看日志</p>}</div>
</aside>}

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

<AuthenticatedImage fetchPriority="high" src={`/api/project-images/${item.id}/preview?size=1920`} placeholderSrc={`/api/project-images/${item.id}/thumb`} draggable="false" onSourceReady={() => setLoadedItemId(item.id)} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })} />

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

strokeDasharray={ann.algorithmSuggestion ? `${Math.max(10, width / 120)} ${Math.max(7, width / 170)}` : undefined}

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
