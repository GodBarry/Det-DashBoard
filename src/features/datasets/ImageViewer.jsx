import { useEffect, useRef, useState } from "react";
import { ChevronRight, Film, History, MousePointer2, Route, ScanLine, ScrollText, Sun, Undo2, X, XCircle } from "lucide-react";

import { categoryColor } from "../../shared/presentation.js";
import { modalityLabel, sceneLabel, viewLabel } from "../../shared/datasetMetadata.js";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { prefetchViewerWindow, setViewerAnnotations, useViewerAnnotations } from "../media/viewerMediaRepository.js";
const VIEWER_DRAFT_PREFIX = "det-dashboard:viewer-draft:";
const TRACKING_STATE_PREFIX = "det-dashboard:tracking-state:";

function readStoredJson(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch { return null; }
}

function writeStoredJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function labelColor(label = "") {
return categoryColor(label);
}

function annotationIou(a, b) {
  const ax2 = Number(a.bbox_x) + Number(a.bbox_w);
  const ay2 = Number(a.bbox_y) + Number(a.bbox_h);
  const bx2 = Number(b.bbox_x) + Number(b.bbox_w);
  const by2 = Number(b.bbox_y) + Number(b.bbox_h);
  const intersection = Math.max(0, Math.min(ax2, bx2) - Math.max(Number(a.bbox_x), Number(b.bbox_x)))
    * Math.max(0, Math.min(ay2, by2) - Math.max(Number(a.bbox_y), Number(b.bbox_y)));
  const union = Number(a.bbox_w) * Number(a.bbox_h) + Number(b.bbox_w) * Number(b.bbox_h) - intersection;
  return union > 0 ? intersection / union : 0;
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
const viewerProjectId = item?.project_id || sequenceUrl?.match(/^\/api\/projects\/([^/]+)\/images/)?.[1] || "";
const viewerTotal = sequenceUrl ? viewerItems.length : Number(totalItems || viewerItems.length || 0);
const [ordinalText, setOrdinalText] = useState(String((sequenceUrl ? sequenceIndex : (viewerPage - 1) * pageSize + externalIndex) + 1));

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
const [annotationMode, setAnnotationMode] = useState("");
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
const [replaceOverlaps, setReplaceOverlaps] = useState(false);
const [overlapIou, setOverlapIou] = useState(0.5);
const [showSupplementDialog, setShowSupplementDialog] = useState(false);
const [supplementCount, setSupplementCount] = useState(3);
const [operationStatus, setOperationStatus] = useState("浏览图片");
const [draftDirty, setDraftDirty] = useState(false);
const draftRevisionRef = useRef(0);
const lastWheelScaleRef = useRef(1.5);
const lastTrackingAnchorRef = useRef(null);
const pendingNavigationStatusRef = useRef("");
const navigationBusyRef = useRef(false);
const restoredTrackingProjectRef = useRef("");

const [tool, setTool] = useState("select");

const [draft, setDraft] = useState([]);
const draftRef = useRef(draft);
draftRef.current = draft;
const undoStackRef = useRef([]);
const undoActionRef = useRef({ key: "", time: 0 });
const saveQueueRef = useRef(Promise.resolve(true));
const lastSavedRevisionRef = useRef(0);

const [selectedAnnId, setSelectedAnnId] = useState(null);
const [selectedAnnIds, setSelectedAnnIds] = useState([]);

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
  const ordinal = sequenceUrl ? index + 1 : (viewerPage - 1) * pageSize + index + 1;
  setOrdinalText(String(ordinal));
}, [index, viewerPage, pageSize, sequenceUrl]);

useEffect(() => {
  if (!loadPage) setViewerItems(items);
}, [items, loadPage]);

useEffect(() => {

const recoveredDraft = readStoredJson(`${VIEWER_DRAFT_PREFIX}${item?.id || ""}`);
const recoveredRows = Array.isArray(recoveredDraft?.annotations) ? recoveredDraft.annotations : null;
setDraft((recoveredRows || annotations).map((annotation) => ({ ...annotation })));
setDraftDirty(Boolean(recoveredRows));
draftRevisionRef.current = recoveredRows ? Number(recoveredDraft.revision || 1) : 0;
lastSavedRevisionRef.current = recoveredRows ? Math.max(0, draftRevisionRef.current - 1) : 0;
undoStackRef.current = [];
undoActionRef.current = { key: "", time: 0 };

setSelectedAnnId(null);
setSelectedAnnIds([]);

setNaturalSize({ width: Number(item?.image_width || 1), height: Number(item?.image_height || 1) });
setLoadedItemId(null);
setOperationStatus(pendingNavigationStatusRef.current || (recoveredRows ? `已恢复图片 ${item?.display_name} 的未保存标签草稿` : editMode ? "选择或调整已有标签；按 B 开始画框" : "浏览图片；A / D 或方向键切换"));
pendingNavigationStatusRef.current = "";

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
  if (!annotationMode || annotationMode === "manual") { setAnnotationAlgorithmId(""); return; }
  const operation = annotationMode === "segmentation" ? "segment" : "propagate";
  const available = annotationAlgorithms.filter((algorithm) => supportsAnnotationOperation(algorithm, operation));
  if (!available.some((algorithm) => String(algorithm.id) === String(annotationAlgorithmId))) {
    setAnnotationAlgorithmId(available[0]?.id || "");
  }
}, [annotationMode, annotationAlgorithms, annotationAlgorithmId]);

const selectedAnnotationAlgorithm = annotationAlgorithms.find((algorithm) => String(algorithm.id) === String(annotationAlgorithmId));
const linkedAnnotationAssets = annotationAssetLinks.filter((link) => String(link.algorithm_asset_id || "") === String(annotationAlgorithmId || ""));
const compatibleAnnotationModels = annotationModels.filter((model) => {
  if (linkedAnnotationAssets.length) return linkedAnnotationAssets.some((link) => String(link.model_version_id || "") === String(model.id) || String(link.model_id || "") === String(model.model_id || ""));
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
  if (!viewerProjectId || !annotationAlgorithms.length || restoredTrackingProjectRef.current === viewerProjectId) return;
  restoredTrackingProjectRef.current = viewerProjectId;
  const stored = readStoredJson(`${TRACKING_STATE_PREFIX}${viewerProjectId}`);
  if (!stored?.session?.id || stored.taskStatus === "done") return;
  setAnnotationMode("tracking");
  setTool("select");
  setAnnotationAlgorithmId(stored.algorithmId || "");
  setAnnotationModelId(stored.modelId || "");
  setAnnotationEnvironmentId(stored.environmentId || "");
  setAnnotationSession(stored.session);
  lastTrackingAnchorRef.current = stored.anchor || null;
  setOperationStatus("已恢复上次跟踪会话，正在关联后台任务");
  fetch(`/api/compute/tasks?purpose=annotation&sessionKey=${stored.session.id}`)
    .then((response) => response.json())
    .then((data) => {
      const tasks = data.tasks || [];
      const task = tasks.find((row) => row.id === stored.taskId) || tasks[0] || null;
      setAnnotationTaskHistory(tasks);
      setAnnotationTask(task);
      setOperationStatus(task
        ? `已恢复跟踪任务：${task.status}；${["paused", "failed", "cancelled"].includes(task.status) ? "按空格继续" : "按空格暂停"}`
        : "已恢复跟踪配置，请选择框后按空格开始");
    })
    .catch(() => setOperationStatus("已恢复跟踪配置，但后台任务状态读取失败"));
}, [viewerProjectId, annotationAlgorithms.length]);

useEffect(() => {
  if (!viewerProjectId || annotationMode !== "tracking" || !annotationSession?.id) return;
  if (annotationTask?.status === "done") {
    window.localStorage.removeItem(`${TRACKING_STATE_PREFIX}${viewerProjectId}`);
    return;
  }
  writeStoredJson(`${TRACKING_STATE_PREFIX}${viewerProjectId}`, {
    session: annotationSession,
    taskId: annotationTask?.id || null,
    taskStatus: annotationTask?.status || null,
    algorithmId: annotationAlgorithmId,
    modelId: annotationModelId,
    environmentId: annotationEnvironmentId,
    anchor: lastTrackingAnchorRef.current,
    imageId: item?.id,
    imageIndex: index,
    updatedAt: new Date().toISOString(),
  });
}, [viewerProjectId, annotationMode, annotationSession?.id, annotationTask?.id, annotationTask?.status, annotationAlgorithmId, annotationModelId, annotationEnvironmentId, item?.id, index]);

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
        if (!stopped) setOperationStatus(`计算完成，生成 ${suggestionData.suggestions?.length || 0} 个标注结果`);
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
  const generated = current.map((row) => {
      const geometry = typeof row.geometry_json === "string" ? JSON.parse(row.geometry_json || "{}") : (row.geometry_json || {});
      const [x1, y1, x2, y2] = geometry.bbox || [0, 0, 1, 1];
      return { id: row.id, label: row.label, bbox_x: x1, bbox_y: y1, bbox_w: Math.max(1, x2 - x1), bbox_h: Math.max(1, y2 - y1), shape_type: row.shape_type, track_id: row.track_id, algorithmSuggestion: true };
    });
  setDraft((rows) => {
    const retained = rows.filter((row) => !row.algorithmSuggestion && !row.promptOnly && (!replaceOverlaps || !generated.some((next) => annotationIou(row, next) >= overlapIou)));
    return [...retained, ...rows.filter((row) => row.promptOnly), ...generated];
  });
}, [annotationSuggestions, item?.id, editMode, replaceOverlaps, overlapIou]);

useEffect(() => {
  if (editMode && draftDirty) return;
  setDraft(annotations.map((annotation) => ({ ...annotation })));
  if (!defaultLabel) setDefaultLabel(annotations[0]?.label || "");
}, [annotations, editMode, draftDirty, item?.id]);

useEffect(() => {
  const onDelete = (event) => {
    if (!editMode || !selectedAnnId || !["Delete", "Backspace"].includes(event.key)) return;
    const ids = selectedAnnIds.length ? selectedAnnIds : [selectedAnnId];
    pushUndoSnapshot(`delete:${ids.join(",")}`);
    markDraftDirty();
    setDraft((rows) => rows.filter((ann) => !ids.includes(ann.id)));
    setSelectedAnnId(null);
    setSelectedAnnIds([]);
    setOperationStatus(`已删除 ${ids.length} 个标签，正在保存`);
  };
  window.addEventListener("keydown", onDelete);
  return () => window.removeEventListener("keydown", onDelete);
}, [editMode, selectedAnnId, selectedAnnIds]);

const zoom = (delta) => setScale((value) => {
  const nextScale = Math.min(6, Math.max(0.25, Number((value + delta).toFixed(2))));
  if (nextScale !== 1) lastWheelScaleRef.current = nextScale;
  setOperationStatus(`缩放比例 ${Math.round(nextScale * 100)}%`);
  return nextScale;
});

const fitImage = () => {
  setScale(1);
  setPan({ x: 0, y: 0 });
  setOperationStatus("已恢复适应窗口显示");
};

const toggleZoomMode = () => {
  if (Math.abs(scale - 1) > 0.01) fitImage();
  else {
    const nextScale = Math.max(1.1, lastWheelScaleRef.current || 1.5);
    setScale(nextScale);
    setOperationStatus(`已恢复滚轮缩放比例 ${Math.round(nextScale * 100)}%`);
  }
};

const persistBeforeNavigation = async () => {
  if (!editMode) return true;
  if (!await saveQueueRef.current.catch(() => false)) return false;
  if (draftRevisionRef.current <= lastSavedRevisionRef.current) return true;
  const count = draft.filter((ann) => !ann.promptOnly).length;
  const name = item.display_name;
  const saved = await save({ exit: false, announce: false });
  if (saved) pendingNavigationStatusRef.current = `已保存标签 ${count} 个到图片 ${name}`;
  return saved;
};

const movePage = async (delta) => {
  if (sequenceUrl) return;
  const targetPage = viewerPage + delta;
  const totalPages = Math.max(1, Math.ceil(Number(totalItems || 0) / Math.max(1, Number(pageSize) || 48)));
  if (!loadPage || targetPage < 1 || targetPage > totalPages || loadingPage) return;
  if (!await persistBeforeNavigation()) return;
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
const navigateBy = async (delta) => {
  if (navigationBusyRef.current) return;
  navigationBusyRef.current = true;
  try {
  if (delta < 0 && index <= 0) return movePage(-1);
  if (delta > 0 && index >= viewerItems.length - 1) return movePage(1);
  if (!await persistBeforeNavigation()) return;
  setIndex((value) => Math.max(0, Math.min(viewerItems.length - 1, value + delta)));
  } finally {
    navigationBusyRef.current = false;
  }
};
const prev = () => navigateBy(-1);
const next = () => navigateBy(1);

const jumpToOrdinal = async () => {
  const targetOrdinal = Math.max(1, Math.min(viewerTotal, Math.trunc(Number(ordinalText) || 1)));
  setOrdinalText(String(targetOrdinal));
  const targetIndex = targetOrdinal - 1;
  if (navigationBusyRef.current) return;
  navigationBusyRef.current = true;
  try {
    if (!await persistBeforeNavigation()) return;
    if (sequenceUrl || !loadPage) {
      setIndex(Math.max(0, Math.min(viewerItems.length - 1, targetIndex)));
      return;
    }
    const targetPage = Math.floor(targetIndex / pageSize) + 1;
    const pageIndex = targetIndex % pageSize;
    if (targetPage === viewerPage) {
      setIndex(Math.min(viewerItems.length - 1, pageIndex));
      return;
    }
    setLoadingPage(true);
    const nextItems = await loadPage(targetPage);
    if (nextItems?.length) {
      setViewerPage(targetPage);
      setViewerItems(nextItems);
      setIndex(Math.min(nextItems.length - 1, pageIndex));
    }
  } finally {
    setLoadingPage(false);
    navigationBusyRef.current = false;
  }
};

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
const selectedAnnRows = draft.filter((ann) => (selectedAnnIds.length ? selectedAnnIds : [selectedAnnId]).includes(ann.id));
const [bulkLabel, setBulkLabel] = useState("");

useEffect(() => {
  setBulkLabel(selectedAnnRows[0]?.label || "");
}, [selectedAnnIds.join("|"), selectedAnnId]);

useEffect(() => {
  if (annotationMode !== "tracking" || scale <= 1.01) return undefined;
  const tracked = selectedAnn || [...draft].reverse().find((ann) => ann.algorithmSuggestion && ann.track_id);
  if (!tracked) return undefined;
  const frame = window.requestAnimationFrame(() => {
    const stage = document.querySelector(".dataset-image-dialog .viewer-stage")?.getBoundingClientRect();
    const imageRect = document.querySelector(".dataset-image-dialog .viewer-image-wrap")?.getBoundingClientRect();
    if (!stage || !imageRect) return;
    const box = {
      left: imageRect.left + (Number(tracked.bbox_x) / width) * imageRect.width,
      top: imageRect.top + (Number(tracked.bbox_y) / height) * imageRect.height,
      right: imageRect.left + ((Number(tracked.bbox_x) + Number(tracked.bbox_w)) / width) * imageRect.width,
      bottom: imageRect.top + ((Number(tracked.bbox_y) + Number(tracked.bbox_h)) / height) * imageRect.height,
    };
    if (box.left < stage.left || box.top < stage.top || box.right > stage.right || box.bottom > stage.bottom) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      setOperationStatus("跟踪框超出可视区域，已自动恢复适应窗口");
    }
  });
  return () => window.cancelAnimationFrame(frame);
}, [index, annotationSuggestions.length]);

const pointFromEvent = (event) => {

const svg = event.currentTarget.closest(".viewer-image-wrap")?.querySelector("svg");

if (!svg) return { x: 0, y: 0 };

const rect = svg.getBoundingClientRect();

return {

x: Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width)),

y: Math.max(0, Math.min(height, ((event.clientY - rect.top) / rect.height) * height)),

};

};

const markDraftDirty = () => {
  draftRevisionRef.current += 1;
  setDraftDirty(true);
};

const pushUndoSnapshot = (actionKey = "edit") => {
  const now = Date.now();
  const previous = undoActionRef.current;
  if (previous.key === actionKey && now - previous.time < 700) {
    undoActionRef.current = { key: actionKey, time: now };
    return;
  }
  undoStackRef.current = [...undoStackRef.current.slice(-49), draftRef.current.map((ann) => ({ ...ann }))];
  undoActionRef.current = { key: actionKey, time: now };
};

const undoDraft = () => {
  const previous = undoStackRef.current.at(-1);
  if (!previous) {
    setOperationStatus("当前图片没有可撤销的操作");
    return;
  }
  undoStackRef.current = undoStackRef.current.slice(0, -1);
  undoActionRef.current = { key: "", time: 0 };
  draftRevisionRef.current += 1;
  setDraft(previous.map((ann) => ({ ...ann })));
  setDraftDirty(true);
  setSelectedAnnId(null);
  setSelectedAnnIds([]);
  setOperationStatus("已撤销当前图片的上一步操作，正在保存");
};

const updateAnn = (id, patch) => {
  const currentRows = draftRef.current;
  const current = currentRows.find((ann) => ann.id === id);
  const relabelGenerated = current?.promptOnly && patch.label !== undefined && currentRows.some((ann) => ann.algorithmSuggestion);
  if (!current?.promptOnly || relabelGenerated) markDraftDirty();
  setDraft((rows) => rows.map((ann) => {
    if (ann.id === id) return { ...ann, ...patch, ...(ann.algorithmSuggestion ? { algorithmSuggestion: false } : {}) };
    if (relabelGenerated && ann.algorithmSuggestion) return { ...ann, label: patch.label, algorithmSuggestion: false };
    return ann;
  }));
};

const updateSelectedLabels = (label) => {
  const ids = selectedAnnIds.length ? selectedAnnIds : (selectedAnnId ? [selectedAnnId] : []);
  if (!ids.length) return;
  const persistent = draft.some((ann) => ids.includes(ann.id) && !ann.promptOnly);
  if (persistent) {
    pushUndoSnapshot(`labels:${ids.join(",")}`);
    markDraftDirty();
  }
  setDraft((rows) => rows.map((ann) => ids.includes(ann.id)
    ? { ...ann, label, ...(ann.algorithmSuggestion ? { algorithmSuggestion: false } : {}) }
    : ann));
  setDefaultLabel(label);
};

const updateSelectedGeometry = (patch) => {
  if (!selectedAnnId) return;
  pushUndoSnapshot(`geometry:${selectedAnnId}`);
  updateAnn(selectedAnnId, patch);
};

const selectExistingAnnotation = (annotation) => {
  if (!annotationMode) {
    setAnnotationMode("manual");
    setTool("select");
    setOperationStatus(`已进入手动标注模式并选择标签 ${annotation.label || "unknown"}`);
  }
};

const normalizeBox = (box) => {

const x1 = Math.max(0, Math.min(width, Math.min(box.x1, box.x2)));

const y1 = Math.max(0, Math.min(height, Math.min(box.y1, box.y2)));

const x2 = Math.max(0, Math.min(width, Math.max(box.x1, box.x2)));

const y2 = Math.max(0, Math.min(height, Math.max(box.y1, box.y2)));

return { bbox_x: x1, bbox_y: y1, bbox_w: Math.max(1, x2 - x1), bbox_h: Math.max(1, y2 - y1) };

};

const performSave = async ({ exit = false, announce = true } = {}) => {

const currentDraft = draftRef.current;
const savedRows = currentDraft.filter((ann) => !ann.promptOnly && !ann.algorithmSuggestion);
const transientRows = currentDraft.filter((ann) => ann.promptOnly || ann.algorithmSuggestion);
const savedRevision = draftRevisionRef.current;
const selectedBeforeSave = currentDraft.filter((ann) => (selectedAnnIds.length ? selectedAnnIds : [selectedAnnId]).includes(ann.id));
const restoreSelection = (annotations) => {
  const used = new Set();
  const matchedIds = selectedBeforeSave.map((source) => {
    const match = annotations.find((target) => !used.has(target.id)
      && target.label === source.label
      && Number(target.bbox_x) === Number(source.bbox_x)
      && Number(target.bbox_y) === Number(source.bbox_y)
      && Number(target.bbox_w) === Number(source.bbox_w)
      && Number(target.bbox_h) === Number(source.bbox_h));
    if (match) used.add(match.id);
    return match?.id;
  }).filter(Boolean);
  setSelectedAnnIds(matchedIds);
  setSelectedAnnId(matchedIds.at(-1) || null);
};

if (saveAnnotations) {

try {

const data = await saveAnnotations(savedRows);

const annotations = data?.annotations || draft;

setViewerAnnotations(item.id, annotations);
if (draftRevisionRef.current === savedRevision) {
  setDraft([...annotations.map((ann) => ({ ...ann })), ...transientRows]);
  restoreSelection(annotations);
}

onSaved?.(item.id, annotations);

if (exit) setEditMode(false);
if (draftRevisionRef.current === savedRevision) {
  setDraftDirty(false);
  if (!transientRows.length) window.localStorage.removeItem(`${VIEWER_DRAFT_PREFIX}${item.id}`);
}
lastSavedRevisionRef.current = Math.max(lastSavedRevisionRef.current, savedRevision);
if (announce) setOperationStatus(`已保存标签 ${annotations.length} 个到图片 ${item.display_name}`);
return true;

} catch (error) {

window.alert("提交失败: " + error.message);
return false;

}

}

return fetch(`/api/project-images/${item.id}/annotations/save`, {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ annotations: savedRows }),

})

.then((r) => r.json())

.then((data) => {

const annotations = data.annotations || [];

setViewerAnnotations(item.id, annotations);
if (draftRevisionRef.current === savedRevision) {
  setDraft([...annotations.map((ann) => ({ ...ann })), ...transientRows]);
  restoreSelection(annotations);
}

onSaved?.(item.id, annotations);

if (exit) setEditMode(false);
if (draftRevisionRef.current === savedRevision) {
  setDraftDirty(false);
  if (!transientRows.length) window.localStorage.removeItem(`${VIEWER_DRAFT_PREFIX}${item.id}`);
}
lastSavedRevisionRef.current = Math.max(lastSavedRevisionRef.current, savedRevision);
if (announce) setOperationStatus(`已保存标签 ${annotations.length} 个到图片 ${item.display_name}`);
return true;

})

.catch((error) => { window.alert("保存失败: " + error.message); return false; });

};

const save = (options = {}) => {
  const queued = saveQueueRef.current.catch(() => true).then(() => performSave(options));
  saveQueueRef.current = queued;
  return queued;
};

useEffect(() => {
  if (!editMode || !draftDirty || editDrag) return undefined;
  const timer = window.setTimeout(() => save({ exit: false }), 260);
  return () => window.clearTimeout(timer);
}, [editMode, draftDirty, editDrag, draft]);

useEffect(() => {
  if (!editMode || (!draftDirty && !draft.some((ann) => ann.promptOnly)) || !item?.id) return;
  const annotations = draft;
  writeStoredJson(`${VIEWER_DRAFT_PREFIX}${item.id}`, {
    imageId: item.id,
    imageName: item.display_name,
    revision: draftRevisionRef.current,
    updatedAt: new Date().toISOString(),
    annotations,
  });
}, [editMode, draftDirty, draft, item?.id]);

const runAnnotationAlgorithm = async ({ supplementFrames = 0, promptAnnotation = null, startIndex = index } = {}) => {
  if (annotationMode === "manual") return;
  if (!annotationAlgorithmId) { setAnnotationMessage("请先选择可用的标注方法"); return; }
  const activePrompt = promptAnnotation || selectedAnn;
  if (!activePrompt) { setAnnotationMessage("请先绘制一个目标区域作为提示"); return; }
  const startItem = viewerItems[startIndex] || item;
  const projectId = startItem.project_id || sequenceUrl?.match(/^\/api\/projects\/([^/]+)\/images/)?.[1];
  if (!projectId) { setAnnotationMessage("无法确定当前数据集项目"); return; }
  setAnnotationMessage("正在创建标注计算任务...");
  setOperationStatus(annotationMode === "segmentation" ? "正在根据提示框生成分割结果" : "正在启动目标跟踪");
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
      bbox: [Number(activePrompt.bbox_x), Number(activePrompt.bbox_y), Number(activePrompt.bbox_x) + Number(activePrompt.bbox_w), Number(activePrompt.bbox_y) + Number(activePrompt.bbox_h)],
      label: activePrompt.label || defaultLabel || "unknown",
      trackId: activePrompt.track_id || `track-${String(activePrompt.id).replace(/^tmp_/, "")}`,
    };
    const operation = annotationMode === "segmentation" ? "segment" : "propagate";
    const selectedSequence = viewerItems.slice(startIndex);
    const input = annotationMode === "segmentation"
      ? { projectImageId: startItem.id, prompt }
      : {
        imageIds: selectedSequence.map((row) => row.id),
        startFrame: 0,
        frameOffset: startIndex,
        prompts: [prompt],
        ...(supplementFrames > 0 ? { supplementCount: supplementFrames } : {}),
      };
    const operationResponse = await fetch(`/api/annotation/sessions/${session.id}/operations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, input, parameters: {} }),
    });
    const operationData = await operationResponse.json();
    if (!operationResponse.ok) throw new Error(operationData.error || "提交标注任务失败");
    setAnnotationTask(operationData.task);
    setAnnotationMessage(operation === "segment" ? "分割任务已提交" : "跟踪任务已提交");
    setOperationStatus(operation === "segment" ? "分割任务运行中，结果返回后将自动保存" : "目标跟踪运行中；按空格暂停");
    if (operation === "propagate") lastTrackingAnchorRef.current = {
      imageId: startItem.id,
      imageName: startItem.display_name,
      annotationId: activePrompt.id,
      index: startIndex,
      annotation: { ...activePrompt, promptOnly: true },
    };
  } catch (error) {
    setAnnotationMessage(error.message);
    setOperationStatus(`操作失败：${error.message}`);
  }
};

const controlAnnotationTask = async (action) => {
  if (!annotationTask?.id) return;
  const response = await fetch(`/api/compute/tasks/${annotationTask.id}/${action}`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) { setAnnotationMessage(data.error || "任务操作失败"); return; }
  setAnnotationTask(data.task);
  setAnnotationMessage(data.task.message);
  setOperationStatus(action === "pause" ? "跟踪已暂停；空格继续，或选择其他框后空格重新跟踪" : action === "resume" ? "跟踪已继续；按空格暂停" : data.task.message);
};

const commitAlgorithmSuggestions = async () => {
  if (!annotationSession?.id || !annotationSuggestions.length) return;
  const response = await fetch(`/api/annotation/sessions/${annotationSession.id}/commit`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ replaceOverlaps, overlapIou }),
  });
  const data = await response.json();
  if (!response.ok) { setAnnotationMessage(data.error || "确认算法标注失败"); return; }
  setAnnotationMessage(`已确认 ${data.accepted} 条标注，并生成新标签版本`);
  setOperationStatus(`已自动保存分割或跟踪结果 ${data.accepted} 个`);
  setAnnotationLastCommit(data.labelVersion || null);
  setAnnotationSuggestions([]);
  setAnnotationTask(null);
  onSaved?.();
};

useEffect(() => {
  if (!editMode || annotationMode !== "segmentation" || !annotationSuggestions.length) return undefined;
  const onConfirmSuggestion = (event) => {
    if (event.key !== "Enter" || event.isComposing || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    commitAlgorithmSuggestions();
  };
  window.addEventListener("keydown", onConfirmSuggestion);
  return () => window.removeEventListener("keydown", onConfirmSuggestion);
}, [editMode, annotationMode, annotationSuggestions.length, annotationSession?.id, replaceOverlaps, overlapIou]);

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

const selectAnnotationMode = (mode) => {
  const leaving = annotationMode === mode;
  setAnnotationMode(leaving ? "" : mode);
  setTool("select");
  setEditDrag(null);
  setOperationStatus(leaving
    ? "已退出当前标注模式，可继续选择和调整标签"
    : `已进入${mode === "manual" ? "手动" : mode === "segmentation" ? "分割" : "跟踪"}标注模式；按 B 开始${mode === "manual" ? "画框" : "绘制提示框"}`);
};

const toggleDrawTool = () => {
  if (!annotationMode) return;
  if (tool === "draw") {
    if (editDrag?.type === "draw") {
      setDraft((rows) => rows.filter((row) => row.id !== editDrag.id));
      setSelectedAnnId(null);
      setSelectedAnnIds([]);
      setEditDrag(null);
    }
    setTool("select");
    setOperationStatus(annotationMode === "manual" ? "已取消画框" : "已取消提示框");
    return;
  }
  setTool("draw");
  setOperationStatus(annotationMode === "manual" ? "画框已启用：在图像上按下并拖动" : "提示框已启用：框选目标后自动计算");
};

const toggleTrackingBySpace = async () => {
  if (!editMode || annotationMode !== "tracking") return;
  if (["pending", "running"].includes(annotationTask?.status)) {
    await controlAnnotationTask("pause");
    return;
  }
  if (annotationTask?.status === "paused") {
    if (selectedAnn) {
      setOperationStatus("正在从当前框重新分割目标并向后跟踪");
      await runAnnotationAlgorithm();
    }
    else await controlAnnotationTask("resume");
    return;
  }
  if (selectedAnn) {
    setOperationStatus("正在从当前框分割目标并向后跟踪");
    await runAnnotationAlgorithm();
  }
  else if (lastTrackingAnchorRef.current?.annotation) {
    const anchor = lastTrackingAnchorRef.current;
    await runAnnotationAlgorithm({ promptAnnotation: anchor.annotation, startIndex: Number(anchor.index || 0) });
  } else setOperationStatus("请先选择一个标签框，再按空格开始跟踪");
};

const exitEditing = async () => {
  if (draftDirty && !await save({ exit: false })) return;
  setEditMode(false);
  setAnnotationMode("");
  setTool("select");
  setOperationStatus("已退出编辑");
};

useEffect(() => {
  const onKeyDown = (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const key = String(event.key || "").toLowerCase();
    if (editMode && event.ctrlKey && key === "z") {
      event.preventDefault();
      undoDraft();
      return;
    }
    if (editMode && event.ctrlKey && key === "s") {
      event.preventDefault();
      save({ exit: false });
      return;
    }
    if (!typing && (["arrowleft", "a"].includes(key) || ["arrowright", "d"].includes(key))) {
      event.preventDefault();
      navigateBy(["arrowright", "d"].includes(key) ? 1 : -1);
      return;
    }
    if (typing) return;
    if (key === "b" && editMode && annotationMode) {
      event.preventDefault();
      toggleDrawTool();
      return;
    }
    if (key === "v") {
      event.preventDefault();
      toggleZoomMode();
      return;
    }
    if (event.code === "Space" && editMode && annotationMode === "tracking") {
      event.preventDefault();
      toggleTrackingBySpace();
      return;
    }
    if (key === "escape") {
      if (tool === "draw") toggleDrawTool();
      else if (annotationMode) selectAnnotationMode(annotationMode);
      else if (!editMode) { onPageChange?.(viewerPage); onClose(); }
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [editMode, annotationMode, tool, editDrag, annotationTask?.status, selectedAnnId, item?.id, index, scale, draftDirty, draft]);

const shortcutItems = [
  ["上一张图片", "A / ←"],
  ["下一张图片", "D / →"],
  [Math.abs(scale - 1) > 0.01 ? "适应窗口" : "恢复滚轮比例", "V"],
  ["缩放图片", "鼠标滚轮"],
  ...(editMode ? [["撤销当前图片操作", "Ctrl + Z"]] : []),
  ...(editMode ? [["立即保存标签", "Ctrl + S"]] : []),
  ...(editMode && annotationMode ? [[tool === "draw" ? (annotationMode === "manual" ? "取消画框" : "取消提示框") : (annotationMode === "manual" ? "开始画框" : "开始提示框"), "B"], ["退出当前模式", "Esc"]] : []),
  ...(editMode && annotationMode === "tracking" ? [[annotationTask?.status === "running" ? "暂停跟踪" : "开始或继续跟踪", "空格"]] : []),
  ...(editMode && selectedAnnId ? [["删除选中标签", "Delete"], ["多选标签", "Ctrl + 单击"]] : []),
];

return (

<div className={`viewer-overlay dataset-image-dialog viewer-${viewerTheme} ${editMode ? "viewer-editing" : ""}`} onMouseUp={() => { setDrag(null); setEditDrag(null); }} onMouseLeave={() => { setDrag(null); setEditDrag(null); }}>

<div className={`viewer-topbar ${editMode ? "annotation-editor-topbar" : ""}`}>

<div className="viewer-context-row">

{!readOnly && !editMode && <button className="edit-toggle" onClick={() => { setEditMode(true); setTool("select"); setOperationStatus("编辑已开启：可选择和调整标签；请选择模式后按 B 画框"); }}>编辑</button>}

<div className="viewer-file-identity">

<b>{item.display_name}</b>

<code title={item.absolute_path || item.source_path || ""}>{item.absolute_path || item.source_path || "未记录绝对路"}</code>

</div>

<label className="viewer-sequence-counter" title="输入图片序号并按回车跳转">
<input aria-label="当前图片序号" inputMode="numeric" value={ordinalText} onChange={(event) => setOrdinalText(event.target.value.replace(/\D/g, ""))} onBlur={() => setOrdinalText(String(sequenceUrl ? index + 1 : (viewerPage - 1) * pageSize + index + 1))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); jumpToOrdinal(); event.currentTarget.blur(); } }} />
<span>/ {viewerTotal}</span>
</label>

<div className="viewer-utility-actions">
<button onClick={() => zoom(-0.25)}>-</button>
<button onClick={() => zoom(0.25)}>+</button>
<button onClick={fitImage}>重置</button>
<button onClick={() => setViewerTheme((value) => value === "dark" ? "light" : "dark")} title="切换明暗模式"><Sun size={16} /></button>
<button onClick={async () => { if (editMode && draftDirty && !await save({ exit: false })) return; onPageChange?.(viewerPage); onClose(); }}><X size={16} /></button>
</div>

</div>

{editMode && (

<div className="annotation-action-row">

<div className="annotation-mode-control" role="tablist" aria-label="标注模式">
<button className={annotationMode === "manual" ? "active-tool" : ""} onClick={() => selectAnnotationMode("manual")}><MousePointer2 size={15} />手动标注</button>
<button className={annotationMode === "segmentation" ? "active-tool" : ""} onClick={() => selectAnnotationMode("segmentation")}><ScanLine size={15} />分割标注</button>
<button className={annotationMode === "tracking" ? "active-tool" : ""} onClick={() => selectAnnotationMode("tracking")}><Route size={15} />跟踪标注</button>
</div>

{annotationMode && <>
{annotationMode === "manual" && <button className={tool === "draw" ? "active-tool" : ""} onClick={toggleDrawTool}>画框</button>}

{annotationMode && annotationMode !== "manual" && <button className={tool === "draw" ? "active-tool" : ""} onClick={toggleDrawTool}>提示框</button>}

<input className="label-input" value={defaultLabel} onChange={(event) => setDefaultLabel(event.target.value)} placeholder="标签" />

{annotationMode && annotationMode !== "manual" && <select className="annotation-method-select" value={annotationAlgorithmId} onChange={(event) => setAnnotationAlgorithmId(event.target.value)}>
{!annotationAlgorithms.length && <option value="">正在加载方法...</option>}
{annotationAlgorithms.filter((algorithm) => supportsAnnotationOperation(algorithm, annotationMode === "segmentation" ? "segment" : "propagate")).map((algorithm) => <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>)}
</select>}

{annotationMode && annotationMode !== "manual" && <select className="annotation-method-select annotation-model-select" value={annotationModelId} onChange={(event) => setAnnotationModelId(event.target.value)} aria-label="模型权重">
<option value="">选择模型权重</option>
{compatibleAnnotationModels.map((model) => <option key={model.id} value={model.id}>{model.model_name ? `${model.model_name} · ${model.version_name}` : model.version_name}</option>)}
</select>}

{annotationMode && annotationMode !== "manual" && <select className="annotation-method-select annotation-env-select" value={annotationEnvironmentId} onChange={(event) => setAnnotationEnvironmentId(event.target.value)} aria-label="Python环境">
<option value="">选择运行环境</option>
{compatibleAnnotationEnvironments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
</select>}

{annotationMode === "tracking" && <button className="run-annotation-method" disabled={(!selectedAnn && !["pending", "running", "paused"].includes(annotationTask?.status)) || !annotationAlgorithmId || !annotationModelId || !annotationEnvironmentId} onClick={toggleTrackingBySpace}>{["pending", "running"].includes(annotationTask?.status) ? "暂停跟踪" : annotationTask?.status === "paused" ? "继续跟踪" : "开始跟踪"}</button>}
{annotationMode === "tracking" && <button title="从原视频补充过渡帧后重新跟踪" disabled={!selectedAnn || index >= viewerItems.length - 1 || !annotationAlgorithmId || !annotationModelId || !annotationEnvironmentId} onClick={() => setShowSupplementDialog(true)}><Film size={15} />补帧跟踪</button>}

<button disabled={!selectedAnnId} onClick={() => { const ids = selectedAnnIds.length ? selectedAnnIds : [selectedAnnId]; pushUndoSnapshot(`delete:${ids.join(",")}`); markDraftDirty(); setDraft((rows) => rows.filter((ann) => !ids.includes(ann.id))); setSelectedAnnId(null); setSelectedAnnIds([]); setOperationStatus(`已删除 ${ids.length} 个标签，正在保存`); }}>删除</button>

<label className="annotation-inline-toggle"><input type="checkbox" checked={replaceOverlaps} onChange={(event) => setReplaceOverlaps(event.target.checked)} />覆盖重叠</label>
<label className="annotation-iou-control">IoU <input type="number" min="0" max="1" step="0.05" value={overlapIou} onChange={(event) => setOverlapIou(Math.max(0, Math.min(1, Number(event.target.value) || 0)))} /></label>

<button className="save-ann" onClick={() => save()}>立即保存</button>
<button title="计算任务记录" onClick={() => setShowTaskHistory((value) => !value)}><History size={15} /></button>
</>}
<button className="edit-exit-button" onClick={exitEditing}>退出编辑</button>

</div>

)}

</div>

<div className={`viewer-operation-status ${editMode ? "editing" : ""}`} role="status"><b>当前操作</b><span>{operationStatus}</span>{annotationTask && <em>{annotationTask.progress || 0}% · {annotationTask.status}</em>}</div>

<aside className="viewer-shortcuts-panel" aria-label="当前可用快捷键">
<strong>快捷键</strong>
{shortcutItems.map(([action, key]) => <div key={`${action}-${key}`}><span>{action}</span><kbd>{key}</kbd></div>)}
</aside>

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

{editMode && showSupplementDialog && <div className="annotation-supplement-backdrop" onClick={() => setShowSupplementDialog(false)}>
<section className="annotation-supplement-dialog" role="dialog" aria-modal="true" aria-labelledby="supplement-dialog-title" onClick={(event) => event.stopPropagation()}>
<header><div><Film size={17} /><div><h3 id="supplement-dialog-title">补帧跟踪</h3><p>从当前帧与下一正式帧之间提取临时过渡帧</p></div></div><button title="关闭" onClick={() => setShowSupplementDialog(false)}><X size={15} /></button></header>
<label><span>补帧数量</span><input type="number" min="1" max="99" step="1" value={supplementCount} onChange={(event) => setSupplementCount(Math.max(1, Math.min(99, Number(event.target.value) || 1)))} /></label>
<p className="annotation-supplement-note">临时帧只参与连续跟踪，不进入数据集、统计和导出结果。</p>
<footer><button onClick={() => setShowSupplementDialog(false)}>取消</button><button className="primary" onClick={() => { setShowSupplementDialog(false); runAnnotationAlgorithm({ supplementFrames: supplementCount }); }}>准备补帧并跟踪</button></footer>
</section>
</div>}

<button className="viewer-page-button viewer-page-prev" title="上一张" disabled={sequenceUrl ? index <= 0 : (loadingPage || (!loadPage && index <= 0) || (loadPage && viewerPage <= 1 && index <= 0))} onClick={prev}><ChevronRight size={28} /></button>

<button className="viewer-page-button viewer-page-next" title="下一张" disabled={sequenceUrl ? index >= viewerItems.length - 1 : (loadingPage || (!loadPage && index >= viewerItems.length - 1) || (loadPage && (viewerPage * pageSize >= totalItems) && index >= viewerItems.length - 1))} onClick={next}><ChevronRight size={28} /></button>

<div

className="viewer-stage"

onWheel={(event) => {
const nextScale = Math.min(6, Math.max(0.25, Number((scale * (event.deltaY < 0 ? 1.12 : 0.89)).toFixed(2))));
const stageRect = event.currentTarget.getBoundingClientRect();
const cursor = { x: event.clientX - stageRect.left - stageRect.width / 2, y: event.clientY - stageRect.top - stageRect.height / 2 };
setPan((current) => ({
  x: cursor.x - (nextScale / scale) * (cursor.x - current.x),
  y: cursor.y - (nextScale / scale) * (cursor.y - current.y),
}));
setScale(nextScale);
if (nextScale !== 1) lastWheelScaleRef.current = nextScale;
setOperationStatus(`滚轮缩放 ${Math.round(nextScale * 100)}%；按 V 切换适应窗口`);

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
selectedIds={selectedAnnIds}
setSelectedIds={setSelectedAnnIds}

tool={tool}
annotationMode={annotationMode}

defaultLabel={defaultLabel}

setDefaultLabel={setDefaultLabel}

setDraft={setDraft}

editDrag={editDrag}

setEditDrag={setEditDrag}

updateAnn={updateAnn}

normalizeBox={normalizeBox}

pointFromEvent={pointFromEvent}
markDraftDirty={markDraftDirty}
pushUndoSnapshot={pushUndoSnapshot}
setOperationStatus={setOperationStatus}
onSelectAnnotation={selectExistingAnnotation}
onAdjustComplete={(annotation) => {
  if (annotation?.promptOnly && annotationMode === "segmentation") {
    setOperationStatus("提示框已调整，正在重新生成分割结果");
    runAnnotationAlgorithm({ promptAnnotation: annotation });
  } else {
    setOperationStatus("标签调整完成，正在保存");
  }
}}
onDrawComplete={(annotation) => {
  if (!annotation) return;
  if (annotationMode === "manual" && replaceOverlaps) {
    setDraft((rows) => rows.filter((row) => row.id === annotation.id || row.promptOnly || annotationIou(row, annotation) < overlapIou));
  }
  if (annotationMode === "manual") {
    markDraftDirty();
    setOperationStatus(`已完成标签 ${annotation.label}，正在保存到 ${item.display_name}`);
  }
  if (annotationMode === "segmentation") {
    setOperationStatus("提示框已完成，正在生成分割结果");
    runAnnotationAlgorithm({ promptAnnotation: annotation });
  }
  if (annotationMode === "tracking") {
    setOperationStatus("跟踪提示框已完成；按空格从当前框分割目标并向后跟踪");
  }
}}

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

<header><b>{selectedAnnRows.length > 1 ? `已选择 ${selectedAnnRows.length} 个框` : (selectedAnn.promptOnly ? "分割提示框" : "标注框")}</b><small>Ctrl 多选</small></header>
{selectedAnnRows.length > 1 ? <>
<label className="bulk-label-field">批量命名<input value={bulkLabel} onChange={(event) => { setBulkLabel(event.target.value); updateSelectedLabels(event.target.value); }} /></label>
<div className="selected-label-list">
{selectedAnnRows.map((annotation, rowIndex) => <div className="selected-annotation-row" key={annotation.id}>
<label><span>{rowIndex + 1}</span><input value={annotation.label || ""} onChange={(event) => { pushUndoSnapshot(`label:${annotation.id}`); updateAnn(annotation.id, { label: event.target.value }); }} /></label>
<div className="selected-annotation-geometry">
<GeometryField label="X" value={annotation.bbox_x} max={width} onCommit={(value) => updateAnn(annotation.id, { bbox_x: value })} />
<GeometryField label="Y" value={annotation.bbox_y} max={height} onCommit={(value) => updateAnn(annotation.id, { bbox_y: value })} />
<GeometryField label="W" value={annotation.bbox_w} max={width} min={1} onCommit={(value) => updateAnn(annotation.id, { bbox_w: value })} />
<GeometryField label="H" value={annotation.bbox_h} max={height} min={1} onCommit={(value) => updateAnn(annotation.id, { bbox_h: value })} />
</div>
</div>)}
</div>
</> : <label>标签<input value={selectedAnn.label || ""} onChange={(event) => { pushUndoSnapshot(`label:${selectedAnn.id}`); updateAnn(selectedAnn.id, { label: event.target.value }); setDefaultLabel(event.target.value); }} /></label>}
<div className="geometry-grid">
<GeometryField label="X" value={selectedAnn.bbox_x} max={width} onCommit={(value) => updateSelectedGeometry({ bbox_x: value })} />
<GeometryField label="Y" value={selectedAnn.bbox_y} max={height} onCommit={(value) => updateSelectedGeometry({ bbox_y: value })} />
{!(editDrag?.type === "draw" && editDrag.id === selectedAnn.id && Number(selectedAnn.bbox_w) <= 1 && Number(selectedAnn.bbox_h) <= 1) && <>
<GeometryField label="W" value={selectedAnn.bbox_w} max={width} min={1} onCommit={(value) => updateSelectedGeometry({ bbox_w: value })} />
<GeometryField label="H" value={selectedAnn.bbox_h} max={height} min={1} onCommit={(value) => updateSelectedGeometry({ bbox_h: value })} />
</>}
</div>

</div>

)}

</div>

);

}

function GeometryField({ label, value, onCommit, min = 0, max }) {
  const [text, setText] = useState(() => Number(value || 0).toFixed(1));
  useEffect(() => setText(Number(value || 0).toFixed(1)), [value]);
  const commit = () => onCommit(Math.max(min, Math.min(Number(max || Infinity), Number(text) || 0)));
  return <label>{label}<input type="number" min={min} max={max} step="0.1" value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { commit(); event.currentTarget.blur(); } }} /></label>;
}

function EditableAnnotationLayer({ width, height, annotations, selectedId, setSelectedId, selectedIds, setSelectedIds, tool, annotationMode, defaultLabel, setDefaultLabel, setDraft, editDrag, setEditDrag, updateAnn, normalizeBox, pointFromEvent, onDrawComplete, onAdjustComplete, onSelectAnnotation, markDraftDirty, pushUndoSnapshot, setOperationStatus }) {

const resizeEdges = (ann) => {
  const x = Number(ann.bbox_x || 0);
  const y = Number(ann.bbox_y || 0);
  const w = Number(ann.bbox_w || 1);
  const h = Number(ann.bbox_h || 1);
  return [
    { handle: "n", x1: x, y1: y, x2: x + w, y2: y },
    { handle: "e", x1: x + w, y1: y, x2: x + w, y2: y + h },
    { handle: "s", x1: x, y1: y + h, x2: x + w, y2: y + h },
    { handle: "w", x1: x, y1: y, x2: x, y2: y + h },
  ];
};

const beginDraw = (event) => {

if (tool !== "draw") return;

event.stopPropagation();

const p = pointFromEvent(event);

const id = `tmp_${Date.now()}`;

const label = defaultLabel.trim() || "unknown";

pushUndoSnapshot(annotationMode === "manual" ? "draw" : "prompt");

setDefaultLabel(label);

setDraft((rows) => [...rows, { id, label, bbox_x: p.x, bbox_y: p.y, bbox_w: 1, bbox_h: 1, shape_type: "rectangle", promptOnly: annotationMode !== "manual" }]);
if (annotationMode === "manual") markDraftDirty();
setOperationStatus(`${annotationMode === "manual" ? "开始画框" : "开始提示框"}：X ${p.x.toFixed(1)}，Y ${p.y.toFixed(1)}`);

setSelectedId(id);
setSelectedIds([id]);

setEditDrag({ type: "draw", id, start: p });

};

const moveDrag = (event) => {

if (!editDrag) return;

event.stopPropagation();

const p = pointFromEvent(event);

const ann = annotations.find((item) => item.id === editDrag.id);

if (!ann) return;

if (editDrag.type === "draw") {

const nextBox = normalizeBox({ x1: editDrag.start.x, y1: editDrag.start.y, x2: p.x, y2: p.y });
updateAnn(editDrag.id, nextBox);
setOperationStatus(`${annotationMode === "manual" ? "正在画框" : "正在绘制提示框"}：X ${nextBox.bbox_x.toFixed(1)}，Y ${nextBox.bbox_y.toFixed(1)}，W ${nextBox.bbox_w.toFixed(1)}，H ${nextBox.bbox_h.toFixed(1)}`);

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

<svg className={`ann-layer editable ${tool === "draw" ? "drawing" : "selecting"}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onMouseDown={beginDraw} onMouseMove={moveDrag} onMouseUp={() => {
  const completed = annotations.find((ann) => ann.id === editDrag?.id);
  if (editDrag?.type === "draw") onDrawComplete?.(completed);
  if (["move", "resize"].includes(editDrag?.type)) onAdjustComplete?.(completed);
  setEditDrag(null);
}}>

{annotations.map((ann) => {

const selected = ann.id === selectedId || selectedIds.includes(ann.id);

const color = labelColor(ann.label);
const initialDraw = editDrag?.type === "draw" && editDrag.id === ann.id && Number(ann.bbox_w) <= 2 && Number(ann.bbox_h) <= 2;

return (

<g key={ann.id}>

{!initialDraw && <>

<rect

className={selected ? "edit-box selected" : "edit-box"}

x={Number(ann.bbox_x || 0)}

y={Number(ann.bbox_y || 0)}

width={Math.max(1, Number(ann.bbox_w || 0))}

height={Math.max(1, Number(ann.bbox_h || 0))}

fill={ann.promptOnly ? "rgba(79,209,197,.08)" : "rgba(0,0,0,0.01)"}

stroke={color}

strokeDasharray={ann.promptOnly ? `${Math.max(4, width / 220)} ${Math.max(5, width / 180)}` : (ann.algorithmSuggestion ? `${Math.max(10, width / 120)} ${Math.max(7, width / 170)}` : undefined)}

strokeWidth={selected ? Math.max(2, width / 1050) : Math.max(1.25, width / 1750)}

onMouseDown={(event) => {

event.stopPropagation();

const p = pointFromEvent(event);
onSelectAnnotation?.(ann);
if (event.ctrlKey) {
  const nextIds = selectedIds.includes(ann.id) ? selectedIds.filter((id) => id !== ann.id) : [...selectedIds, ann.id];
  setSelectedIds(nextIds);
  setSelectedId(nextIds.at(-1) || null);
  setOperationStatus(`已选择 ${nextIds.length} 个标签框`);
  return;
}
setSelectedIds([ann.id]);
setSelectedId(ann.id);

pushUndoSnapshot(`move:${ann.id}`);
setEditDrag({ type: "move", id: ann.id, start: p, origin: { x: Number(ann.bbox_x), y: Number(ann.bbox_y) } });
setOperationStatus(`已选择标签 ${ann.label}；拖动调整位置，Ctrl + 单击多选`);

}}

/>

<text x={Number(ann.bbox_x || 0)} y={Math.max(18, Number(ann.bbox_y || 0) - 6)} fill={color} fontSize={Math.max(22, width / 85)}>{ann.label}</text>

{selected && resizeEdges(ann).map((edge) => (

<line

key={edge.handle}

className={`resize-edge ${edge.handle}`}

x1={edge.x1}

y1={edge.y1}

x2={edge.x2}

y2={edge.y2}

stroke="transparent"

strokeWidth={Math.max(12, width / 90)}

onMouseDown={(event) => {

event.stopPropagation();

const start = pointFromEvent(event);

pushUndoSnapshot(`resize:${ann.id}`);
setEditDrag({ type: "resize", id: ann.id, handle: edge.handle, start, origin: { x: Number(ann.bbox_x), y: Number(ann.bbox_y), w: Number(ann.bbox_w), h: Number(ann.bbox_h) } });
setOperationStatus(`正在调整标签 ${ann.label} 的尺寸`);

}}

/>

))}

</>}

</g>

);

})}

</svg>

);

}

export { AnnotationOverlay, EditableAnnotationLayer, ImageViewer, labelColor };
