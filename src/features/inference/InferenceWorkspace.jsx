import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Eye,
  Folder,
  FolderOpen,
  GripVertical,
  Play,
  Power,
  Pause,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import {
  completedEvaluationStatuses,
  formatCount,
  runStatusLabel,
  sortRuntimeJobsByTime,
} from "../../shared/presentation.js";
import { metadataLabel } from "../../shared/datasetMetadata.js";
import { useWorkspaceColumns, WorkspaceResizeHandle } from "../../shared/useWorkspaceColumns.jsx";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { CascadingProjectPicker } from "../../components/CascadingProjectPicker.jsx";
import { RecognitionClassPicker } from "../../components/RecognitionClassPicker.jsx";
import { ClassMappingPicker } from "../../components/ClassMappingPicker.jsx";
import { InferenceResultViewer } from "./InferenceResultViewer.jsx";
import { usePersistentSet } from "../../shared/usePersistentSet.js";
export function InferenceWorkspace({

projects,

mlModels,

modelVersions,

inferenceVersions,

inferenceAlgorithms,

algorithmAssets,

pythonEnvs,

assetLinks,

inferenceJobs,

inferenceForm,

setInferenceForm,

selectedInferenceEnv,

submitInferenceJob,

viewInferenceResults,

deleteInferenceJob,

deleteInferenceJobs,

requeueInferenceJob,
updateInferenceJobState,

moveRuntimeQueueJob,

helpers,

}) {

const { bestAssetLink, envTooltip, formatMetric, modelFamilyLabel, parseMaybeJson, predictionBoxStyle, predictionColor, predictionItems, predictionLegend, projectTreeRows, versionTooltip } = helpers;

const { columns, beginResize } = useWorkspaceColumns("det-dashboard.inference-columns", { left: 292, right: 418 });

const inferenceTableRef = useRef(null);
const [inferenceColumnWidths, setInferenceColumnWidths] = useState(() => {
  try {
    const stored = JSON.parse(window.localStorage.getItem("det-dashboard.inference-table-columns") || "null");
    return Array.isArray(stored) && stored.length === 12 ? stored : null;
  } catch {
    return null;
  }
});
const inferenceColumnTemplate = inferenceColumnWidths
  ? inferenceColumnWidths.map((width) => `${Math.round(width)}px`).join(" ")
  : "minmax(145px,1.35fr) minmax(90px,.78fr) minmax(105px,.9fr) minmax(68px,.5fr) minmax(94px,.7fr) minmax(112px,.82fr) minmax(62px,.48fr) minmax(62px,.48fr) minmax(66px,.5fr) minmax(66px,.5fr) minmax(66px,.5fr) minmax(184px,1.15fr)";
const inferenceTableStyle = { "--inference-table-columns": inferenceColumnTemplate };
const resetInferenceColumns = () => {
  setInferenceColumnWidths(null);
  window.localStorage.removeItem("det-dashboard.inference-table-columns");
};
const beginInferenceColumnResize = (event, index) => {
  event.preventDefault();
  event.stopPropagation();
  const cells = Array.from(inferenceTableRef.current?.querySelectorAll(":scope > .inference-table-head > span") || []);
  if (!cells[index] || !cells[index + 1]) return;
  const widths = cells.map((cell) => cell.getBoundingClientRect().width);
  const startX = event.clientX;
  const leftStart = widths[index];
  const rightStart = widths[index + 1];
  const minimums = [120, 76, 86, 62, 78, 92, 54, 54, 58, 58, 58, 170];
  const onMove = (moveEvent) => {
    const requested = moveEvent.clientX - startX;
    const delta = Math.max(minimums[index] - leftStart, Math.min(requested, rightStart - minimums[index + 1]));
    const next = [...widths];
    next[index] = leftStart + delta;
    next[index + 1] = rightStart - delta;
    setInferenceColumnWidths(next);
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.body.classList.remove("resizing-table-column");
    setInferenceColumnWidths((current) => {
      if (current) window.localStorage.setItem("det-dashboard.inference-table-columns", JSON.stringify(current));
      return current;
    });
  };
  document.body.classList.add("resizing-table-column");
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp, { once: true });
};

const selectedProject = projects.find((project) => project.id === inferenceForm.datasetProjectId);

const inferenceMetadataValues = (key) => Array.from(new Set(projects.flatMap((project) => {
  const value = project[key];
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : [parsed]; } catch { return String(value).split(","); }
}).map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

const inferenceFilterOptions = { scenes: inferenceMetadataValues("scenes"), views: inferenceMetadataValues("views"), modalities: inferenceMetadataValues("modalities"), labels: inferenceMetadataValues("labels") };
const selectedInferenceProjectIds = inferenceForm.datasetProjectIds?.length ? inferenceForm.datasetProjectIds : [inferenceForm.datasetProjectId].filter(Boolean);
const selectedInferenceLabels = Array.from(new Set(projects.filter((project) => selectedInferenceProjectIds.includes(project.id)).flatMap((project) => {
  const value = project.labels;
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : [parsed]; } catch { return String(value).split(","); }
}).map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const selectedVersion = modelVersions.find((version) => version.id === inferenceForm.modelVersionId);

const [inferenceServer, setInferenceServer] = useState({ running: false, port: 4180, modelName: "" });
const [inferenceServerBusy, setInferenceServerBusy] = useState(false);
const [inferenceServerError, setInferenceServerError] = useState("");
const [receiverId, setReceiverId] = useState("");

useEffect(() => {
  let active = true;
  const loadStatus = () => fetch("/api/ml/inference-server/status")
    .then((response) => response.json().then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok) throw new Error(data.error || "无法读取推理服务状态");
      if (active) setInferenceServer((current) => ({ ...current, ...data }));
    })
    .catch((error) => { if (active) setInferenceServerError(error.message); });
  loadStatus();
  const timer = window.setInterval(loadStatus, 10000);
  return () => { active = false; window.clearInterval(timer); };
}, []);

const toggleInferenceServer = () => {
  setInferenceServerBusy(true);
  setInferenceServerError("");
  const stopping = inferenceServer.running && receiverId;
  const weights = selectedVersion?.artifact_root
    ? `${String(selectedVersion.artifact_root).replace(/\/$/, "")}/weights/best.pt`
    : "";
  const endpoint = stopping
    ? `/api/ml/inference-receiver/${receiverId}/stop`
    : "/api/ml/inference-receiver/start";
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stopping ? JSON.stringify({}) : JSON.stringify({
      name: inferenceForm.name || "远程接收推理",
      datasetProjectId: inferenceForm.datasetProjectId,
      modelVersionId: inferenceForm.modelVersionId,
      algorithmAssetId: inferenceForm.templateId,
      params: { categorySettings: inferenceForm.classMappings || inferenceForm.inputLabels || [] },
      weights,
      host: "0.0.0.0",
      port: 4180,
      device: inferenceForm.device || "cpu",
      conf: Number(inferenceForm.conf || 0.25),
      iou: Number(inferenceForm.iou || 0.7),
      imgsz: Number(inferenceForm.imgsz || 640),
    }),
  })
    .then((response) => response.json().then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok) throw new Error(data.error || "推理服务操作失败");
      const receiver = data.receiver || data.job || {};
      if (receiver.id || receiver.receiverId) setReceiverId(receiver.id || receiver.receiverId);
      if (stopping) setReceiverId("");
      setInferenceServer((current) => ({ ...current, ...(data.server || data), running: stopping ? false : true }));
    })
    .catch((error) => setInferenceServerError(error.message))
    .finally(() => setInferenceServerBusy(false));
};

  const visibleInferenceAlgorithms = inferenceAlgorithms.length ? inferenceAlgorithms : algorithmAssets;

  const selectedAlgorithm = visibleInferenceAlgorithms.find((algorithm) => algorithm.id === inferenceForm.templateId);

const sortedInferenceJobs = sortRuntimeJobsByTime(inferenceJobs);
const [queueOrder, setQueueOrder] = useState(() => sortedInferenceJobs.map((job) => job.id));
const queueOrderRef = useRef(queueOrder);
const [draggedJobId, setDraggedJobId] = useState("");
const [dragOverJobId, setDragOverJobId] = useState("");

useEffect(() => {
  const incomingIds = sortedInferenceJobs.map((job) => job.id);
  setQueueOrder((current) => {
    const incomingSet = new Set(incomingIds);
    const retained = current.filter((id) => incomingSet.has(id));
    const added = incomingIds.filter((id) => !retained.includes(id));
    const next = [...added, ...retained];
    queueOrderRef.current = next;
    return next;
  });
}, [inferenceJobs]);

const latestJob = sortedInferenceJobs[0];

const latestMetrics = parseMaybeJson(latestJob?.metrics_json);

const latestDone = completedEvaluationStatuses.has(String(latestJob?.status || "").toLowerCase());

const [previewRows, setPreviewRows] = useState([]);

const [liveLogs, setLiveLogs] = useState([]);

const [matchingImageCount, setMatchingImageCount] = useState(null);

const [evaluation, setEvaluation] = useState(null);

const [activeAnalysis, setActiveAnalysis] = useState("overview");

const [errorFilter, setErrorFilter] = useState("false_negative");
  const [sampleOffset, setSampleOffset] = useState(0);
  const [sampleViewer, setSampleViewer] = useState(null);

useEffect(() => {
  const countProjectIds = inferenceForm.datasetProjectIds?.length ? inferenceForm.datasetProjectIds : [inferenceForm.datasetProjectId].filter(Boolean);
  if (!countProjectIds.length) {
    setMatchingImageCount(null);
    return undefined;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    const query = new URLSearchParams();
    if (inferenceForm.inputViews) query.set("views", inferenceForm.inputViews);
    if (inferenceForm.inputScenes) query.set("scenes", inferenceForm.inputScenes);
    if (inferenceForm.inputModalities) query.set("modalities", inferenceForm.inputModalities);
    if (inferenceForm.inputLabels) query.set("labels", inferenceForm.inputLabels);
    if (inferenceForm.inputQuery) query.set("q", inferenceForm.inputQuery);
    Promise.all(countProjectIds.map((projectId) => fetch(`/api/projects/${projectId}/images-count?${query}`, { signal: controller.signal }).then((response) => response.json())))
      .then((rows) => setMatchingImageCount(rows.reduce((sum, data) => sum + Number(data.count || 0), 0)))
      .catch((error) => { if (error.name !== "AbortError") setMatchingImageCount(null); });
  }, 250);
  return () => { window.clearTimeout(timer); controller.abort(); };
}, [inferenceForm.datasetProjectId, JSON.stringify(inferenceForm.datasetProjectIds || []), inferenceForm.inputViews, inferenceForm.inputScenes, inferenceForm.inputModalities, inferenceForm.inputLabels, inferenceForm.inputQuery]);

const effectiveInferenceImageCount = matchingImageCount == null
  ? null
  : (Number(inferenceForm.inputLimit || 0) > 0 ? Math.min(matchingImageCount, Number(inferenceForm.inputLimit)) : matchingImageCount);

const [expandedGroups, setExpandedGroups] = usePersistentSet("det-dashboard.inference-resource-groups", ["算法适配", "Python 环境"]);
const [expandedDataNodes, setExpandedDataNodes] = usePersistentSet("det-dashboard.inference-data-nodes", []);

const setField = (key, value) => setInferenceForm({ ...inferenceForm, [key]: value });

const inferenceProjectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

const topLevelDatasetProjects = useMemo(
  () => projects.filter((project) => !project.parent_id),
  [projects],
);

const selectedRootProject = useMemo(() => {
  let cursor = selectedProject;
  const seen = new Set();
  while (cursor?.parent_id && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    cursor = inferenceProjectById.get(cursor.parent_id) || cursor;
    if (!cursor?.parent_id) break;
  }
  return cursor || null;
}, [selectedProject, inferenceProjectById]);

const selectedRootProjectId = selectedRootProject?.id || "";

const secondLevelDatasetOptions = useMemo(() => {
  if (!selectedRootProjectId) return [];
  const root = inferenceProjectById.get(selectedRootProjectId);
  const children = projects.filter((project) => project.parent_id === selectedRootProjectId);
  const rootHasAssets = Number(root?.image_count || 0) > 0 || Number(root?.video_count || 0) > 0;
  const rows = (rootHasAssets || !children.length) ? [{ ...root, datasetOptionLabel: "当前一级项目" }] : [];
  rows.push(...children.map((project) => ({ ...project, datasetOptionLabel: project.name })));
  if (selectedProject && !rows.some((project) => project.id === selectedProject.id)) {
    rows.push({ ...selectedProject, datasetOptionLabel: `${selectedRootProject?.name || "项目"} / ${selectedProject.name}` });
  }
  return rows;
}, [projects, inferenceProjectById, selectedRootProjectId, selectedProject, selectedRootProject]);

const selectDatasetRoot = (rootId) => {
  const root = inferenceProjectById.get(rootId);
  const children = projects.filter((project) => project.parent_id === rootId);
  const rootHasAssets = Number(root?.image_count || 0) > 0 || Number(root?.video_count || 0) > 0;
  const nextProjectId = (rootHasAssets || !children.length) ? rootId : (children[0]?.id || rootId || "");
  setField("datasetProjectId", nextProjectId);
};

const toggleGroup = (title) => {

setExpandedGroups((current) => {

const next = new Set(current);

if (next.has(title)) next.delete(title);

else next.add(title);

return next;

});

};

useEffect(() => {

if (!latestJob?.id) {

setPreviewRows([]);

return;

}

let ignore = false;

fetch(`/api/ml/inference-jobs/${latestJob.id}/results`)

.then((r) => r.json())

.then((data) => { if (!ignore) setPreviewRows(data.results || []); })

.catch(() => { if (!ignore) setPreviewRows([]); });

return () => { ignore = true; };

}, [latestJob?.id, latestJob?.status, latestJob?.progress]);

useEffect(() => {
  if (!latestJob?.id) {
    setLiveLogs([]);
    return undefined;
  }
  let ignore = false;
  const loadLogs = () => fetch(`/api/ml/inference-jobs/${latestJob.id}/logs`)
    .then((response) => response.json())
    .then((data) => { if (!ignore) setLiveLogs(data.logs || []); })
    .catch(() => {});
  loadLogs();
  const timer = window.setInterval(loadLogs, 1000);
  return () => { ignore = true; window.clearInterval(timer); };
}, [latestJob?.id]);

const selectAlgorithm = (id) => {

    const algorithm = visibleInferenceAlgorithms.find((item) => item.id === id) || algorithmAssets.find((item) => item.id === id);

const tasks = algorithm?.capabilities_json?.tasks || ["detect", "segment", "classify"];

const link = bestAssetLink(assetLinks, id);

setInferenceForm({

...inferenceForm,

templateId: id,

taskType: tasks.includes(inferenceForm.taskType) ? inferenceForm.taskType : tasks[0] || "detect",

pythonEnvId: link?.python_env_id || inferenceForm.pythonEnvId,

modelVersionId: link?.model_version_id || inferenceForm.modelVersionId,

datasetProjectId: inferenceForm.datasetProjectId || link?.dataset_project_id || "",

});

};

const familyRows = Array.from(new Set(mlModels.map((model) => modelFamilyLabel(model.name)))).map((family) => {

const familyModels = mlModels.filter((model) => modelFamilyLabel(model.name) === family);

const versions = modelVersions.filter((version) => familyModels.some((model) => model.id === version.model_id));

return { family, count: versions.length, modelId: familyModels[0]?.id || "", versions };

});

const selectedFamily = selectedVersion?.model_name ? modelFamilyLabel(selectedVersion.model_name) : (mlModels.find((model) => model.id === inferenceForm.modelId)?.name ? modelFamilyLabel(mlModels.find((model) => model.id === inferenceForm.modelId)?.name) : "");

const selectFamily = (family) => {

const modelIds = mlModels.filter((model) => modelFamilyLabel(model.name) === family).map((model) => model.id);

const firstVersion = modelVersions.find((version) => modelIds.includes(version.model_id));

setInferenceForm({ ...inferenceForm, modelId: modelIds[0] || "", modelVersionId: firstVersion?.id || "" });

};

const datasetRows = projectTreeRows(projects).filter((project) => { let parentId = project.parent_id; while (parentId) { if (!expandedDataNodes.has(parentId)) return false; parentId = inferenceProjectById.get(parentId)?.parent_id; } return true; }).slice(0, 40);

const modelTreeRows = familyRows.flatMap((family) => [

{

id: `family-${family.family}`,

name: family.family,

right: family.count,

depth: 0,

icon: Database,

active: family.family === selectedFamily,

title: `${family.family}\n版本数：${family.count}`,

onClick: () => selectFamily(family.family),

},

...family.versions.slice(0, 6).map((version) => ({

id: version.id,

name: version.version_name,

right: version.stage || "",

depth: 1,

icon: Boxes,

active: version.id === inferenceForm.modelVersionId,

badge: version.id === bestAssetLink(assetLinks, inferenceForm.templateId)?.model_version_id ? "推荐" : "",

title: versionTooltip(version),

onClick: () => setInferenceForm({ ...inferenceForm, modelId: version.model_id || "", modelVersionId: version.id }),

})),

]);

const resourceGroups = [

{

title: "数据",

icon: FolderOpen,

count: projects.length,

rows: datasetRows.map((project) => ({

id: project.id,

name: project.name,

right: project.image_count || 0,

depth: project.depth,

icon: project.hasChildren ? FolderOpen : Folder,

active: (inferenceForm.datasetProjectIds?.length ? inferenceForm.datasetProjectIds : [inferenceForm.datasetProjectId]).includes(project.id),
hasChildren: project.hasChildren,
expanded: expandedDataNodes.has(project.id),
onToggle: () => setExpandedDataNodes((current) => { const next = new Set(current); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; }),

title: `${project.name}\n图片：${project.image_count || 0}\n视频：${project.video_count || 0}`,

onClick: () => { const current = inferenceForm.datasetProjectIds?.length ? inferenceForm.datasetProjectIds : [inferenceForm.datasetProjectId].filter(Boolean); const next = current.includes(project.id) ? current.filter((id) => id !== project.id) : [...current, project.id]; setInferenceForm({ ...inferenceForm, datasetProjectIds: next, datasetProjectId: next[0] || "" }); },

})),

},

{

title: "算法适配",

icon: Boxes,

count: visibleInferenceAlgorithms.length,

      rows: visibleInferenceAlgorithms.map((algorithm) => ({

id: algorithm.id,

name: algorithm.name,

right: algorithm.version || "",

depth: 0,

icon: Boxes,

active: algorithm.id === inferenceForm.templateId,

badge: bestAssetLink(assetLinks, algorithm.id) ? "兼容" : "",

title: `${algorithm.name}\n${algorithm.framework || "custom"} · ${algorithm.task_type || "detect"}\n${algorithm.minio_prefix || ""}`,

onClick: () => selectAlgorithm(algorithm.id),

})),

},

{

title: "模型",

icon: Database,

count: familyRows.length,

rows: modelTreeRows,

},

{

title: "Python 环境",

icon: Cpu,

count: pythonEnvs.length,

rows: pythonEnvs.map((env) => ({

id: env.id,

name: env.name,

right: env.status,

depth: 0,

icon: Cpu,

active: env.id === inferenceForm.pythonEnvId,

badge: env.id === bestAssetLink(assetLinks, inferenceForm.templateId)?.python_env_id ? "兼容" : "",

title: envTooltip(env),

onClick: () => setField("pythonEnvId", env.id),

})),

},

].filter((group) => group.rows.length);

const jobById = new Map(sortedInferenceJobs.map((job) => [job.id, job]));
const displayJobs = queueOrder.map((id) => jobById.get(id)).filter(Boolean);
const beginJobDrag = (event, jobId) => {
  event.preventDefault();
  setDraggedJobId(jobId);
  setDragOverJobId(jobId);
  event.currentTarget.setPointerCapture?.(event.pointerId);
};
const moveDraggedJob = (event, explicitTargetId) => {
  if (!draggedJobId) return;
  event.preventDefault();
  const targetId = explicitTargetId || document.elementFromPoint(event.clientX, event.clientY)?.closest(".inference-table-row")?.dataset.jobId;
  if (!draggedJobId || draggedJobId === targetId) return;
  setDragOverJobId(targetId);
  setQueueOrder((current) => {
    const sourceIndex = current.indexOf(draggedJobId);
    const targetIndex = current.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return current;
    const next = [...current];
    next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, draggedJobId);
    queueOrderRef.current = next;
    return next;
  });
};
const finishJobDrag = (event) => {
  if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  if (draggedJobId) moveRuntimeQueueJob?.("inference", draggedJobId, queueOrderRef.current);
  setDraggedJobId("");
  setDragOverJobId("");
};
const [selectedInferenceJobIds, setSelectedInferenceJobIds] = useState(() => new Set());

const selectedInferenceCount = selectedInferenceJobIds.size;

const allVisibleInferenceJobsSelected = displayJobs.length > 0 && displayJobs.every((job) => selectedInferenceJobIds.has(job.id));

const selectedInferenceQueueLabel = selectedInferenceCount ? `删除已选 ${selectedInferenceCount}` : "删除队列";

useEffect(() => {

setSelectedInferenceJobIds((current) => {

const validIds = new Set(sortedInferenceJobs.map((job) => job.id));

const next = new Set(Array.from(current).filter((id) => validIds.has(id)));

return next.size === current.size ? current : next;

});

}, [inferenceJobs]);

const toggleInferenceJobSelection = (jobId) => {

setSelectedInferenceJobIds((current) => {

const next = new Set(current);

if (next.has(jobId)) next.delete(jobId);

else next.add(jobId);

return next;

});

};

const toggleVisibleInferenceJobsSelection = () => {

setSelectedInferenceJobIds((current) => {

const next = new Set(current);

if (allVisibleInferenceJobsSelected) displayJobs.forEach((job) => next.delete(job.id));

else displayJobs.forEach((job) => next.add(job.id));

return next;

});

};

const deleteInferenceQueue = () => {

const ids = selectedInferenceCount ? Array.from(selectedInferenceJobIds) : sortedInferenceJobs.map((job) => job.id);

const result = deleteInferenceJobs?.(ids);

if (result?.then) result.then((deleted) => { if (deleted) setSelectedInferenceJobIds(new Set()); });

};

const previewItems = previewRows.slice(0, 12);

  const legendItems = predictionLegend(previewItems);

const latestJobParams = parseMaybeJson(latestJob?.params_json);
const executionLog = liveLogs.length
  ? liveLogs.map((entry) => `[${entry.stream}] ${entry.line}`).join("\n")
  : latestJobParams?.output?.executionLog
  || latestJobParams?.output?.stderr
  || latestJobParams?.output?.stdout
  || latestJob?.message
  || "等待执行脚本输出";

return (
  <div className="inference-workspace resizable-workspace" style={{ "--workspace-left": `${columns.left}px`, "--workspace-right": `${columns.right}px` }}>
    <aside className="inference-sidebar reference-sidebar">
      <div className="resource-sidebar-head"><h2>推理资源</h2></div>
      <div className="resource-mode-tabs inference-resource-tabs" aria-label="推理资源类型">
        <button className="active" type="button">推理</button>
      </div>
      <div className="resource-tree">
        {resourceGroups.map((group) => {
          const GroupIcon = group.icon;
          const isOpen = expandedGroups.has(group.title);
          return (
            <section className="resource-group" key={group.title}>
              <button className="resource-group-head" type="button" onClick={() => toggleGroup(group.title)}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <GroupIcon size={14} />
                <b>{group.title}</b>
                <em>{group.count}</em>
              </button>
              {isOpen && group.rows.map((row) => {
                const RowIcon = row.icon;
                return (
                  <div
                    className={`resource-tree-row ${row.active ? "active" : ""} depth-${row.depth || 0}`}
                    key={`${group.title}-${row.id}`}
                    title={row.title}
                    style={{ "--depth": row.depth || 0 }}
                  >
                    <button className="resource-node-toggle" type="button" disabled={!row.hasChildren} onClick={row.onToggle}>{row.hasChildren ? (row.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}</button>
                    <button className="resource-node-select" type="button" onClick={row.onClick}><RowIcon size={14} /><span>{row.name}</span>{row.badge && <i>{row.badge}</i>}<em>{row.right}</em></button>
                  </div>
                );
              })}
              {isOpen && !group.rows.length && <p className="resource-empty">暂无资源</p>}
            </section>
          );
        })}
      </div>
      <div className="resource-usage">
        <div><span>资源使用</span><b>68%</b></div>
        <progress value="68" max="100" />
        <em>20 / 29</em>
      </div>
    </aside>

    <WorkspaceResizeHandle side="left" onPointerDown={beginResize} />

    <main className="inference-main">
      <div className="inference-toolbar">
        <div className="workspace-path-row">
          <FolderOpen size={16} />
          <button type="button">推理</button>
          <ChevronRight size={14} />
          <button type="button">新建任务</button>
        </div>
        <div className="workspace-commandbar inference-commandbar">
          <button className={inferenceServer.running ? "danger" : "primary"} type="button" onClick={toggleInferenceServer} disabled={inferenceServerBusy || (!inferenceServer.running && !selectedVersion)}>
            <Power size={15} />{inferenceServerBusy ? "处理中..." : inferenceServer.running ? "关闭推理服务" : "开启推理服务"}
          </button>
          <button className="primary" type="button" onClick={submitInferenceJob}><Play size={15} />开始推理</button>
          <button type="button"><Copy size={16} />批量运行</button>
          <button className="danger-outline" type="button" disabled={!sortedInferenceJobs.length} onClick={deleteInferenceQueue} title={selectedInferenceCount ? "删除选中的推理任务" : "删除全部推理任务队列"}><Trash2 size={16} />{selectedInferenceQueueLabel}</button>
          <button type="button"><RefreshCw size={16} />刷新</button>
        </div>
        {inferenceServer.running && <p className="muted">推理服务运行中：端口 {inferenceServer.port || 4180}{inferenceServer.modelName ? ` · ${inferenceServer.modelName}` : ""}</p>}
        {inferenceServerError && <p className="form-error">推理服务：{inferenceServerError}</p>}
      </div>

      <section className="reference-builder">
        <div className="reference-section">
          <h2>数据来源</h2>
          <div className="config-row inference-task-name-row">
            <span className="row-label">任务名称</span>
            <input
              value={inferenceForm.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="可留空，将按 数据集_模型_时间 自动生成"
            />
          </div>
          <div className="config-row dataset-source-row">
            <span className="row-label">数据来源</span>
            <span className="dataset-source-kind"><Database size={14} />数据集</span>
            <CascadingProjectPicker projects={projects} values={inferenceForm.datasetProjectIds?.length ? inferenceForm.datasetProjectIds : [inferenceForm.datasetProjectId].filter(Boolean)} multiple onChange={(projectIds) => setInferenceForm({ ...inferenceForm, datasetProjectIds: projectIds, datasetProjectId: projectIds[0] || "" })} storageKey="inference-datasets" ariaLabel="推理数据集树形选择" />
          </div>
          <div className="config-row recognition-class-row">
            <span className="row-label">识别类别</span>
            <RecognitionClassPicker values={inferenceForm.recognitionClasses} onChange={(recognitionClasses) => setInferenceForm((current) => ({ ...current, recognitionClasses }))} />
          </div>
          <div className="config-row class-mapping-config-row">
            <span className="row-label">类别映射</span>
            <ClassMappingPicker availableSources={selectedInferenceLabels} defaultTargets={inferenceForm.recognitionClasses} configured={inferenceForm.classMappingsConfigured} mappings={inferenceForm.classMappings} onChange={({ configured, mappings }) => setInferenceForm((current) => ({ ...current, classMappingsConfigured: configured, classMappings: mappings, ...(configured && mappings.length ? { recognitionClasses: mappings.map((row) => row.target) } : {}) }))} />
          </div>
          <div className="config-row filter-row">
            <span className="row-label">筛选条件</span>
            <select value={inferenceForm.inputViews} onChange={(e) => setField("inputViews", e.target.value)}><option value="">视角：全部</option>{inferenceFilterOptions.views.map((value) => <option key={value} value={value}>{metadataLabel(value, "view")}</option>)}</select>
            <select value={inferenceForm.inputScenes} onChange={(e) => setField("inputScenes", e.target.value)}><option value="">场景：全部</option>{inferenceFilterOptions.scenes.map((value) => <option key={value} value={value}>{metadataLabel(value, "scene")}</option>)}</select>
            <select value={inferenceForm.inputModalities} onChange={(e) => setField("inputModalities", e.target.value)}><option value="">模态：全部</option>{inferenceFilterOptions.modalities.map((value) => <option key={value} value={value}>{metadataLabel(value, "modality")}</option>)}</select>
            <select value={inferenceForm.inputLabels} onChange={(e) => setField("inputLabels", e.target.value)}><option value="">标签：全部</option>{inferenceFilterOptions.labels.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <input value={inferenceForm.inputQuery} onChange={(e) => setField("inputQuery", e.target.value)} placeholder="其他标签/关键词" />
            <button type="button" onClick={() => setInferenceForm({ ...inferenceForm, inputViews: "", inputScenes: "", inputModalities: "", inputLabels: "", inputQuery: "" })}>清空</button>
            <label className="inference-sample-count" title="留空表示使用全部筛选结果"><span>随机数量</span><input type="number" min="1" step="1" value={inferenceForm.inputLimit || ""} onChange={(e) => setField("inputLimit", e.target.value)} placeholder="全部" /></label>
            <strong className="inference-match-count">{effectiveInferenceImageCount == null ? "等待统计" : `已选 ${formatCount(effectiveInferenceImageCount)} / ${formatCount(matchingImageCount)} 张`}</strong>
          </div>
        </div>

        <div className="reference-section">
          <h2>模型与算法</h2>
          <div className="config-row model-row">
            <span className="row-label">算法适配器</span>
            <select value={inferenceForm.templateId} onChange={(e) => selectAlgorithm(e.target.value)}>
              <option value="">请选择算法适配器</option>
              {visibleInferenceAlgorithms.map((algorithm) => <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>)}
            </select>
            <span className="row-label">模型簇</span>
            <select value={selectedFamily} onChange={(e) => selectFamily(e.target.value)}>
              <option value="">请选择模型簇</option>
              {familyRows.map((family) => <option key={family.family} value={family.family}>{family.family}</option>)}
            </select>
            <span className="row-label">模型版本</span>
            <select value={inferenceForm.modelVersionId} onChange={(e) => setField("modelVersionId", e.target.value)} title={versionTooltip(selectedVersion)}>
              <option value="">请选择模型版本</option>
              {inferenceVersions.map((version) => <option key={version.id} value={version.id} title={versionTooltip(version)}>{version.model_name} / {version.version_name}</option>)}
            </select>
            <span className="row-label">Python 环境</span>
            <select value={inferenceForm.pythonEnvId} onChange={(e) => setField("pythonEnvId", e.target.value)}>
              <option value="">请选择 Python 环境</option>
              {pythonEnvs.map((env) => <option key={env.id} value={env.id}>{env.name} · {env.status}</option>)}
            </select>
            <label className="switch-option fake-reference-switch" title="Fake GT" aria-label="Fake GT">
              <span className="switch-control">
                <input type="checkbox" checked={Boolean(inferenceForm.fakeReferenceMode)} onChange={() => setField("fakeReferenceMode", !inferenceForm.fakeReferenceMode)} />
                <i />
              </span>
            </label>
          </div>
        </div>

        <div className="reference-section">
          <h2>推理参数</h2>
          <div className="config-row param-row">
            <span className="row-label">置信度阈值</span><input type="number" step="0.01" value={inferenceForm.conf} onChange={(e) => setField("conf", e.target.value)} />
            <span className="row-label">IoU 阈值</span><input type="number" step="0.01" value={inferenceForm.iou} onChange={(e) => setField("iou", e.target.value)} />
            <span className="row-label">图像尺寸</span><input type="number" value={inferenceForm.imgsz} onChange={(e) => setField("imgsz", e.target.value)} />
            <span className="row-label">批大小</span><input type="number" value={inferenceForm.batch} onChange={(e) => setField("batch", e.target.value)} />
            <span className="row-label">设备</span><select value={inferenceForm.device} onChange={(e) => setField("device", e.target.value)}><option value="cpu">CPU</option><option value="0">0</option></select>
          </div>
        </div>

        <div className="reference-section">
          <h2>输出选项</h2>
          <div className="config-row output-row">
            <label className="switch-option">保存预测结果 JSON<span className="switch-control"><input type="checkbox" checked={inferenceForm.saveJson} onChange={() => setField("saveJson", !inferenceForm.saveJson)} /><i /></span></label>
            <label className="switch-option">保存可视化结果<span className="switch-control"><input type="checkbox" checked={inferenceForm.saveVisualization} onChange={() => setField("saveVisualization", !inferenceForm.saveVisualization)} /><i /></span></label>
            <label className="switch-option">创建标签版本<span className="switch-control"><input type="checkbox" checked={inferenceForm.createLabelVersion} onChange={() => setField("createLabelVersion", !inferenceForm.createLabelVersion)} /><i /></span></label>
            <span className="row-label">输出目录</span><label className="path-select"><input value="/inference/outputs" readOnly /><FolderOpen size={14} /></label>
          </div>
        </div>
      </section>

      <section className="reference-queue">
        <div className="section-title-row compact-title">
          <h2>推理任务队列</h2>
          <span className="muted">共 {inferenceJobs.length} 条</span>
        </div>
        <div className="inference-table" ref={inferenceTableRef} style={inferenceTableStyle}>
          <div className="inference-table-head">
            {[
              <><input type="checkbox" checked={allVisibleInferenceJobsSelected} onChange={toggleVisibleInferenceJobsSelection} disabled={!displayJobs.length} />任务名称</>,
              "数据集", "模型", "状态", "来源", "进度", "图像数", "预测数", "Precision", "Recall", "mAP50", "操作",
            ].map((label, index) => (
              <span className={index === 0 ? "inference-task-name" : ""} key={index}>
                {label}
                {index < 11 && <i className="table-column-resizer" role="separator" aria-orientation="vertical" title="拖动调整列宽，双击恢复自动宽度" onPointerDown={(event) => beginInferenceColumnResize(event, index)} onDoubleClick={resetInferenceColumns} />}
              </span>
            ))}
          </div>
          {displayJobs.map((job) => {
            const metrics = parseMaybeJson(job.metrics_json);
            const done = completedEvaluationStatuses.has(String(job.status || "").toLowerCase());
            const progress = Math.max(0, Math.min(100, Number(job.progress ?? (done ? 100 : 0)) || 0));
            return (
              <div data-job-id={job.id} className={`inference-table-row${draggedJobId === job.id ? " is-dragging" : ""}${dragOverJobId === job.id ? " is-drag-over" : ""}`} key={job.id}>
                <b className="inference-task-name"><input type="checkbox" checked={selectedInferenceJobIds.has(job.id)} onChange={() => toggleInferenceJobSelection(job.id)} /><span>{job.name || `推理任务 ${job.id.slice(0, 8)}`}</span></b>
                <span>{job.dataset_project_name || "未绑定"}</span>
                <span title={versionTooltip(modelVersions.find((version) => version.id === job.model_version_id) || {})}>{job.model_name || selectedVersion?.model_name || "未绑定模型"}</span>
                <em className={`status-badge status-${job.status}`}>{runStatusLabel(job.status)}</em>
                <span>{parseMaybeJson(job.params_json).taskSource === "external_api" ? "外部接口推理" : parseMaybeJson(job.params_json).taskType === "test" ? "本地文件推理" : "本地验证评测"}</span>
                <span className="inference-progress" title={`进度 ${progress}%`}><progress value={progress} max="100" /><small>{progress}%</small></span>
                <span>{metrics.images ?? job.image_count ?? 0}</span>
                <span>{metrics.predictions ?? job.prediction_count ?? 0}</span>
                <span>{formatMetric(metrics.precision)}</span>
                <span>{formatMetric(metrics.recall)}</span>
                <span>{formatMetric(metrics.map50)}</span>
                <div className="queue-actions">
                  <span className="queue-action-row">
                    <button type="button" title="查看详情" disabled={!done} onClick={() => viewInferenceResults(job)}><Eye size={14} /></button>
                    <button type="button" title={job.status === "paused" ? "继续任务" : "暂停任务"} disabled={done} onClick={() => updateInferenceJobState?.(job.id, job.status === "paused" ? "resume" : "pause")}>{job.status === "paused" ? <Play size={14} /> : <Pause size={14} />}</button>
                    <button className="restart-action" type="button" title="重新开始" onClick={() => requeueInferenceJob?.(job.id)}><RotateCcw size={15} strokeWidth={2.2} /></button>
                    <button className="danger-icon" type="button" title="删除任务" onClick={() => deleteInferenceJob(job.id)}><Trash2 size={14} /></button>
                  </span>
                  <button className="queue-drag-handle" type="button" title="按住拖动任务排序" aria-label="拖动任务排序" onPointerDown={(event) => beginJobDrag(event, job.id)} onPointerMove={moveDraggedJob} onPointerUp={finishJobDrag} onPointerCancel={finishJobDrag}><GripVertical size={15} /></button>
                </div>
              </div>
            );
          })}
          {!sortedInferenceJobs.length && <div className="empty-state">推理队列为空</div>}
        </div>
      </section>
    </main>

    <WorkspaceResizeHandle side="right" onPointerDown={beginResize} />

    <aside className="inference-inspector reference-inspector">
      <div className="inspector-title">
        <h2>推理结果</h2>
        <button type="button"><RefreshCw size={14} /></button>
      </div>
      <div className="reference-result-stats">
        <div><span>任务状态</span><b className={latestDone ? "" : "running-text"}>{latestJob ? runStatusLabel(latestJob.status) : "--"}</b></div>
        <div><span>图像结果</span><b>{latestMetrics.images ?? latestJob?.image_count ?? "--"}</b></div>
        <div><span>预测数量</span><b>{latestMetrics.predictions ?? latestJob?.prediction_count ?? "--"}</b></div>
        <div><span>Precision</span><b>{formatMetric(latestMetrics.precision)}</b></div>
        <div><span>Recall</span><b>{formatMetric(latestMetrics.recall)}</b></div>
        <div><span>mAP50</span><b>{formatMetric(latestMetrics.map50)}</b></div>
        <div><span>mAP50-95</span><b>{formatMetric(latestMetrics.map)}</b></div>
      </div>
      <div className="result-preview-strip reference-preview">
        <h3>结果预览 <span>（最近 12 张）</span><button type="button" disabled={!previewRows.length} onClick={() => setSampleViewer(0)}>查看全部</button></h3>
        <div className="reference-preview-grid">
          {(previewItems.length ? previewItems : Array.from({ length: 8 }, (_, index) => ({ id: `empty-${index}`, display_name: "等待结果" }))).map((item, index) => (
            <button className={`result-thumb thumb-${index}`} type="button" disabled={!item.thumb_url && !item.image_url && !item.project_image_id} onDoubleClick={() => setSampleViewer(index)} key={item.id || item.display_name || index}>
              <div className="result-thumb-media">
                {item.thumb_url && <AuthenticatedImage src={item.thumb_url} alt={item.display_name || "推理结果"} loading="lazy" />}
                {predictionItems(item.predictions_json).map((prediction, predictionIndex) => {
                  const boxStyle = predictionBoxStyle(prediction, item);
                  if (!boxStyle) return null;
                  const color = predictionColor(prediction.label);
                  return (
                    <i
                      className="prediction-box"
                      key={prediction.id || predictionIndex}
                      style={{ ...boxStyle, borderColor: color, "--box-color": color }}
                    >
                      {prediction.score != null && <small>{(Number(prediction.score) * 100).toFixed(2)}%</small>}
                    </i>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
        <div className="bbox-legend-row">
          {legendItems.map((label, index) => (
            <span key={`${label}-${index}`}><i style={{ background: predictionColor(label) }} />{label}</span>
          ))}
        </div>
      </div>
      <div className="inference-log reference-log">
        <h3>运行日志 <button type="button">清空</button></h3>
        <pre>{executionLog}</pre>
      </div>
    </aside>
    {sampleViewer != null && <InferenceResultViewer rows={previewRows} initialIndex={sampleViewer} onClose={() => setSampleViewer(null)} predictionItems={predictionItems} predictionBoxStyle={predictionBoxStyle} predictionColor={predictionColor} />}
  </div>
);
}
