import React, { useEffect, useMemo, useRef, useState } from "react";

import { createRoot } from "react-dom/client";

import {

ArrowLeft,

ArrowDown,

ArrowUp,

Bell,

Boxes,

Brain,

CheckCircle,

CheckCircle2,

ChevronDown,

ChevronRight,

Copy,

Cpu,

Database,

Download,

Edit3,

Eye,

Folder,

FolderPlus,

FolderOpen,

Grid,

HelpCircle,

Image as ImageIcon,

Import,

List,

MoreVertical,

Move,

Pause,

Play,

RefreshCw,

RotateCcw,

Search,

Settings,

SlidersHorizontal,

Sun,

Tags,

Trash2,

Upload,

Video,

X,

} from "lucide-react";

import "./styles.css";

const colors = ["#31d0aa", "#72a7ff", "#ffcc66", "#ff7c7c", "#b48cff", "#6ee7ff", "#f59bd3", "#a3e635"];

const evaluationClusterLabels = { detect: "目标检测", segment: "实例分割", classify: "图像分类" };

const evaluationTypeLabels = { training: "训练模型", inference: "推理模型" };

const completedEvaluationStatuses = new Set(["done", "completed", "succeeded", "success"]);

function taskLabel(task) {

if (task === "detect") return "目标检测";

if (task === "segment") return "实例分割";

if (task === "classify") return "图像分类";

return task || "未知任务";

}

function formatDateTime(value) {

return value ? new Date(value).toLocaleString() : "--";

}

function formatDuration(start, end) {

if (!start || !end) return "--";

const durationMs = new Date(end).getTime() - new Date(start).getTime();

if (!Number.isFinite(durationMs) || durationMs < 0) return "--";

const totalSeconds = Math.round(durationMs / 1000);

const minutes = Math.floor(totalSeconds / 60);

const seconds = totalSeconds % 60;

return minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;

}

function formatCount(value) {

return Number(value || 0).toLocaleString();

}

function runStatusLabel(status) {

const normalized = String(status || "").toLowerCase();

if (completedEvaluationStatuses.has(normalized)) return "运行完成";

if (["pending", "preparing"].includes(normalized)) return "等待处理";

if (normalized === "running") return "运行中";

if (normalized === "failed") return "运行失败";

if (normalized === "cancelled") return "已取消";

return status || "未知状态态";

}

function sortRuntimeJobsByTime(jobs = []) {
  return [...jobs].sort((left, right) => {
    const leftPriority = Number(left.priority || 0);
    const rightPriority = Number(right.priority || 0);
    if (rightPriority !== leftPriority) return rightPriority - leftPriority;
    const leftTime = Date.parse(left.finished_at || left.started_at || left.created_at || 0) || 0;
    const rightTime = Date.parse(right.finished_at || right.started_at || right.created_at || 0) || 0;
    return rightTime - leftTime;
  });
}

const uiStateStorageKey = "det-dashboard-ui-state-v1";
const restorableViews = new Set(["home", "workspace", "models", "training", "inference", "evaluation"]);

function readUiState() {
  try {
    return JSON.parse(window.localStorage.getItem(uiStateStorageKey) || "{}") || {};
  } catch {
    return {};
  }
}

function updateUiState(patch) {
  try {
    window.localStorage.setItem(uiStateStorageKey, JSON.stringify({ ...readUiState(), ...patch }));
  } catch {
    // State restoration is best-effort when storage is unavailable.
  }
}

function App() {

const restoredUiStateRef = useRef(readUiState());
const restoredUiState = restoredUiStateRef.current;

const [view, setView] = useState(() => restorableViews.has(restoredUiState.view) ? restoredUiState.view : "home");

const [theme, setTheme] = useState(() => restoredUiState.theme === "dark" ? "dark" : "light");

const [currentUser, setCurrentUser] = useState(() => {
  try {
    return JSON.parse(window.localStorage.getItem("det-dashboard-user") || "null");
  } catch {
    return null;
  }
});

const [authMode, setAuthMode] = useState(() => window.localStorage.getItem("det-dashboard-user") ? null : "login");

const signOut = () => {
  window.localStorage.removeItem("det-dashboard-user");
  setCurrentUser(null);
  setAuthMode("login");
};

const [showSettings, setShowSettings] = useState(false);

const [projects, setProjects] = useState([]);

const [currentFolderId, setCurrentFolderId] = useState(() => restoredUiState.currentFolderId || null);

const [trashProjects, setTrashProjects] = useState([]);

const [activeProject, setActiveProject] = useState(null);

const [summary, setSummary] = useState(null);

const [items, setItems] = useState([]);

const [imports, setImports] = useState([]);

const [trashImports, setTrashImports] = useState([]);

const [latestImport, setLatestImport] = useState(null);

const [jobs, setJobs] = useState([]);

const [selected, setSelected] = useState(null);

const [filters, setFilters] = useState({ q: "", scenes: [], views: [], modalities: [], labels: [], importBatchIds: [] });

const [page, setPage] = useState(1);

const pageSize = 48;

const [error, setError] = useState(null);

const [appConfig, setAppConfig] = useState({ dataRoot: "/home/barry/图片", dataRootDisplay: "/home/barry/图片", browseRootDisplay: "/", browseAllDrives: false, hostDialogUrl: "", nativeDialogMode: "server" });

const [showImportDialog, setShowImportDialog] = useState(false);

const [showBaselineDialog, setShowBaselineDialog] = useState(false);

const [baselineName, setBaselineName] = useState("");

const [baselineSources, setBaselineSources] = useState([]);

const [baselineParams, setBaselineParams] = useState({ iouSame: 0.9, iouLight: 0.75 });

const [baselinePreview, setBaselinePreview] = useState(null);

const [baselineConflicts, setBaselineConflicts] = useState([]);

const [selectedConflictIds, setSelectedConflictIds] = useState([]);

const [activeConflictId, setActiveConflictId] = useState(null);

const [baselineBusy, setBaselineBusy] = useState(false);

const [importPath, setImportPath] = useState("");

const [exportFormat, setExportFormat] = useState("labelme");

const [browseBusy, setBrowseBusy] = useState(false);

const [dirPicker, setDirPicker] = useState(null);

const [dirPickerBusy, setDirPickerBusy] = useState(false);

const [editingProjectId, setEditingProjectId] = useState(null);

const [editingProjectName, setEditingProjectName] = useState("");

const [viewerIndex, setViewerIndex] = useState(null);

const [checkedIds, setCheckedIds] = useState([]);

const [lastCheckedId, setLastCheckedId] = useState(null);

const [homeExpandedIds, setHomeExpandedIds] = useState(() => new Set());

const [mlModels, setMlModels] = useState([]);

const [modelVersions, setModelVersions] = useState([]);

const [trainingJobs, setTrainingJobs] = useState([]);

const [inferenceJobs, setInferenceJobs] = useState([]);

const [trainingTemplates, setTrainingTemplates] = useState([]);

const [algorithmAssets, setAlgorithmAssets] = useState([]);

const [pythonEnvs, setPythonEnvs] = useState([]);

const [assetLinks, setAssetLinks] = useState([]);

const [modelForm, setModelForm] = useState({ name: "", taskType: "detect", framework: "ultralytics", description: "" });

const [trainingForm, setTrainingForm] = useState(() => ({
name: "",
datasetProjectId: "",
trainProjectId: "",
trainProjectIds: [],
valProjectId: "",
testProjectId: "",
modelId: "",
initializationMode: "random",
initialModelVersionId: "",
resume: false,
templateId: "",
taskType: "detect",
pythonEnvId: "",
python: "D:\\ProgramData\\miniforge3\\python.exe",
yoloVersion: "v8",
epochs: 100,
imgsz: 640,
batch: 16,
learningRate: 0.0032,
optimizer: "SGD",
savePeriod: 10,
earlyStop: true,
amp: true,
freezeBackbone: false,
device: "0",
algorithmParams: {},
...(restoredUiState.trainingForm || {}),
}));

const [inferenceForm, setInferenceForm] = useState(() => ({

name: "",

datasetProjectId: "",

modelId: "",

modelVersionId: "",

templateId: "",

taskType: "detect",

pythonEnvId: "",

conf: 0.25,

iou: 0.7,

imgsz: 640,

batch: 16,

device: "0",

inputScope: "project",

inputScenes: "",

inputViews: "",

inputModalities: "",

inputImportBatchIds: "",

inputLabels: "",

inputQuery: "",

inputLimit: 0,

cachePolicy: "reuse_asset_cache",

saveJson: true,

saveVisualization: true,

createLabelVersion: false,

fakeReferenceMode: false,

...(restoredUiState.inferenceForm || {}),

}));

const [versionForm, setVersionForm] = useState({ modelId: "", versionName: "", sourcePath: "", stage: "pretrained" });

const [envForm, setEnvForm] = useState({ name: "", sourceType: "conda_pack", pythonPath: "", condaPackPath: "", unpackPath: "" });

const [activeTrainingJobId, setActiveTrainingJobId] = useState(() => restoredUiState.activeTrainingJobId || null);

const [trainingLogs, setTrainingLogs] = useState([]);

const importRefreshKeyRef = useRef("");

const restoredActiveProjectIdRef = useRef(restoredUiState.view === "workspace" ? restoredUiState.activeProjectId || null : null);

const restoredSelectedImageIdRef = useRef(restoredUiState.selectedImageId || null);

const [activeInferenceResult, setActiveInferenceResult] = useState(null);

useEffect(() => {

refreshHome();

fetch("/api/config").then((r) => r.json()).then((d) => setAppConfig(d)).catch(() => {});

}, []);

useEffect(() => {

if (!activeProject) return;

loadWorkspace(activeProject.id);

}, [activeProject, page, filters]);

useEffect(() => {

const timer = window.setInterval(() => {

fetch("/api/jobs").then((r) => r.json()).then((d) => setJobs(d.jobs || [])).catch(() => {});

if (activeProject) {

loadImports(activeProject.id);

loadSummary(activeProject.id);

} else {

setLatestImport(null);

}

}, 1500);

return () => window.clearInterval(timer);

}, [activeProject]);

useEffect(() => {

if (!activeProject) return;

const terminalImport = imports.find((row) => ["done", "failed", "cancelled"].includes(row.status));

const refreshKey = terminalImport ? `${activeProject.id}:${terminalImport.id}:${terminalImport.status}:${terminalImport.finished_at || ""}` : "";

if (!refreshKey || importRefreshKeyRef.current === refreshKey) return;

importRefreshKeyRef.current = refreshKey;

loadWorkspace(activeProject.id);

}, [activeProject, imports]);

useEffect(() => {

if (!["training", "inference", "models", "evaluation"].includes(view)) return;

loadMlPlatform();

const timer = window.setInterval(() => loadMlPlatform(), 2500);

return () => window.clearInterval(timer);

}, [view]);

useEffect(() => {
  const persistedActiveProjectId = activeProject?.id || (view === "workspace" ? restoredActiveProjectIdRef.current : null);
  const persistedSelectedImageId = selected?.id || (view === "workspace" ? restoredSelectedImageIdRef.current : null);
  updateUiState({
    view,
    theme,
    currentFolderId,
    activeProjectId: persistedActiveProjectId,
    selectedImageId: persistedSelectedImageId,
    activeTrainingJobId,
    trainingForm: {
      datasetProjectId: trainingForm.datasetProjectId,
      trainProjectId: trainingForm.trainProjectId,
      trainProjectIds: trainingForm.trainProjectIds,
      valProjectId: trainingForm.valProjectId,
      testProjectId: trainingForm.testProjectId,
      modelId: trainingForm.modelId,
      initializationMode: trainingForm.initializationMode,
      initialModelVersionId: trainingForm.initialModelVersionId,
      resume: trainingForm.resume,
      templateId: trainingForm.templateId,
      taskType: trainingForm.taskType,
      pythonEnvId: trainingForm.pythonEnvId,
      yoloVersion: trainingForm.yoloVersion,
      epochs: trainingForm.epochs,
      imgsz: trainingForm.imgsz,
      batch: trainingForm.batch,
      learningRate: trainingForm.learningRate,
      optimizer: trainingForm.optimizer,
      savePeriod: trainingForm.savePeriod,
      earlyStop: trainingForm.earlyStop,
      amp: trainingForm.amp,
      freezeBackbone: trainingForm.freezeBackbone,
      device: trainingForm.device,
      algorithmParams: trainingForm.algorithmParams,
    },
    inferenceForm: {
      datasetProjectId: inferenceForm.datasetProjectId,
      modelId: inferenceForm.modelId,
      modelVersionId: inferenceForm.modelVersionId,
      templateId: inferenceForm.templateId,
      taskType: inferenceForm.taskType,
      pythonEnvId: inferenceForm.pythonEnvId,
    },
  });
}, [view, theme, currentFolderId, activeProject, selected, activeTrainingJobId, trainingForm, inferenceForm]);

useEffect(() => {

if (!activeTrainingJobId || String(activeTrainingJobId).startsWith("mock-")) {

setTrainingLogs([]);

return;

}

fetch(`/api/ml/training-jobs/${activeTrainingJobId}/logs`)

.then((r) => r.json())

.then((d) => setTrainingLogs(d.logs || []))

.catch(() => {});

}, [activeTrainingJobId, trainingJobs]);

const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

const projectLastImportAt = useMemo(() => {

const childrenByParent = new Map();

for (const project of projects) {

const key = project.parent_id || "root";

if (!childrenByParent.has(key)) childrenByParent.set(key, []);

childrenByParent.get(key).push(project);

}

const memo = new Map();

const newest = (project) => {

if (!project) return "";

if (memo.has(project.id)) return memo.get(project.id);

let best = project.last_import_at || "";

for (const child of childrenByParent.get(project.id) || []) {

const childTime = newest(child);

if (childTime && (!best || new Date(childTime).getTime() > new Date(best).getTime())) best = childTime;

}

memo.set(project.id, best);

return best;

};

for (const project of projects) newest(project);

return memo;

}, [projects]);

const currentFolder = currentFolderId ? projectById.get(currentFolderId) : null;

const visibleProjects = useMemo(

() => projects.filter((project) => (project.parent_id || null) === (currentFolderId || null)),

[projects, currentFolderId],

);

const breadcrumbs = useMemo(() => {

const rows = [];

let cursor = currentFolder;

const seen = new Set();

while (cursor && !seen.has(cursor.id) && rows.length < 3) {

rows.unshift(cursor);

seen.add(cursor.id);

cursor = cursor.parent_id ? projectById.get(cursor.parent_id) : null;

}

return rows;

}, [currentFolder, projectById]);

const activeChildProjects = useMemo(

() => activeProject ? projects.filter((project) => (project.parent_id || null) === activeProject.id) : [],

[projects, activeProject],

);

const activeBreadcrumbs = useMemo(() => {

const rows = [];

let cursor = activeProject;

const seen = new Set();

while (cursor && !seen.has(cursor.id) && rows.length < 4) {

rows.unshift(cursor);

seen.add(cursor.id);

cursor = cursor.parent_id ? projectById.get(cursor.parent_id) : null;

}

return rows;

}, [activeProject, projectById]);

const workspaceRoot = activeBreadcrumbs[0] || activeProject;

const parsedImportPaths = useMemo(() => splitImportPaths(importPath), [importPath]);

const hasCurrentImages = Boolean((summary?.direct_image_count || 0) > 0 || items.length);

const homeStats = useMemo(() => ({

title: currentFolder?.name || "全部项目",

projects: currentFolder ? 1 : projects.filter((project) => !project.parent_id).length,

folders: currentFolder ? Number(currentFolder.child_count || 0) : projects.length,

images: currentFolder

? Number(currentFolder.image_count || 0)

: projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.image_count || 0), 0),

videos: currentFolder

? Number(currentFolder.video_count || 0)

: projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.video_count || 0), 0),

annotations: currentFolder

? Number(currentFolder.annotation_count || 0)

: projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.annotation_count || 0), 0),

trash: trashProjects.length,

}), [currentFolder, projects, trashProjects]);

function refreshHome() {

fetch("/api/projects").then((r) => r.json()).then((d) => {

const rows = d.projects || [];

setProjects(rows);

setActiveProject((current) => {
  const projectId = current?.id || restoredActiveProjectIdRef.current;
  restoredActiveProjectIdRef.current = null;
  return projectId ? rows.find((project) => project.id === projectId) || null : null;
});

setCurrentFolderId((current) => current && rows.some((project) => project.id === current) ? current : null);

}).catch(() => {});

fetch("/api/projects/trash").then((r) => r.json()).then((d) => setTrashProjects(d.projects || [])).catch(() => {});

}

function loadMlPlatform() {

fetch("/api/ml/models").then((r) => r.json()).then((d) => setMlModels(d.models || [])).catch(() => {});

fetch("/api/ml/model-versions").then((r) => r.json()).then((d) => setModelVersions(d.versions || [])).catch(() => {});

fetch("/api/ml/training-jobs").then((r) => r.json()).then((d) => setTrainingJobs(d.jobs || [])).catch(() => {});

fetch("/api/ml/inference-jobs").then((r) => r.json()).then((d) => setInferenceJobs(sortRuntimeJobsByTime(d.jobs || []))).catch(() => {});

fetch("/api/ml/algorithm-assets").then((r) => r.json()).then((d) => {

const algorithms = d.algorithms || [];

setAlgorithmAssets(algorithms);

setTrainingTemplates(algorithms.map((item) => ({

...item,

template_key: item.algorithm_key,

capabilities_json: item.capabilities_json || { tasks: [item.task_type || "detect"] },

})));

}).catch(() => {

fetch("/api/ml/training-templates").then((r) => r.json()).then((d) => setTrainingTemplates(d.templates || [])).catch(() => {});

});

fetch("/api/ml/python-envs").then((r) => r.json()).then((d) => setPythonEnvs(d.envs || [])).catch(() => {});

fetch("/api/ml/asset-links").then((r) => r.json()).then((d) => setAssetLinks(d.links || [])).catch(() => setAssetLinks([]));

refreshHome();

}

function openPlatform(nextView) {

setView(nextView);

setError(null);

loadMlPlatform();

}

function openDatasetView() {

setError(null);

setActiveProject(null);

setCurrentFolderId(null);

setView("home");

refreshHome();

}

function createModel() {

fetch("/api/ml/models", {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify(modelForm),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "创建模型簇失");

setModelForm({ name: "", taskType: "detect", framework: "ultralytics", description: "" });

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function submitTrainingJob() {

fetch("/api/ml/training-jobs", {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({

name: trainingForm.name,

datasetProjectId: trainingForm.trainProjectId || trainingForm.datasetProjectId,

datasetSplits: {
trainProjectId: trainingForm.trainProjectId || trainingForm.datasetProjectId || null,
trainProjectIds: trainingForm.trainProjectIds?.length ? trainingForm.trainProjectIds : (trainingForm.trainProjectId ? [trainingForm.trainProjectId] : []),
valProjectId: trainingForm.valProjectId || null,
testProjectId: trainingForm.testProjectId || null,
},

modelId: trainingForm.modelId || null,

templateId: trainingForm.templateId || null,

initializationStrategy: trainingForm.initializationMode,

resume: Boolean(trainingForm.resume),

savePeriod: Number(trainingForm.savePeriod),

taskType: trainingForm.taskType,

pythonEnvId: trainingForm.pythonEnvId || null,

initialModelVersionId: ["pretrained", "training"].includes(trainingForm.initializationMode) ? (trainingForm.initialModelVersionId || null) : null,

params: {
...(trainingForm.algorithmParams || {}),
python: trainingForm.python,
initializationMode: trainingForm.initializationMode,
initializationStrategy: trainingForm.initializationMode,
resume: Boolean(trainingForm.resume),
yoloVersion: trainingForm.yoloVersion,
yolo_version: trainingForm.yoloVersion === "v11" ? "yolo11" : `yolov${String(trainingForm.yoloVersion || "v8").replace(/^v/i, "")}`,
epochs: Number(trainingForm.epochs),
imgsz: Number(trainingForm.imgsz),
batch: Number(trainingForm.batch),
learningRate: Number(trainingForm.learningRate),
lr0: Number(trainingForm.learningRate),
optimizer: trainingForm.optimizer,
savePeriod: Number(trainingForm.savePeriod),
save_period: Number(trainingForm.savePeriod),
datasetSplits: {
trainProjectId: trainingForm.trainProjectId || trainingForm.datasetProjectId || null,
trainProjectIds: trainingForm.trainProjectIds?.length ? trainingForm.trainProjectIds : (trainingForm.trainProjectId ? [trainingForm.trainProjectId] : []),
valProjectId: trainingForm.valProjectId || null,
testProjectId: trainingForm.testProjectId || null,
},
earlyStop: Boolean(trainingForm.earlyStop),
amp: Boolean(trainingForm.amp),
freezeBackbone: Boolean(trainingForm.freezeBackbone),
device: trainingForm.device,
},

}),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "提交训练失败");

setTrainingForm({ ...trainingForm, name: "" });

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function requeueTrainingJob(jobId) {

fetch(`/api/ml/training-jobs/${jobId}/requeue`, {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ params: { python: trainingForm.python, initialModelVersionId: trainingForm.initialModelVersionId || undefined } }),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "重新入队失败");

setActiveTrainingJobId(jobId);

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function updateTrainingJobState(jobId, action) {

fetch(`/api/ml/training-jobs/${jobId}/${action}`, {

method: "POST",

headers: { "content-type": "application/json" },

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "训练任务状态更新失败");

setActiveTrainingJobId(jobId);

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function deleteTrainingJob(jobId) {

if (!window.confirm("确定删除该训练任务吗？正在运行的任务会先停止。")) return;

fetch(`/api/ml/training-jobs/${jobId}`, { method: "DELETE" })

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "删除训练任务失败");

if (activeTrainingJobId === jobId) setActiveTrainingJobId(null);

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function createModelVersion() {

fetch("/api/ml/model-versions", {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify(versionForm),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "登记模型版本失败");

setVersionForm({ modelId: versionForm.modelId, versionName: "", sourcePath: "", stage: "pretrained" });

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function createPythonEnv() {

const payload = envForm.sourceType === "server_managed" || envForm.sourceType === "server_python" ? { ...envForm, sourceType: "server_managed", preferCondaPack: false } : envForm;

fetch("/api/ml/python-envs", {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify(payload),

}).then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "登记环境失败");

setEnvForm({ name: "", sourceType: "conda_pack", pythonPath: "", condaPackPath: "", unpackPath: "" });

loadMlPlatform();

}).catch((err) => setError(err.message));

}

function renameModelVersion(version) {

const next = window.prompt("请输入新的模型版本名", version.version_name);

if (!next || next === version.version_name) return;

fetch(`/api/ml/model-versions/${version.id}`, {

method: "PATCH",

headers: { "content-type": "application/json" },

body: JSON.stringify({ versionName: next }),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "重命名失");

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function submitInferenceJob() {

const fakeAlgorithm = algorithmAssets.find((item) => item.algorithm_key === "fake_reference_detector" || item.template_key === "fake_reference_detector");

const selectedAlgorithm = inferenceForm.fakeReferenceMode ? fakeAlgorithm : algorithmAssets.find((item) => item.id === inferenceForm.templateId);

if (!inferenceForm.datasetProjectId) {

setError("请选择数据集项目");

return;

}

if (!selectedAlgorithm) {

setError("请选择算法名称");

return;

}

const algorithmKey = selectedAlgorithm.algorithm_key || selectedAlgorithm.template_key || "";

const isBuiltInNoEnvAlgorithm = algorithmKey === "dummy_empty_detector" || algorithmKey === "fake_reference_detector";

if (!isBuiltInNoEnvAlgorithm) {

if (!inferenceForm.pythonEnvId) {

setError("真实算法推理需要先选择运行环境资产");

return;

}

if (!inferenceForm.modelVersionId) {

setError("真实算法推理需要先选择模型权重版本");

return;

}

}

fetch("/api/ml/inference-jobs", {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({

name: inferenceForm.name,

datasetProjectId: inferenceForm.datasetProjectId,

modelVersionId: inferenceForm.fakeReferenceMode ? null : (inferenceForm.modelVersionId || null),

params: {

modelId: null,

algorithmAssetId: selectedAlgorithm.id || inferenceForm.templateId || null,

templateId: selectedAlgorithm.id || inferenceForm.templateId || null,

fakeReferenceMode: Boolean(inferenceForm.fakeReferenceMode),

taskType: inferenceForm.taskType,

pythonEnvId: inferenceForm.pythonEnvId || null,

conf: Number(inferenceForm.conf),

iou: Number(inferenceForm.iou),

imgsz: Number(inferenceForm.imgsz),

batch: Number(inferenceForm.batch),

device: inferenceForm.device,

input: {

sourceType: "project_images",

scope: inferenceForm.inputScope,

filters: inferenceForm.inputScope === "project" ? {} : {

scenes: inferenceForm.inputScenes.split(",").map((item) => item.trim()).filter(Boolean),

views: inferenceForm.inputViews.split(",").map((item) => item.trim()).filter(Boolean),

modalities: inferenceForm.inputModalities.split(",").map((item) => item.trim()).filter(Boolean),

importBatchIds: inferenceForm.inputImportBatchIds.split(",").map((item) => item.trim()).filter(Boolean),

labels: inferenceForm.inputLabels.split(",").map((item) => item.trim()).filter(Boolean),

q: inferenceForm.inputQuery,

},

limit: 0,

cachePolicy: "reuse_asset_cache",

},

output: {

saveJson: Boolean(inferenceForm.saveJson),

saveVisualization: Boolean(inferenceForm.saveVisualization),

createLabelVersion: Boolean(inferenceForm.createLabelVersion),

},

},

}),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "提交推理失败");

setInferenceForm({ ...inferenceForm, name: "" });

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function deleteInferenceJob(jobId) {

if (!window.confirm("确认删除这个推理任务")) return;

fetch(`/api/ml/inference-jobs/${jobId}`, { method: "DELETE" })

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "删除推理任务失败");

loadMlPlatform();

})

.catch((err) => setError(err.message));

}

function requeueInferenceJob(jobId) {
  fetch(`/api/ml/inference-jobs/${jobId}/requeue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  })
    .then((r) => Promise.all([r.status, r.json().catch(() => ({}))]))
    .then(([status, data]) => {
      if (status >= 400) throw new Error(data.error || "重新开始推理任务失败");
      loadMlPlatform();
    })
    .catch((err) => setError(err.message || "重新开始推理任务失败"));
}

function deleteInferenceJobs(jobIds) {

const ids = Array.from(new Set((jobIds || []).filter(Boolean)));

if (!ids.length) {

setError("请选择要删除的推理任务");

return Promise.resolve(false);

}

if (!window.confirm(`确认删除 ${ids.length} 个推理任务？`)) return Promise.resolve(false);

return Promise.all(ids.map((jobId) => fetch(`/api/ml/inference-jobs/${jobId}`, { method: "DELETE" })

.then((r) => Promise.all([r.status, r.json().catch(() => ({}))]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "删除推理任务失败");

return data;

})))

.then(() => {

loadMlPlatform();

return true;

})

.catch((err) => {

setError(err.message);

return false;

});

}
function moveRuntimeQueueJob(kind, jobId, direction) {

const path = kind === "training" ? "training-jobs" : "inference-jobs";

fetch(`/api/ml/${path}/${jobId}/priority`, {

method: "PATCH",

headers: { "content-type": "application/json" },

body: JSON.stringify({ direction }),

})

.then((r) => Promise.all([r.status, r.json().catch(() => ({}))]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "调整队列优先级失");

loadMlPlatform();

})

.catch((err) => setError(err.message || "调整队列优先级失"));

}
function viewInferenceResults(job) {

setError(null);

setActiveInferenceResult({ job, results: [], loading: true });

fetch(`/api/ml/inference-jobs/${job.id}/results`)

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "读取推理结果失败");

setActiveInferenceResult({ job, results: data.results || [], loading: false });

})

.catch((err) => {

setActiveInferenceResult(null);

setError(err.message);

});

}

function loadWorkspace(projectId) {

const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), q: filters.q || "" });

for (const key of ["scenes", "views", "modalities", "labels", "importBatchIds"]) {

if (filters[key]?.length) params.set(key, filters[key].join(","));

}

fetch(`/api/projects/${projectId}/images?${params}`).then((r) => r.json()).then((d) => {

setItems(d.items || []);

const restoredSelected = restoredSelectedImageIdRef.current
  ? d.items?.find((item) => item.id === restoredSelectedImageIdRef.current)
  : null;

if (restoredSelected) {
  setSelected(restoredSelected);
  restoredSelectedImageIdRef.current = null;
  return;
}

if (!selected && d.items?.[0]) setSelected(d.items[0]);

if (selected && !d.items?.some((item) => item.id === selected.id)) setSelected(d.items?.[0] || null);

setCheckedIds((ids) => ids.filter((id) => d.items?.some((item) => item.id === id)));

}).catch(() => {});

loadSummary(projectId);

loadImports(projectId);

}

function loadSummary(projectId) {

fetch(`/api/projects/${projectId}/summary`).then((r) => r.json()).then((d) => setSummary(d.summary || null)).catch(() => {});

}

function loadImports(projectId) {

fetch(`/api/projects/${projectId}/imports`).then((r) => r.json()).then((d) => {

const rows = d.imports || [];

setImports(rows);

const running = rows.find((row) => ["scanning", "running", "cancel_requested"].includes(row.status));

setLatestImport(running || null);

}).catch(() => {});

fetch(`/api/projects/${projectId}/imports?trash=1`).then((r) => r.json()).then((d) => setTrashImports(d.imports || [])).catch(() => {});

}

function createProject() {

const isWorkspace = view === "workspace" && activeProject;

const depth = isWorkspace ? activeBreadcrumbs.length : breadcrumbs.length;

if (depth >= 3) {

setError("项目本身计为第 1 级，最多只能创建到第 3 级文件夹");

return;

}

const name = window.prompt(isWorkspace ? "请输入新建文件夹名称" : "请输入项目名称或路径（最多 3 级，例如：任务A/批次1/样本集）", isWorkspace ? "新建文件" : "新建项目");

if (!name) return;

if (/[\\/]/.test(name)) {

setError("请一次只创建一个项目或文件夹，名称不能包含路径分隔");

return;

}

fetch("/api/projects", {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ name, parentId: isWorkspace ? activeProject.id : currentFolderId }),

})

.then((r) => r.json().then((data) => {

if (!r.ok) throw new Error(data.error || "新建项目失败");

return data;

}))

.then((data) => {

if (!isWorkspace && data.project?.parent_id) setCurrentFolderId(data.project.parent_id);

refreshHome();

})

.catch((err) => setError(err.message));

}

function openBaselineDialog() {

setBaselineName(`baseline_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);

setBaselineSources([]);

setBaselinePreview(null);

setBaselineConflicts([]);

setSelectedConflictIds([]);

setActiveConflictId(null);

setError(null);

setShowBaselineDialog(true);

}

function toggleBaselineSource(projectId) {

setBaselineSources((ids) => ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId]);

}

function previewBaseline() {

if (!baselineSources.length) {

setError("请选择至少一个来源项");

return;

}

setBaselineBusy(true);

setError(null);

fetch("/api/baselines/preview", {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ name: baselineName, sourceProjectIds: baselineSources, sourcePriority: baselineSources, ...baselineParams }),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "基准预分析失");

setBaselinePreview(data);

setSelectedConflictIds([]);

setActiveConflictId(null);

if (data.summary?.conflicts) loadBaselineConflicts(data.runId);

})

.catch((err) => setError(err.message))

.finally(() => setBaselineBusy(false));

}

function loadBaselineConflicts(runId = baselinePreview?.runId) {

if (!runId) return;

fetch(`/api/baselines/${runId}/conflicts`)

.then((r) => r.json())

.then((d) => {

const rows = d.conflicts || [];

setBaselineConflicts(rows);

setActiveConflictId((id) => id || rows[0]?.id || null);

})

.catch((err) => setError("读取冲突列表失败: " + err.message));

}

function toggleConflict(id) {

setSelectedConflictIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

setActiveConflictId(id);

}

function resolveSelectedConflicts(resolution) {

const ids = selectedConflictIds.length ? selectedConflictIds : activeConflictId ? [activeConflictId] : [];

if (!ids.length || !baselinePreview?.runId) return;

fetch(`/api/baselines/${baselinePreview.runId}/conflicts`, {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ conflictIds: ids, resolution }),

})

.then((r) => r.json())

.then(() => loadBaselineConflicts())

.catch((err) => setError("保存冲突决策失败: " + err.message));

}

function applyBaseline() {

if (!baselinePreview?.runId) return;

if (!window.confirm("确定按当前预分析结果生成基准数据集项目吗")) return;

setBaselineBusy(true);

fetch(`/api/baselines/${baselinePreview.runId}/apply`, {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ name: baselineName }),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, data]) => {

if (status >= 400) throw new Error(data.error || "应用基准失败");

setShowBaselineDialog(false);

setBaselinePreview(null);

refreshHome();

window.alert(`基准项目已生成：${data.project?.name || baselineName}，图像：${data.imageCount}，标注：${data.annotationCount}`);

})

.catch((err) => setError(err.message))

.finally(() => setBaselineBusy(false));

}

function deleteProject(projectId) {

if (!window.confirm("确定删除该项目或文件夹吗？其下级文件夹会一并进入回收站；可在回收站恢复，清空回收站后将永久删除")) return;

fetch(`/api/projects/${projectId}`, { method: "DELETE" }).then(() => refreshHome());

}

function startRenameProject(project) {

setEditingProjectId(project.id);

setEditingProjectName(project.name || "");

}

function cancelRenameProject() {

setEditingProjectId(null);

setEditingProjectName("");

}

function commitRenameProject(project) {

const name = editingProjectName.trim();

if (!project || editingProjectId !== project.id) return;

if (!name || name === project.name) {

cancelRenameProject();

return;

}

fetch(`/api/projects/${project.id}`, {

method: "PATCH",

headers: { "content-type": "application/json" },

body: JSON.stringify({ name }),

})

.then((r) => r.json().then((data) => {

if (!r.ok) throw new Error(data.error || "重命名失");

return data;

}))

.then((data) => {

cancelRenameProject();

refreshHome();

if (activeProject?.id === project.id && data.project) setActiveProject(data.project);

})

.catch((err) => {

setError(err.message);

cancelRenameProject();

});

}

function restoreProject(projectId) {

fetch(`/api/projects/${projectId}/restore`, { method: "POST" }).then(() => refreshHome());

}

function restoreAllProjects() {

if (!trashProjects.length) return;

if (!window.confirm(`确定恢复回收站中的 ${trashProjects.length} 个项目吗？`)) return;

Promise.all(trashProjects.map((project) => fetch(`/api/projects/${project.id}/restore`, { method: "POST" })))

.then(() => refreshHome())

.catch((err) => setError("恢复全部项目失败：" + err.message));

}


function deleteProjectPermanently(projectId) {

if (!window.confirm("确定永久删除该项目及其子文件夹吗？该操作不可恢复")) return;

fetch(`/api/projects/${projectId}/permanent`, { method: "DELETE" })

.then((response) => response.json().catch(() => ({})).then((data) => {

if (!response.ok) throw new Error(data.error || "永久删除项目失败");

refreshHome();

}))

.catch((err) => setError(err.message || "永久删除项目失败"));

}
function emptyProjectTrash() {

if (!trashProjects.length) return;

if (!window.confirm(`确定清空项目回收站吗？将永久删除 ${trashProjects.length} 个项目及其不再被引用的数据。`)) return;

fetch("/api/projects/trash/empty", { method: "DELETE" })

.then(() => refreshHome())

.catch((err) => setError("清空项目回收站失败：" + err.message));

}

function openProject(project) {

setActiveProject(project);

setCurrentFolderId(project.id);

setView("workspace");

setPage(1);

setSelected(null);

setItems([]);

setSummary(null);

setCheckedIds([]);

setError(null);

}

function goUpFolder() {

if (!activeProject?.parent_id) {

goHome();

return;

}

const parent = projectById.get(activeProject.parent_id);

if (parent) openProject(parent);

else goHome();

}

function importData() {

if (!activeProject) return;

setImportPath("");

setError(null);

setShowImportDialog(true);

}

function importDataFromHome() {

if (currentFolder) {

setImportPath("");

setError(null);

openProject(currentFolder);

setShowImportDialog(true);

return;

}

setError("请先打开一个具体项目后再导入数据集");

}

function splitImportPaths(value) {

return Array.from(new Set(String(value || "").split(";").map((item) => item.trim()).filter(Boolean)));

}

function appendImportPath(pathValue) {

if (!pathValue) return;

setImportPath((current) => {

const paths = splitImportPaths(current);

if (!paths.includes(pathValue)) paths.push(pathValue);

return paths.join("; ");

});

}

async function browseFolder() {

setError(null);

const selectedPaths = splitImportPaths(importPath);

const initialPath = selectedPaths[selectedPaths.length - 1] || (appConfig.browseAllDrives ? "__drives__" : appConfig.browseRootDisplay || "/");

if (appConfig.nativeDialogMode === "disabled") {

openDataRootPicker(initialPath);

return;

}

setBrowseBusy(true);

const controller = new AbortController();

const timer = window.setTimeout(() => controller.abort(), 120000);

const dialogBase = String(appConfig.hostDialogUrl || "").replace(/\/$/, "");

const dialogQuery = `path=${encodeURIComponent(initialPath)}&title=${encodeURIComponent("选择要导入的数据文件夹")}`;

const dialogUrl = dialogBase ? `${dialogBase}/api/dialog/folder?${dialogQuery}` : `/api/dialog/folder?purpose=import&${dialogQuery}`;

try {

const response = await fetch(dialogUrl, { signal: controller.signal, cache: "no-store" });

const result = await response.json();

if (!response.ok) throw new Error(result.error || "系统文件夹选择器不可用");

if (result.status === "selected" && result.selectedPath) {

appendImportPath(result.selectedPath);

} else if (result.status !== "cancelled") {

throw new Error(result.error || "系统文件夹选择器不可用");

}

} catch (err) {

const reason = err.name === "AbortError" ? "打开超时" : err.message;

openDataRootPicker(initialPath);

setError(`系统文件夹选择器失败，已切换到网页选择器：${reason}`);

} finally {

window.clearTimeout(timer);

setBrowseBusy(false);

}

}

function openDataRootPicker(pathValue) {

setError(null);

setDirPickerBusy(true);

fetch(`/api/fs/dirs?path=${encodeURIComponent(pathValue || (appConfig.browseAllDrives ? "__drives__" : appConfig.browseRootDisplay || appConfig.dataRootDisplay || appConfig.dataRoot))}`)

.then((r) => r.json().then((d) => {

if (!r.ok) throw new Error(d.error || "读取目录失败");

setDirPicker(d);

}))

.catch((err) => setError(`读取数据根目录失败：${err.message}`))

.finally(() => setDirPickerBusy(false));

}

function chooseDir(pathValue) {

appendImportPath(pathValue);

setDirPicker(null);

setError(null);

}

function openHomeFolder(project) {

const hasChildren = Number(project?.child_count || 0) > 0;

const hasAssets = Number(project?.image_count || 0) > 0 || Number(project?.video_count || 0) > 0;

if (!hasChildren && hasAssets) {

openProject(project);

return;

}

setCurrentFolderId(project.id);

}

function confirmImport() {

const paths = splitImportPaths(importPath);

if (!paths.length) {

setError("请输入或选择数据文件夹路");

return;

}

setError(null);

setShowImportDialog(false);

setLatestImport({ status: "running", message: "正在提交导入任务...", progress: 1, processed_files: 0, total_files: 1 });

fetch("/api/imports", {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ projectId: activeProject.id, sourcePath: paths[0], sourcePaths: paths, rename: true }),

})

.then((r) => Promise.all([r.status, r.json()]))

.then(([status, d]) => {

if (status >= 400) throw new Error(d.error || "导入失败，请检查路径是否正");

setLatestImport(d.batch || null);

loadWorkspace(activeProject.id);

})

.catch((err) => {

setError(err.message);

setLatestImport(null);

});

}

function cancelLatestImport() {

if (!latestImport?.id) return;

if (!window.confirm("确定取消当前导入任务吗？已经导入的文件会保留在本次导入记录中，可稍后删除本次导入")) return;

fetch(`/api/imports/${latestImport.id}/cancel`, { method: "POST" })

.then((r) => r.json())

.then(() => setLatestImport({ ...latestImport, status: "cancel_requested", message: "正在取消导入" }))

.catch((err) => setError("取消导入失败: " + err.message));

}

function deleteImport(importId) {

if (!window.confirm("删除本次导入后会进入导入回收站，是否继续")) return;

fetch(`/api/imports/${importId}`, { method: "DELETE" }).then(() => activeProject && loadWorkspace(activeProject.id));

}

function restoreImport(importId) {

fetch(`/api/imports/${importId}/restore`, { method: "POST" }).then(() => activeProject && loadWorkspace(activeProject.id));

}

function emptyImportTrash() {

if (!activeProject || !trashImports.length) return;

if (!window.confirm(`确定清空导入回收站吗？将永久删除 ${trashImports.length} 条导入记录及其不再被引用的数据。`)) return;

fetch(`/api/projects/${activeProject.id}/imports/trash/empty`, { method: "DELETE" })

.then(() => loadWorkspace(activeProject.id))

.catch((err) => setError("清空导入回收站失败：" + err.message));

}

function exportProject() {

if (!activeProject) return;

setError(null);

fetch(`/api/projects/${activeProject.id}/export`, {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ format: exportFormat }),

})

.then((r) => r.json().then((data) => {

if (!r.ok) throw new Error(data.error || "导出失败");

return data;

}))

.catch((err) => setError("导出失败: " + err.message));

}

function openWorkspaceTrash() {

const records = document.querySelector(".records-panel");

if (records) {

records.scrollIntoView({ behavior: "smooth", block: "start" });

return;

}

setError("当前目录暂无导入回收站；项目回收站可在首页管理");

}

function deleteCheckedImages() {

if (!activeProject || !checkedIds.length) return;

if (!window.confirm(`确定删除选中的 ${checkedIds.length} 张图片吗？删除后不会物理删除对象存储中的原图，只会从当前项目预览中移除。`)) return;

fetch(`/api/projects/${activeProject.id}/images/delete`, {

method: "POST",

headers: { "content-type": "application/json" },

body: JSON.stringify({ ids: checkedIds }),

})

.then((r) => r.json())

.then((d) => {

setCheckedIds([]);

setError(`已删除 ${d.deleted || 0} 张图片`);

loadWorkspace(activeProject.id);

})

.catch((err) => setError("删除图片失败: " + err.message));

}

const goHome = () => {

setView("home");

setActiveProject(null);

setCurrentFolderId(null);

setError(null);

refreshHome();

};

if (view === "home") {

return (

<div className={`app-shell ${theme}`}>

<MainNav view={view} goHome={openDatasetView} openPlatform={openPlatform} theme={theme} setTheme={setTheme} user={currentUser} onLogin={() => setAuthMode("login")} onLogout={signOut} onSettings={() => setShowSettings(true)} />

<main className="home-workspace">

<HomeSidebar

projects={projects}

currentFolder={currentFolder}

currentFolderId={currentFolderId}

setCurrentFolderId={setCurrentFolderId}

expandedIds={homeExpandedIds}

setExpandedIds={setHomeExpandedIds}

openProject={openProject}

openHomeFolder={openHomeFolder}

createProject={createProject}

stats={homeStats}

/>

<section className="home-browser">

<div className="home-toolbar">

<div className="workspace-path-row">

<FolderOpen size={16} />

<button onClick={() => setCurrentFolderId(null)}>项目</button>

{!breadcrumbs.length && (

<>

<ChevronRight size={14} />

<button onClick={() => setCurrentFolderId(null)}>全部项目</button>

</>

)}

{breadcrumbs.map((project) => (

<React.Fragment key={project.id}>

<ChevronRight size={14} />

<button onClick={() => setCurrentFolderId(project.id)}>{project.name}</button>

</React.Fragment>

))}

</div>

<div className="workspace-commandbar home-commandbar">

{currentFolder && <button onClick={() => setCurrentFolderId(currentFolder.parent_id || null)}><ArrowLeft size={16} />返回</button>}

<button onClick={createProject}><FolderPlus size={16} />新建项目</button>

<button onClick={createProject}><FolderPlus size={16} />新建文件</button>

<button onClick={importDataFromHome}><Import size={16} />导入数据</button>

<button onClick={() => setError("请先进入具体项目后再导出数据集")}><Upload size={16} />导出数据</button>

<button onClick={() => document.querySelector(".home-trash-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}><Trash2 size={16} />回收</button>

</div>

</div>

{error && <div className="error-msg home-error-msg">{error}</div>}

<div className="home-filterbar">

<label className="search-control"><Search size={15} /><input readOnly placeholder="搜索项目名称" /></label>

<select><option>视角：全</option></select>

<select><option>场景：全</option></select>

<select><option>标签：全</option></select>

<button className="more-filter-button">更多筛选<SlidersHorizontal size={14} /></button>

<div className="view-switch">

<button className="active" title="网格视图"><Grid size={16} /></button>

<button title="列表视图"><List size={16} /></button>

</div>

<span>{visibleProjects.length} 个文件夹</span>

</div>

<div className="project-grid home-project-grid">

{visibleProjects.map((project) => (

<article

className="project-folder"

key={project.id}

tabIndex={0}

aria-label={`文件夹 ${project.name}，单击打开`}

onClick={() => openHomeFolder(project)}

onDoubleClick={() => openProject(project)}

onKeyDown={(event) => { if (event.key === "Enter") openProject(project); }}

>

<div className="project-folder-icon project-stat-icon" aria-hidden="true"><FolderOpen size={25} /><ImageIcon className="project-folder-badge" size={12} /></div>

<div className="project-folder-body">

<EditableProjectName

project={project}

editingProjectId={editingProjectId}

editingProjectName={editingProjectName}

setEditingProjectName={setEditingProjectName}

startRenameProject={startRenameProject}

commitRenameProject={commitRenameProject}

cancelRenameProject={cancelRenameProject}

/>

<p className="project-folder-metrics">

<span><ImageIcon size={13} />{formatCount(project.image_count || 0)}</span>

<span><Video size={13} />{formatCount(project.video_count || 0)}</span>

<span><Folder size={13} />{formatCount(project.child_count || 0)}</span>

</p>

<span>最后导入： {projectLastImportAt.get(project.id) ? new Date(projectLastImportAt.get(project.id)).toLocaleString() : "暂无导入"}</span>

</div>

<div className="project-actions">

<button title="重命名" onClick={(event) => { event.stopPropagation(); startRenameProject(project); }}><Edit3 size={16} /></button>

<button title="删除项目" aria-label={`删除 ${project.name}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>

</div>

</article>

))}

{!visibleProjects.length && <div className="empty-state folder-empty">空文件夹</div>}

</div>

</section>

<HomeInspector

stats={homeStats}

trashProjects={trashProjects}

restoreProject={restoreProject}

restoreAllProjects={restoreAllProjects}

emptyProjectTrash={emptyProjectTrash}

deleteProjectPermanently={deleteProjectPermanently}

/>

</main>

{authMode && <AuthDialog mode={authMode} setMode={setAuthMode} required={!currentUser} onClose={() => setAuthMode(null)} onSignedIn={setCurrentUser} />}

{showSettings && <SettingsDialog config={appConfig} onClose={() => setShowSettings(false)} />}

</div>

);

}

if (view === "training" || view === "inference" || view === "models" || view === "evaluation") {

return (

<PlatformPage

view={view}

setView={setView}

projects={projects}

mlModels={mlModels}

modelVersions={modelVersions}

trainingJobs={trainingJobs}

inferenceJobs={inferenceJobs}

trainingTemplates={trainingTemplates}

algorithmAssets={algorithmAssets}

pythonEnvs={pythonEnvs}

assetLinks={assetLinks}

activeTrainingJobId={activeTrainingJobId}

setActiveTrainingJobId={setActiveTrainingJobId}

trainingLogs={trainingLogs}

requeueTrainingJob={requeueTrainingJob}

modelForm={modelForm}

setModelForm={setModelForm}

trainingForm={trainingForm}

setTrainingForm={setTrainingForm}

inferenceForm={inferenceForm}

setInferenceForm={setInferenceForm}

versionForm={versionForm}

setVersionForm={setVersionForm}

envForm={envForm}

setEnvForm={setEnvForm}

createModel={createModel}

createModelVersion={createModelVersion}

createPythonEnv={createPythonEnv}

renameModelVersion={renameModelVersion}

submitTrainingJob={submitTrainingJob}

updateTrainingJobState={updateTrainingJobState}

deleteTrainingJob={deleteTrainingJob}

submitInferenceJob={submitInferenceJob}

deleteInferenceJob={deleteInferenceJob}

deleteInferenceJobs={deleteInferenceJobs}

requeueInferenceJob={requeueInferenceJob}

moveRuntimeQueueJob={moveRuntimeQueueJob}

activeInferenceResult={activeInferenceResult}

setActiveInferenceResult={setActiveInferenceResult}

viewInferenceResults={viewInferenceResults}

currentUser={currentUser}
        authMode={authMode}
        setAuthMode={setAuthMode}
        setCurrentUser={setCurrentUser}
        onLogout={signOut}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        appConfig={appConfig}
        error={error}

setError={setError}

openPlatform={openPlatform}

openDatasetView={openDatasetView}

theme={theme}

setTheme={setTheme}

/>

);

}

return (

<div className={`app-shell ${theme}`}>

<MainNav view="home" goHome={openDatasetView} openPlatform={openPlatform} theme={theme} setTheme={setTheme} user={currentUser} onLogin={() => setAuthMode("login")} onLogout={signOut} onSettings={() => setShowSettings(true)} />

<div className={hasCurrentImages ? "workspace-layout" : "workspace-folder-layout"}>

<WorkspaceSidebar

root={workspaceRoot}

activeProject={activeProject}

projects={projects}

openProject={openProject}

createProject={createProject}

summary={summary}

expandedIds={homeExpandedIds}

setExpandedIds={setHomeExpandedIds}

/>

<main className="preview-area">

<div className="home-toolbar workspace-inline-toolbar">

<div className="workspace-path-row">

<button className="icon-only ghost" title="返回项目" onClick={goHome}><ArrowLeft size={16} /></button>

<FolderOpen size={16} />

<button onClick={goHome}>项目</button>

{activeBreadcrumbs.map((project) => (

<React.Fragment key={project.id}>

<ChevronRight size={14} />

<button onClick={() => openProject(project)}>{project.name}</button>

</React.Fragment>

))}

</div>

<div className="workspace-commandbar home-commandbar">

<button onClick={goHome}><ArrowLeft size={16} />返回</button>

<button onClick={createProject}><FolderPlus size={16} />新建文件</button>

<button onClick={importData}><Import size={16} />导入数据</button>

<button onClick={exportProject}><Upload size={16} />导出数据</button>

<button onClick={openWorkspaceTrash}><Trash2 size={16} />回收</button>

<label className="export-format">导出格式

<select value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>

<option value="labelme">LabelMe</option>

<option value="coco">COCO</option>

<option value="yolo">YOLO</option>

</select>

</label>

</div>

</div>

{hasCurrentImages && <FilterPanel summary={summary} filters={filters} setFilters={(next) => { setFilters(next); setPage(1); }} imports={imports} />}

<ProgressStrip latestImport={latestImport} jobs={jobs} error={error} onCloseError={() => setError(null)} onCancelImport={cancelLatestImport} />

<WorkspaceFolders

projects={activeChildProjects}

openProject={openProject}

deleteProject={deleteProject}

editingProjectId={editingProjectId}

editingProjectName={editingProjectName}

setEditingProjectName={setEditingProjectName}

startRenameProject={startRenameProject}

commitRenameProject={commitRenameProject}

cancelRenameProject={cancelRenameProject}

projectLastImportAt={projectLastImportAt}

/>

{hasCurrentImages ? (

<>

<ImportRecords imports={imports} trashImports={trashImports} deleteImport={deleteImport} restoreImport={restoreImport} emptyImportTrash={emptyImportTrash} />

<ImageGrid

items={items}

selected={selected}

setSelected={setSelected}

page={page}

setPage={setPage}

openViewer={(item) => setViewerIndex(items.findIndex((x) => x.id === item.id))}

checkedIds={checkedIds}

setCheckedIds={setCheckedIds}

lastCheckedId={lastCheckedId}

setLastCheckedId={setLastCheckedId}

deleteCheckedImages={deleteCheckedImages}

/>

</>

) : (

!activeChildProjects.length && !latestImport && <div className="empty-state folder-empty">空文件夹</div>

)}

</main>

<Inspector item={hasCurrentImages ? selected : null} summary={summary} />

</div>

{showImportDialog && (

<div className="overlay" onClick={() => setShowImportDialog(false)}>

<div className="import-dialog" onClick={(e) => e.stopPropagation()}>

<div className="import-dialog-head">

<div className="dialog-title">

<span className="dialog-title-icon"><Import size={18} /></span>

<div>

<h2>导入数据</h2>

<p>{activeProject?.name || "当前项目"} · 本地文件夹导入到服务器端资产</p>

</div>

</div>

<button className="icon-button" onClick={() => { setShowImportDialog(false); setError(null); }} aria-label="关闭导入数据">

<X size={16} />

</button>

</div>

<div className="import-dialog-body">

<div className="import-dialog-grid">

<section className="import-path-panel">

<div className="import-field-head">

<div>

<label htmlFor="dataset-import-path">路径队列</label>

<p>可多次浏览添加，或用分号分隔多个本地路径</p>

</div>

<span>{parsedImportPaths.length} 个路</span>

</div>

<div className="import-path-row">

<textarea

id="dataset-import-path"

value={importPath}

onChange={(e) => setImportPath(e.target.value)}

placeholder="F:\\ZBH\\统计用\\山地; F:\\ZBH\\统计用\\草地"

rows={4}

/>

<div className="import-path-tools">

<button className="primary" onClick={browseFolder} disabled={browseBusy}><FolderOpen size={14} />{browseBusy ? "打开" : "浏览"}</button>

<button onClick={() => setImportPath("")} disabled={!importPath.trim()}>清空</button>

</div>

</div>

<div className="import-path-list">

{parsedImportPaths.length ? parsedImportPaths.map((pathValue) => (

<span key={pathValue} title={pathValue}>{pathValue}</span>

)) : <em>等待选择本地文件</em>}

</div>

</section>

<aside className="import-profile-panel">

<div className="import-profile-block">

<span>目标位置</span>

<b>{activeProject?.name || "当前项目"}</b>

</div>

<div className="import-profile-block">

<span>扫描方式</span>

<b>递归扫描</b>

</div>

<div className="import-profile-list">

<div><CheckCircle2 size={14} />图片 / 视频资产入库</div>

<div><CheckCircle2 size={14} />同名 JSON 自动匹配</div>

<div><CheckCircle2 size={14} />导入记录可回</div>

</div>

</aside>

</div>

{error && <div className="error-msg">{error}</div>}

</div>

<div className="dialog-actions">

<button onClick={() => { setShowImportDialog(false); setError(null); }}>取消</button>

<button className="primary" onClick={confirmImport}>开始导入</button>

</div>

</div>

</div>

)}

{dirPicker && (

<div className="overlay" onClick={() => setDirPicker(null)}>

<div className="dir-dialog" onClick={(e) => e.stopPropagation()}>

<div className="section-title-row">

<h2>选择数据文件</h2>

<button onClick={() => setDirPicker(null)}><X size={14} /></button>

</div>

<div className="dir-current">{dirPicker.current}</div>

<div className="dir-actions">

<button onClick={() => openDataRootPicker(dirPicker.parent)} disabled={!dirPicker.parent || dirPickerBusy}><ArrowLeft size={14} />上一</button>

<button className="primary" onClick={() => chooseDir(dirPicker.current)} disabled={dirPickerBusy || dirPicker.current === "__drives__"}><FolderOpen size={14} />选择当前文件夹</button>

</div>

{error && <div className="error-msg">{error}</div>}

<div className="dir-list">

{dirPicker.dirs.map((dir) => (

<button key={dir.path} onClick={() => openDataRootPicker(dir.path)} disabled={dirPickerBusy}>

<Folder size={15} />

<span>{dir.name}</span>

</button>

))}

{!dirPicker.dirs.length && <div className="muted">当前目录下没有子文件</div>}

</div>

</div>

</div>

)}

{showBaselineDialog && (

<div className="overlay" onClick={() => setShowBaselineDialog(false)}>

<div className="baseline-dialog" onClick={(e) => e.stopPropagation()}>

<div className="section-title-row">

<h2>生成基准数据</h2>

<button onClick={() => setShowBaselineDialog(false)}><X size={14} /></button>

</div>

<label>基准项目名称<input value={baselineName} onChange={(e) => setBaselineName(e.target.value)} /></label>

<div className="baseline-layout">

<section>

<h3>来源项目</h3>

<div className="baseline-source-list">

{projects.map((project) => (

<label key={project.id} className="check-row">

<input type="checkbox" checked={baselineSources.includes(project.id)} onChange={() => toggleBaselineSource(project.id)} />

<span>{project.name} · {project.image_count || 0} </span>

</label>

))}

</div>

</section>

<section>

<h3>批量规则参数</h3>

<label>一致 IoU 阈值<input type="number" step="0.01" min="0" max="1" value={baselineParams.iouSame} onChange={(e) => setBaselineParams({ ...baselineParams, iouSame: Number(e.target.value) })} /></label>

<label>轻微冲突 IoU 阈值<input type="number" step="0.01" min="0" max="1" value={baselineParams.iouLight} onChange={(e) => setBaselineParams({ ...baselineParams, iouLight: Number(e.target.value) })} /></label>

<p className="muted">来源优先级按勾选顺序处理；当前第一版按来源优先级保留冲突标注，并打印冲突统计</p>

</section>

</div>

<div className="dialog-actions">

<button disabled={baselineBusy} onClick={previewBaseline}>预分</button>

<button className="primary" disabled={baselineBusy || !baselinePreview} onClick={applyBaseline}>应用并生成基准项</button>

</div>

{baselinePreview && (

<section className="baseline-report">

<h3>合并情况</h3>

<div className="baseline-stats">

<span>来源项目 <b>{baselinePreview.summary.source_projects}</b></span>

<span>来源图片 <b>{baselinePreview.summary.source_images}</b></span>

<span>去重后图像<b>{baselinePreview.summary.unique_images}</b></span>

<span>自动一致<b>{baselinePreview.summary.auto_resolved}</b></span>

<span>冲突图片 <b>{baselinePreview.summary.conflicts}</b></span>

<span>预计保留标注 <b>{baselinePreview.summary.annotations_kept}</b></span>

</div>

<pre>{JSON.stringify(baselinePreview.summary.by_type || {}, null, 2)}</pre>

<div className="merge-log">

{(baselinePreview.logs || []).slice(0, 80).map((line, index) => <p key={index}>{line}</p>)}

</div>

<ConflictReview

conflicts={baselineConflicts}

activeId={activeConflictId}

setActiveId={setActiveConflictId}

selectedIds={selectedConflictIds}

toggleSelected={toggleConflict}

resolveSelected={resolveSelectedConflicts}

/>

</section>

)}

{error && <div className="error-msg">{error}</div>}

</div>

</div>

)}

{authMode && <AuthDialog mode={authMode} setMode={setAuthMode} required={!currentUser} onClose={() => setAuthMode(null)} onSignedIn={setCurrentUser} />}

{showSettings && <SettingsDialog config={appConfig} onClose={() => setShowSettings(false)} />}

{viewerIndex != null && items[viewerIndex] && (

<ImageViewer

items={items}

index={viewerIndex}

setIndex={setViewerIndex}

onClose={() => setViewerIndex(null)}

onSaved={(imageId, annotations) => {

setItems((rows) => rows.map((row) => row.id === imageId ? { ...row, annotations, annotation_count: annotations.length } : row));

setSelected((row) => row?.id === imageId ? { ...row, annotations, annotation_count: annotations.length } : row);

}}

/>

)}

</div>

);

}

function PlatformPage({

view,

setView,

projects,

mlModels,

modelVersions,

trainingJobs,

inferenceJobs,

trainingTemplates,

algorithmAssets,

pythonEnvs,

assetLinks,

activeTrainingJobId,

setActiveTrainingJobId,

trainingLogs,

requeueTrainingJob,

modelForm,

setModelForm,

trainingForm,

setTrainingForm,

inferenceForm,

setInferenceForm,

versionForm,

setVersionForm,

envForm,

setEnvForm,

createModel,

createModelVersion,

createPythonEnv,

renameModelVersion,

submitTrainingJob,

updateTrainingJobState,

deleteTrainingJob,

submitInferenceJob,

deleteInferenceJob,

deleteInferenceJobs,

requeueInferenceJob,

moveRuntimeQueueJob,

activeInferenceResult,

setActiveInferenceResult,

viewInferenceResults,

error,

setError,

openPlatform,

openDatasetView,

theme,

setTheme,

currentUser,
  authMode,
  setAuthMode,
  setCurrentUser,
  onLogout,
  showSettings,
  setShowSettings,
  appConfig,
}) {

const title = view === "training" ? "训练平台" : view === "inference" ? "推理平台" : view === "evaluation" ? "测试评估平台" : "\u8d44\u4ea7";

const supportedTasks = ["detect", "segment", "classify"];

const [evaluationCluster, setEvaluationCluster] = useState("all");

const [evaluationType, setEvaluationType] = useState("all");

const [hiddenEvaluationJobIds, setHiddenEvaluationJobIds] = useState([]);

const [activeEvaluationTask, setActiveEvaluationTask] = useState(null);

const [activeEvaluationReportTask, setActiveEvaluationReportTask] = useState(null);

const [selectedEvaluationTaskId, setSelectedEvaluationTaskId] = useState(() => readUiState().evaluation?.selectedTaskId || "");

useEffect(() => {
  updateUiState({ evaluation: { selectedTaskId: selectedEvaluationTaskId } });
}, [selectedEvaluationTaskId]);

const evaluationTasks = inferenceJobs

.filter((job) => !hiddenEvaluationJobIds.includes(job.id))

.map((job) => {

const cluster = job.task_type || job.taskType || "detect";

const modelText = job.model_name ? `${job.model_name}/${job.version_name || "版本"}` : "未指定模型版";

return {

id: job.id,

name: job.name || `推理任务 ${job.id}`,

cluster,

type: "inference",

description: job.message || `${job.dataset_project_name || "未绑定数据集"} · ${modelText} · 已完成推理任务，可进入评估`,

creator: job.created_by || job.creator || "admin",

createdAt: formatDateTime(job.created_at),

sourceJob: job,

};

});

const filteredEvaluationTasks = evaluationTasks.filter((task) => {

const clusterMatch = evaluationCluster === "all" || task.cluster === evaluationCluster;

const typeMatch = evaluationType === "all" || task.type === evaluationType;

return clusterMatch && typeMatch;

});

const inferenceVersions = modelVersions.filter((version) => {

const model = mlModels.find((item) => item.id === version.model_id);

return !model?.task_type || model.task_type === inferenceForm.taskType;

});

const inferenceAlgorithms = algorithmAssets.filter((asset) => {

const tasks = asset.capabilities_json?.tasks || [asset.task_type || "detect"];

return tasks.includes(inferenceForm.taskType);

});

const selectedInferenceEnv = pythonEnvs.find((env) => env.id === inferenceForm.pythonEnvId);

const [assetDrawerMode, setAssetDrawerMode] = useState(null);

return (

<div className={`app-shell ${theme}`}>

<MainNav view={view} goHome={openDatasetView || (() => { setView("home"); setError(null); })} openPlatform={openPlatform} theme={theme} setTheme={setTheme} user={currentUser} onLogin={() => setAuthMode("login")} onLogout={onLogout} onSettings={() => setShowSettings(true)} />

{view !== "training" && view !== "inference" && view !== "models" && view !== "evaluation" && <header className="app-header">

        <div>

<h1>{title}</h1>

<p>借鉴 Run / Artifact / Model Version / Queue 的平台化管理方式</p>

</div>

</header>}

<main className={`platform-page ${view === "training" ? "training-platform-page" : ""} ${view === "inference" ? "inference-platform-page" : ""} ${view === "models" ? "asset-platform-page" : ""} ${view === "evaluation" ? "evaluation-platform-page" : ""}`}>

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>&times;</button></div>}

{view === "training" && (

          <TrainingWorkspace

            projects={projects}

            mlModels={mlModels}

            modelVersions={modelVersions}

            trainingTemplates={trainingTemplates}

            algorithmAssets={algorithmAssets}

            pythonEnvs={pythonEnvs}

            assetLinks={assetLinks}

            trainingJobs={trainingJobs}

            activeTrainingJobId={activeTrainingJobId}

            setActiveTrainingJobId={setActiveTrainingJobId}

            trainingLogs={trainingLogs}

            requeueTrainingJob={requeueTrainingJob}

            trainingForm={trainingForm}

            setTrainingForm={setTrainingForm}

            submitTrainingJob={submitTrainingJob}

            updateTrainingJobState={updateTrainingJobState}

            deleteTrainingJob={deleteTrainingJob}

            moveRuntimeQueueJob={moveRuntimeQueueJob}

          />

        )}

        {view === "inference" && (

<InferenceWorkspace

projects={projects}

mlModels={mlModels}

modelVersions={modelVersions}

inferenceVersions={inferenceVersions}

inferenceAlgorithms={inferenceAlgorithms}

algorithmAssets={algorithmAssets}

pythonEnvs={pythonEnvs}

assetLinks={assetLinks}

inferenceJobs={inferenceJobs}

inferenceForm={inferenceForm}

setInferenceForm={setInferenceForm}

selectedInferenceEnv={selectedInferenceEnv}

submitInferenceJob={submitInferenceJob}

viewInferenceResults={viewInferenceResults}

deleteInferenceJob={deleteInferenceJob}

deleteInferenceJobs={deleteInferenceJobs}

moveRuntimeQueueJob={moveRuntimeQueueJob}

/>

)}

{view === "evaluation" && (activeEvaluationReportTask ? (

<EvaluationReportPage

task={activeEvaluationReportTask}

onBack={() => setActiveEvaluationReportTask(null)}

/>

) : activeEvaluationTask ? (

<EvaluationDetailPage

task={activeEvaluationTask}

onBack={() => setActiveEvaluationTask(null)}

onRunDetail={(task) => viewInferenceResults(task.sourceJob)}

onReport={setActiveEvaluationReportTask}

/>

) : (

<EvaluationPage

cluster={evaluationCluster}

setCluster={setEvaluationCluster}

type={evaluationType}

setType={setEvaluationType}

tasks={filteredEvaluationTasks}

selectedTaskId={selectedEvaluationTaskId}

setSelectedTaskId={setSelectedEvaluationTaskId}

projects={projects}

models={mlModels}

versions={modelVersions}

algorithms={algorithmAssets.length ? algorithmAssets : trainingTemplates}

environments={pythonEnvs}

onDetail={setActiveEvaluationTask}

onDelete={(taskId) => setHiddenEvaluationJobIds((ids) => Array.from(new Set([...ids, taskId])))}

/>

))}

{view === "models" && (

<AssetManagementWorkspace

projects={projects}

mlModels={mlModels}

modelVersions={modelVersions}

algorithmAssets={algorithmAssets}

trainingTemplates={trainingTemplates}

pythonEnvs={pythonEnvs}

assetLinks={assetLinks}

modelForm={modelForm}

setModelForm={setModelForm}

versionForm={versionForm}

setVersionForm={setVersionForm}

envForm={envForm}

setEnvForm={setEnvForm}

createModel={createModel}

createModelVersion={createModelVersion}

createPythonEnv={createPythonEnv}

renameModelVersion={renameModelVersion}

drawerMode={assetDrawerMode}

setDrawerMode={setAssetDrawerMode}

/>

)}

{authMode && <AuthDialog mode={authMode} setMode={setAuthMode} required={!currentUser} onClose={() => setAuthMode(null)} onSignedIn={setCurrentUser} />}
        {showSettings && <SettingsDialog config={appConfig} onClose={() => setShowSettings(false)} />}
        {activeInferenceResult && (

<InferenceResultDialog

resultState={activeInferenceResult}

onClose={() => setActiveInferenceResult(null)}

/>

)}

</main>

</div>

);

}

function AuthDialog({ mode, setMode, onClose, onSignedIn, required = false }) {

  const [form, setForm] = useState({ username: mode === "login" ? "admin" : "", password: mode === "login" ? "admin" : "", confirm: "", displayName: "" });

  const [busy, setBusy] = useState(false);

  const submit = async () => {

    if (busy) return;

    if (mode === "register" && form.password !== form.confirm) return window.alert("两次密码不一");

    setBusy(true);

    try {

      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {

        method: "POST",

        headers: { "content-type": "application/json" },

        body: JSON.stringify({ username: form.username.trim(), password: form.password, displayName: form.displayName.trim() }),

      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(data.error || (mode === "login" ? "登录失败" : "注册失败"));

      const signed = { ...(data.user || {}), token: data.token };

      window.localStorage.setItem("det-dashboard-user", JSON.stringify(signed));

      onSignedIn(signed);

      onClose();

    } catch (error) {

      window.alert(error.message || "认证失败");

    } finally {

      setBusy(false);

    }

  };

  return (

    <div className="auth-overlay">

      <section className="auth-dialog">

        {!required && <button className="auth-close" onClick={onClose}><X size={16} /></button>}

        <h2>{mode === "login" ? "登录 Det Dashboard" : "注册用户"}</h2>

        <p>支持多用户登录，默认账号：admin / admin</p>

        <label>用户名<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>

        {mode === "register" && <label>显示名称<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="可" /></label>}

        <label>密码<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>

        {mode === "register" && <label>确认密码<input type="password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} /></label>}

        <button className="primary" onClick={submit} disabled={busy}>{busy ? "处理中..." : (mode === "login" ? "登录" : "注册并登录")}</button>

        <button className="text-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "没有账号？注" : "已有账号？登"}</button>

      </section>

    </div>

  );

}

function SettingsDialog({ config, onClose }) {

  const initialSettings = config?.settings || {};

  const [form, setForm] = useState({

    postgres: initialSettings.postgres || config?.postgres || "127.0.0.1:55432 / det_dashboard",

    dataStorage: initialSettings.dataStorage || config?.dataRootDisplay || config?.dataRoot || "",

    browseRoot: initialSettings.browseRoot || config?.browseRootDisplay || config?.browseRoot || "",

    minioStorage: initialSettings.minioStorage || (config?.minio ? `${config.minio.endPoint}:${config.minio.port} / ${config.minio.bucket}` : "127.0.0.1:9000 / zbh-datasets"),

    minioDataDir: initialSettings.minioDataDir || config?.minio?.dataDir || "E:\\projects\\DD-runtime\\minio",

    pythonAssets: initialSettings.pythonAssets || "D:\\Program Files\\miniforge3",

    algorithmAssets: initialSettings.algorithmAssets || "E:\\projects\\DD-runtime\\minio\\zbh-datasets\\code-assets\\algorithms",

    exportRoot: initialSettings.exportRoot || config?.exportRoot || "exports",

  });

  const [busy, setBusy] = useState(false);

  const fields = [
    ["postgres", "Postgres", "连接串或 host:port / db"],
    ["dataStorage", "数据存储", "Windows 数据集根路径"],
    ["browseRoot", "导入浏览根路径", "打开目录选择器时的根路径"],
    ["minioStorage", "MinIO", "endpoint:port / bucket"],
    ["minioDataDir", "MinIO 数据目录", "E:\\projects\\DD-runtime\\minio 或实际数据路径"],
    ["pythonAssets", "Python 资产", "Miniforge / Python 环境路径"],
    ["algorithmAssets", "算法源码", "算法适配器和源码路径"],
    ["exportRoot", "导出目录", "报告与导出文件路径"],
  ];

  const save = async () => {

    setBusy(true);

    try {

      const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: form }) });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(data.error || "保存设置失败");

      window.alert("设置已保");

      onClose();

    } catch (error) {

      window.alert(error.message || "保存设置失败");

    } finally {

      setBusy(false);

    }

  };

  return (

    <div className="auth-overlay settings-overlay">

      <section className="settings-dialog">

        <button className="auth-close" onClick={onClose}><X size={16} /></button>

        <h2>系统设置</h2>

        <p>配置 Postgres、数据存储、MinIO、Python 资产与算法源码路径</p>

        <div className="settings-list">{fields.map(([key, label, placeholder]) => <label key={key}>{label}<input value={form[key]} placeholder={placeholder} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div>

        <div className="settings-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={save}>{busy ? "保存中..." : "保存设置"}</button></div>

      </section>

    </div>

  );

}
function useWorkspaceColumns(storageKey, defaults) {
  const [columns, setColumns] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey));
      return saved && Number(saved.left) && Number(saved.right) ? saved : defaults;
    } catch {
      return defaults;
    }
  });
  const beginResize = (side, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startValue = columns[side];
    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const min = side === "left" ? 220 : 300;
      const max = side === "left" ? 460 : 620;
      setColumns((current) => ({ ...current, [side]: Math.max(min, Math.min(max, startValue + (side === "left" ? delta : -delta))) }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      document.body.classList.remove("resizing-workspace");
    };
    document.body.classList.add("resizing-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };
  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(columns));
  }, [columns, storageKey]);
  return { columns, beginResize };
}

function WorkspaceResizeHandle({ side, onPointerDown }) {
  return <div className={`workspace-resize-handle ${side}`} role="separator" aria-orientation="vertical" aria-label={`调整${side === "left" ? "左侧" : "右侧"}栏宽度`} onPointerDown={(event) => onPointerDown(side, event)} />;
}

function TrainingWorkspace({

  projects,

  mlModels,

  modelVersions,

  trainingTemplates,

  algorithmAssets,

  pythonEnvs,

  assetLinks,

  trainingJobs,

  activeTrainingJobId,

  setActiveTrainingJobId,

  trainingLogs,

  requeueTrainingJob,

  trainingForm,

  setTrainingForm,

  submitTrainingJob,

  updateTrainingJobState,

  deleteTrainingJob,

  moveRuntimeQueueJob,

}) {

  const { columns, beginResize } = useWorkspaceColumns("det-dashboard.training-columns", { left: 292, right: 410 });

  const algorithms = algorithmAssets.length ? algorithmAssets : trainingTemplates;

  const trainProjectIds = trainingForm.trainProjectIds?.length ? trainingForm.trainProjectIds : [trainingForm.trainProjectId || trainingForm.datasetProjectId].filter(Boolean);
  const selectedProject = projects.find((project) => project.id === trainProjectIds[0]) || {};

  const selectedEnv = pythonEnvs.find((env) => env.id === trainingForm.pythonEnvId) || pythonEnvs.find((env) => String(env.name || '').includes('ultralytics')) || pythonEnvs[0] || {};

  const selectedVersion = modelVersions.find((version) => version.id === trainingForm.initialModelVersionId) || modelVersions.find((version) => String(version.version_name || '').includes('yolov8l')) || modelVersions[0] || {};

  const selectedModel = mlModels.find((model) => model.id === trainingForm.modelId) || mlModels.find((model) => String(model.name || '').includes('YOLOv8l')) || mlModels[0] || {};

  const selectedAlgorithm = algorithms.find((item) => (item.id || item.template_key) === trainingForm.templateId) || {};

  const [expandedGroups, setExpandedGroups] = useState(() => new Set(["数据集项目", "算法适配器", "模型簇", "Python 环境"]));
  const [activeDatasetSplit, setActiveDatasetSplit] = useState("trainProjectId");
  const toggleGroup = (title) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(title)) next.delete(title); else next.add(title);
    return next;
  });
  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const project of projects) {
      const key = project.parent_id || "root";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(project);
    }
    return map;
  }, [projects]);
  const datasetRows = [];
  const appendDatasetRows = (parentId = "root", depth = 0) => {
    for (const project of childrenByParent.get(parentId) || []) {
      datasetRows.push({
        id: project.id,
        name: project.name,
        right: project.image_count || 0,
        depth,
        active: activeDatasetSplit === "trainProjectId" ? trainProjectIds.includes(project.id) : trainingForm[activeDatasetSplit] === project.id,
        onClick: () => {
          if (activeDatasetSplit === "trainProjectId") {
            const nextIds = trainProjectIds.includes(project.id) ? trainProjectIds.filter((id) => id !== project.id) : [...trainProjectIds, project.id];
            setTrainingForm({ ...trainingForm, trainProjectIds: nextIds, trainProjectId: nextIds[0] || "", datasetProjectId: nextIds[0] || "" });
          } else {
            setTrainingForm({ ...trainingForm, [activeDatasetSplit]: trainingForm[activeDatasetSplit] === project.id ? "" : project.id });
          }
        },
      });
      appendDatasetRows(project.id, depth + 1);
    }
  };
  appendDatasetRows();

  const activeJob = trainingJobs.find((job) => job.id === activeTrainingJobId) || trainingJobs[0];

  const runningJob = activeJob || null;
  const progress = runningJob ? Math.max(0, Math.min(100, Number(runningJob.progress || 0))) : 0;
  const epoch = runningJob ? Number(runningJob.current_epoch || Math.round(progress)) : 0;
  const totalEpochs = runningJob ? Number(runningJob.total_epochs || trainingForm.epochs || 0) : 0;

  const trainMetrics = [

    ['当前 Epoch', runningJob && totalEpochs ? epoch + ' / ' + totalEpochs : '--'],

    ['mAP50', runningJob?.map50 != null ? `${(Number(runningJob.map50) * 100).toFixed(2)}%` : '--'],

    ['box_loss', runningJob?.box_loss != null ? Number(runningJob.box_loss).toFixed(3) : '--'],

    ['cls_loss', runningJob?.cls_loss != null ? Number(runningJob.cls_loss).toFixed(3) : '--'],

    ['学习率', runningJob?.learning_rate != null ? String(runningJob.learning_rate) : '--'],

    ['ETA', runningJob?.eta || '--'],

  ];

  const resourceGroups = [
    { title: '数据集项目', icon: FolderOpen, rows: datasetRows },
    { title: '算法适配器', icon: Boxes, rows: algorithms.map((algorithm) => ({ id: algorithm.id || algorithm.template_key, name: algorithm.name, right: algorithm.version || algorithm.algorithm_key || '', active: (algorithm.id || algorithm.template_key) === trainingForm.templateId, onClick: () => selectTrainingAlgorithm(algorithm.id || algorithm.template_key) })) },
    { title: '模型簇', icon: Database, rows: mlModels.map((model) => ({ id: model.id, name: model.name, right: modelVersions.filter((version) => version.model_id === model.id).length, active: model.id === selectedModel.id, onClick: () => setTrainingForm({ ...trainingForm, modelId: model.id }) })) },
    { title: 'Python 环境', icon: Cpu, rows: pythonEnvs.map((env) => ({ id: env.id, name: env.name, right: env.status, active: env.id === selectedEnv.id, onClick: () => setTrainingForm({ ...trainingForm, pythonEnvId: env.id, python: env.python_path || trainingForm.python }) })) },
  ].filter((group) => group.rows.length).map((group) => ({ ...group, count: group.rows.length }));

  const queueRows = trainingJobs;

  const logRows = trainingLogs.length ? trainingLogs.map((log) => log.message || log.text || String(log)).slice(-7) : [];

  const setField = (key, value) => setTrainingForm({ ...trainingForm, [key]: value });
  const normalizeParameterSchema = (schema) => {
    const conflictingKeys = new Set(["model", "model_id", "model_path", "data", "dataset", "dataset_id", "dataset_project_id", "project", "project_id", "name", "task_name"]);
    const cleanFields = (fields = []) => fields.filter((field) => field?.key && !conflictingKeys.has(String(field.key).toLowerCase()));
    if (!schema) return [];
    if (Array.isArray(schema)) return [{ key: "parameters", label: "参数", fields: cleanFields(schema) }];
    if (Array.isArray(schema.groups)) return schema.groups.map((group, index) => ({ ...group, key: group.key || `group-${index}`, label: group.label || group.title || "参数", fields: cleanFields(group.fields) }));
    if (Array.isArray(schema.fields)) return [{ key: "parameters", label: schema.label || schema.title || "参数", fields: cleanFields(schema.fields) }];
    if (schema.properties && typeof schema.properties === "object") {
      return [{ key: "parameters", label: schema.title || "参数", fields: cleanFields(Object.entries(schema.properties).map(([key, value]) => ({ key, label: value.title || value.label || key, type: value.enum ? "select" : value.type, options: value.enum, default: value.default, min: value.minimum, max: value.maximum, step: value.multipleOf, description: value.description, required: schema.required?.includes(key) }))) }];
    }
    return [];
  };
  const parameterGroups = trainingForm.templateId ? normalizeParameterSchema(selectedAlgorithm.capabilities_json?.parameterSchema) : [];
  const parameterAliases = {
    yolo_version: "yoloVersion",
    taskType: "taskType",
    imgsz: "imgsz",
    batch: "batch",
    batch_size: "batch",
    epochs: "epochs",
    optimizer: "optimizer",
    lr0: "learningRate",
    learning_rate: "learningRate",
    save_period: "savePeriod",
    device: "device",
    amp: "amp",
  };
  const algorithmFieldValue = (field) => {
    if (Object.prototype.hasOwnProperty.call(trainingForm.algorithmParams || {}, field.key)) return trainingForm.algorithmParams[field.key];
    const alias = parameterAliases[field.key];
    if (alias && trainingForm[alias] !== undefined) {
      if (field.key === "yolo_version") return trainingForm.yoloVersion === "v11" ? "yolo11" : `yolov${String(trainingForm.yoloVersion || "v8").replace(/^v/i, "")}`;
      return trainingForm[alias];
    }
    return field.default ?? "";
  };
  const setAlgorithmField = (field, value) => {
    const alias = parameterAliases[field.key];
    const normalizedValue = field.type === "number" ? Number(value) : value;
    const next = { ...trainingForm, algorithmParams: { ...(trainingForm.algorithmParams || {}), [field.key]: normalizedValue } };
    if (alias) next[alias] = field.key === "yolo_version" ? (value === "yolo11" ? "v11" : String(value).replace(/^yolov/i, "v")) : normalizedValue;
    setTrainingForm(next);
  };
  const selectTrainingAlgorithm = (algorithmId) => {
    const algorithm = algorithms.find((item) => (item.id || item.template_key) === algorithmId);
    const defaults = { ...(algorithm?.default_params_json || {}) };
    for (const group of normalizeParameterSchema(algorithm?.capabilities_json?.parameterSchema)) {
      for (const field of group.fields || []) if (defaults[field.key] === undefined && field.default !== undefined) defaults[field.key] = field.default;
    }
    const linked = bestAssetLink(assetLinks, algorithmId);
    const nextForm = {
      ...trainingForm,
      templateId: algorithmId,
      taskType: algorithm?.capabilities_json?.tasks?.[0] || algorithm?.task_type || trainingForm.taskType,
      pythonEnvId: linked?.python_env_id || trainingForm.pythonEnvId,
      modelId: linked?.model_id || trainingForm.modelId,
      algorithmParams: defaults,
    };
    for (const [key, value] of Object.entries(defaults)) {
      const alias = parameterAliases[key];
      if (!alias) continue;
      nextForm[alias] = key === "yolo_version" ? (value === "yolo11" ? "v11" : String(value).replace(/^yolov/i, "v")) : value;
    }
    setTrainingForm(nextForm);
  };

  return (

    <div className="training-workspace resizable-workspace" style={{ "--workspace-left": `${columns.left}px`, "--workspace-right": `${columns.right}px` }}>

      <aside className="training-sidebar reference-sidebar">

        <h2>训练资源</h2>

        <div className="split-target-control" aria-label="选择左侧数据集要写入的划分">
          {[['trainProjectId', '训练'], ['valProjectId', '验证'], ['testProjectId', '测试']].map(([key, label]) => <button type="button" className={activeDatasetSplit === key ? 'active' : ''} key={key} onClick={() => setActiveDatasetSplit(key)}>{label}</button>)}
        </div>

        <div className="resource-tree">

          {resourceGroups.map((group) => (

            <section className="resource-group" key={group.title}>

              <button className="resource-group-head" type="button" onClick={() => toggleGroup(group.title)}>

                {expandedGroups.has(group.title) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

                <group.icon size={14} />

                <b>{group.title}</b>

                <em>{group.count}</em>

              </button>

              {expandedGroups.has(group.title) && group.rows.map((row) => (

                <button className={`${row.active ? 'active' : ''} depth-${row.depth || 0}`} style={{ "--depth": row.depth || 0 }} onClick={row.onClick} key={group.title + '-' + row.id} type="button">

                  <group.icon size={14} />

                  <span>{row.name}</span>

                  {row.badge && <strong>{row.badge}</strong>}

                  <em>{row.right}</em>

                </button>

              ))}

            </section>

          ))}

        </div>

        <div className="training-resource-meter"><span>资源使用</span><b>68%</b><i><em style={{ width: '68%' }} /></i><small>20 / 29 TB</small></div>

      </aside>

      <WorkspaceResizeHandle side="left" onPointerDown={beginResize} />

      <main className="training-main">

        <div className="training-toolbar inference-toolbar">

          <div className="platform-breadcrumb"><Folder size={16} /><b>训练</b><ChevronRight size={14} /><b>新建训练任务</b></div>

          <div className="inference-commandbar">

            <button onClick={submitTrainingJob}><span>+</span> 新建训练任务</button>

            <button><Copy size={15} /> 批量训练</button>

            <button className="danger-outline"><Pause size={15} /> 停止训练</button>

            <button><RefreshCw size={15} /> 刷新</button>

          </div>

        </div>

        <div className="training-builder reference-builder">

          <section className="reference-section dataset-split-section">
            <h2>数据与标签</h2>
            <div className="dataset-split-grid">
              <label className="training-multiselect"><span>训练集<small>train · 可多选</small></span><select multiple value={trainProjectIds} size={Math.min(5, Math.max(3, projects.length))} onChange={(event) => { const nextIds = Array.from(event.target.selectedOptions, (option) => option.value); setTrainingForm({ ...trainingForm, trainProjectIds: nextIds, trainProjectId: nextIds[0] || "", datasetProjectId: nextIds[0] || "" }); }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {formatCount(project.image_count || 0)} 图像</option>)}</select><small className="selection-summary">已选择 {trainProjectIds.length} 个训练集</small></label>
              {[['valProjectId', '验证集', 'val'], ['testProjectId', '测试集', 'test']].map(([key, label, hint]) => (
                <label key={key}><span>{label}<small>{hint} · 单选</small></span><select value={trainingForm[key] || ''} onChange={(e) => setTrainingForm({ ...trainingForm, [key]: e.target.value })}><option value="">选择{label}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {formatCount(project.image_count || 0)} 图像</option>)}</select></label>
              ))}
            </div>
            <div className="dataset-meta-row"><span>活动标签：{String(selectedProject.active_label_version_id || 'active').slice(0, 8)}</span><span>训练图像：{formatCount(selectedProject.image_count || 0)}</span><span>划分由导入结果确定，不再使用固定比例</span></div>
          </section>

          <section className="reference-section model-init-section">
            <h2>算法与初始化</h2>
            <div className="config-row model-init-row"><span className="row-label">算法适配器</span><select value={trainingForm.templateId} onChange={(e) => selectTrainingAlgorithm(e.target.value)}><option value="">选择算法适配器</option>{algorithms.map((algorithm) => <option key={algorithm.id || algorithm.template_key} value={algorithm.id || algorithm.template_key}>{algorithm.name}</option>)}</select><span className="row-label">初始化方式</span><select value={trainingForm.initializationMode} onChange={(e) => setTrainingForm({ ...trainingForm, initializationMode: e.target.value, initialModelVersionId: '', resume: false })}><option value="random">随机初始化（不加载权重）</option><option value="zero">零初始化（不加载权重）</option><option value="pretrained">预训练权重</option><option value="training">训练任务产物</option></select>{['pretrained', 'training'].includes(trainingForm.initializationMode) ? <><span className="row-label">初始化权重</span><select value={trainingForm.initialModelVersionId} onChange={(e) => setField('initialModelVersionId', e.target.value)}><option value="">选择权重</option>{modelVersions.filter((version) => trainingForm.initializationMode === 'training' ? Boolean(version.training_job_id) : !version.training_job_id || version.stage === 'pretrained').map((version) => <option key={version.id} value={version.id}>{version.model_name} / {version.version_name}</option>)}</select>{trainingForm.initializationMode === 'training' && trainingForm.initialModelVersionId && <button className={`icon-toggle ${trainingForm.resume ? 'active' : ''}`} type="button" title={trainingForm.resume ? '从检查点继续训练' : '仅加载权重并从头训练'} onClick={() => setField('resume', !trainingForm.resume)}><RotateCcw size={15} /></button>}</> : <span className="initialization-note">{trainingForm.initializationMode === 'zero' ? '全部可训练参数从 0 开始，不使用任何模型权重。' : '按算法默认分布随机生成参数，不使用任何模型权重。'}</span>}</div>
            <div className="config-row"><span className="row-label">Python 环境</span><select value={trainingForm.pythonEnvId} onChange={(e) => { const env = pythonEnvs.find((item) => item.id === e.target.value); setTrainingForm({ ...trainingForm, pythonEnvId: e.target.value, python: env?.python_path || trainingForm.python }); }}><option value="">选择 Python 环境</option>{pythonEnvs.map((env) => <option key={env.id} value={env.id}>{env.name} · {env.status}</option>)}</select><span>{selectedEnv.python_version || '--'} · {selectedEnv.torch_version || '--'} · {(selectedEnv.accelerator || 'CPU').toUpperCase()}</span></div>
          </section>

          <section className="reference-section algorithm-params-section"><h2>训练参数{selectedAlgorithm.name ? ` · ${selectedAlgorithm.name}` : ''}</h2>{!trainingForm.templateId ? <div className="parameter-placeholder">尚未选择算法，训练参数为空。</div> : parameterGroups.length ? <div className="parameter-groups schema-parameter-groups">{parameterGroups.map((group) => { const advanced = /advanced|高级/i.test(`${group.key || ''} ${group.label || ''}`); return <details className="parameter-group" key={group.key || group.label} open={!advanced}><summary>{group.label}{advanced ? <small>展开</small> : null}</summary><fieldset>{(group.fields || []).map((field) => <label key={field.key} title={field.description || ''}><span>{field.label || field.key}{field.required ? <b className="required-mark">*</b> : null}</span>{field.type === 'boolean' ? <span className="switch-control"><input type="checkbox" checked={Boolean(algorithmFieldValue(field))} onChange={() => setAlgorithmField(field, !Boolean(algorithmFieldValue(field)))} /><i /></span> : (field.type === 'select' || field.options) ? <select value={algorithmFieldValue(field)} onChange={(e) => setAlgorithmField(field, e.target.value)}>{(field.options || []).map((option) => { const value = typeof option === 'object' ? option.value : option; const label = typeof option === 'object' ? option.label : option; return <option key={String(value)} value={value}>{label}</option>; })}</select> : <input type={['number', 'integer'].includes(field.type) ? 'number' : 'text'} min={field.min} max={field.max} step={field.step || (field.type === 'integer' ? 1 : undefined)} value={algorithmFieldValue(field)} onChange={(e) => setAlgorithmField(field, e.target.value)} />}</label>)}</fieldset></details>; })}</div> : <div className="parameter-placeholder">该算法未在 capabilities_json.parameterSchema 中声明训练参数。</div>}</section>

          <section className="reference-section"><h2>输出与版本</h2><div className="config-row output-row"><label className="switch-option">保存 best / last<span className="switch-control"><input type="checkbox" defaultChecked /><i /></span></label><label>间隔 Epoch<input className="save-period-input" type="number" min="1" value={trainingForm.savePeriod} onChange={(e) => setField('savePeriod', e.target.value)} /></label><label className="switch-option">创建模型版本<span className="switch-control"><input type="checkbox" defaultChecked /><i /></span></label><div className="path-select"><Folder size={14} /><input value="/training/outputs" readOnly /><Download size={14} /></div></div></section>

        </div>

        <section className="training-queue reference-queue">
          <h2>训练任务队列 <span>共 {queueRows.length} 条</span></h2>
          <div className="training-table-head">
            <span>任务名称</span><span>数据</span><span>模型</span><span>状态</span><span>进度</span>
            <span>Epoch</span><span>box_loss</span><span>mAP50</span><span>ETA</span><span>操作</span>
          </div>
          {queueRows.map((job, index) => {
            const persistedJob = Boolean(job.id && !String(job.id).startsWith("mock-"));
            const terminalJob = ["done", "failed", "cancelled"].includes(String(job.status || "").toLowerCase());
            return (
              <div className="training-table-row" key={job.id || index} onClick={() => setActiveTrainingJobId(job.id)}>
                <b>{job.name || "训练任务"}</b>
                <span>{job.dataset_project_name || selectedProject.name || "--"}</span>
                <span>{job.model_name || selectedModel.name || "--"}</span>
                <em className={"status-badge " + (String(job.status).includes("fail") ? "status-failed" : "")}>{runStatusLabel(job.status)}</em>
                <i className="mini-progress"><b style={{ width: (job.progress ?? progress) + "%" }} /></i>
                <span>{job.current_epoch || epoch}/{job.total_epochs || totalEpochs}</span>
                <span>{job.box_loss ?? parseMaybeJson(job.metrics_json)?.box_loss ?? "--"}</span>
                <span>{formatMetric(job.map50 ?? parseMaybeJson(job.metrics_json)?.map50)}</span>
                <span>{job.eta || job.eta_text || "--"}</span>
                <div className="training-row-actions">
                  <button title="查看任务" onClick={(event) => { event.stopPropagation(); setActiveTrainingJobId(job.id); }}><Eye size={14} /></button>
                  <button title="上移" disabled={!persistedJob} onClick={(event) => { event.stopPropagation(); moveRuntimeQueueJob?.("training", job.id, "up"); }}><ArrowUp size={14} /></button>
                  <button title="下移" disabled={!persistedJob} onClick={(event) => { event.stopPropagation(); moveRuntimeQueueJob?.("training", job.id, "down"); }}><ArrowDown size={14} /></button>
                  <button title={job.status === "paused" ? "继续任务" : "暂停任务"} disabled={!persistedJob || terminalJob} onClick={(event) => { event.stopPropagation(); updateTrainingJobState?.(job.id, job.status === "paused" ? "resume" : "pause"); }}>{job.status === "paused" ? <Play size={14} /> : <Pause size={14} />}</button>
                  <button className="restart-action" title="重新开始" disabled={!persistedJob} onClick={(event) => { event.stopPropagation(); requeueTrainingJob?.(job.id); }}><RotateCcw size={15} strokeWidth={2.2} /></button>
                  <button className="danger-icon" title="删除任务" disabled={!persistedJob} onClick={(event) => { event.stopPropagation(); deleteTrainingJob?.(job.id); }}><Trash2 size={14} /></button>
                  <button title="打开 TensorBoard" onClick={(event) => { event.stopPropagation(); window.open("http://127.0.0.1:6006", "_blank"); }}><Grid size={14} /></button>
                </div>
              </div>
            );
          })}
          {!queueRows.length && <div className="queue-empty">暂无训练任务，配置完成后点击“新建训练任务”。</div>}
        </section>

      </main>

      <WorkspaceResizeHandle side="right" onPointerDown={beginResize} />

      <aside className="training-inspector reference-inspector">

        <div className="inspector-title"><h2>训练监控</h2><button><RefreshCw size={14} /></button></div>

        <div className="training-kpis">{trainMetrics.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>

        <section className="training-chart-panel"><h3>实时曲线</h3>{runningJob ? <><svg viewBox="0 0 360 190" preserveAspectRatio="none"><path className="loss-line" d="M0 35 C55 58 86 72 130 92 S220 124 360 148"/><path className="val-line" d="M0 52 C70 74 120 88 178 108 S270 138 360 156"/><path className="map-line" d="M0 166 C60 144 98 134 145 108 S250 70 360 42"/><path className="precision-line" d="M0 150 C66 126 120 112 180 86 S280 55 360 34"/></svg><div className="training-chart-legend"><span><i />train loss</span><span><i />val loss</span><span><i />mAP50</span><span><i />precision</span></div></> : <div className="parameter-placeholder">暂无训练曲线</div>}</section>

        <section className="training-log-panel"><h3>运行日志</h3>{logRows.length ? logRows.map((line, index) => <p key={index}>{line}</p>) : <p>暂无运行日志</p>}</section>

        <section className="artifact-preview"><h3>产物预览</h3>{runningJob ? ['best.pt', 'last.pt', 'results.csv', 'confusion_matrix.png'].map((name) => <p key={name}><Database size={14} /><span>{name}</span><em>已写入 MinIO</em></p>) : <p><span>暂无训练产物</span></p>}</section>

      </aside>

    </div>

  );

}

function AssetManagementWorkspace({

projects,

mlModels,

modelVersions,

algorithmAssets,

trainingTemplates,

pythonEnvs,

assetLinks,

modelForm,

setModelForm,

versionForm,

setVersionForm,

envForm,

setEnvForm,

createModel,

createModelVersion,

createPythonEnv,

renameModelVersion,

drawerMode,

setDrawerMode,

}) {

const algorithms = algorithmAssets.length ? algorithmAssets : trainingTemplates;
const [selectedExportAsset, setSelectedExportAsset] = useState(null);
const exportSelectedAsset = () => {
  if (!selectedExportAsset?.href) return;
  const anchor = document.createElement("a");
  anchor.href = selectedExportAsset.href;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const familyRows = Array.from(new Set(mlModels.map((model) => modelFamilyLabel(model.name)))).map((family) => {

const models = mlModels.filter((model) => modelFamilyLabel(model.name) === family);

const versions = modelVersions.filter((version) => models.some((model) => model.id === version.model_id));

return { family, models, versions };

});

const stats = [

["算法适配", algorithms.length, Boxes],

["模型", familyRows.length || mlModels.length, Brain],

["模型版本", modelVersions.length, Database],

["Python 环境", pythonEnvs.length, Cpu],

];

const recentItems = [

["登记权重", modelVersions[0]?.version_name || "YOLOv8n_ultralytics_8.4.80_cpu", "14:32:18", "admin", Upload],

["推理验证通过", assetLinks[0]?.algorithm_name || "Ultralytics YOLO", "14:32:19", "admin", CheckCircle2],

["环境检测完", pythonEnvs[0]?.name || "py3.12-torch2.12-cpu", "14:31:05", "system", Cpu],

["导入算法适配", algorithms[0]?.name || "Ultralytics YOLO", "14:30:12", "admin", Boxes],

];

return (

<div className={`asset-workspace ${drawerMode ? "drawer-open" : ""}`}>

<aside className="asset-sidebar">

<h2>资产目录</h2>

<AssetTreeGroup title="算法适配" icon={Boxes} count={algorithms.length} defaultOpen={false}>

{algorithms.map((algorithm) => (

<button key={algorithm.id || algorithm.name}><Boxes size={14} /><span>{algorithm.name}</span><em>1</em></button>

))}

</AssetTreeGroup>

<AssetModelFamilyTree families={familyRows} onSelect={setSelectedExportAsset} />

<AssetTreeGroup title="预训练模型" icon={Download} count={modelVersions.filter((version) => !version.training_job_id || version.stage === "pretrained").length} defaultOpen={false}>

{modelVersions.filter((version) => !version.training_job_id || version.stage === "pretrained").map((version) => (

<button className={selectedExportAsset?.key === `model-${version.id}` ? "active" : ""} key={version.id} onClick={() => setSelectedExportAsset({ key: `model-${version.id}`, type: "模型权重", name: `${version.model_name} / ${version.version_name}`, href: `/api/ml/model-versions/${encodeURIComponent(version.id)}/download` })} onContextMenu={(event) => { event.preventDefault(); const anchor = document.createElement("a"); anchor.href = `/api/ml/model-versions/${encodeURIComponent(version.id)}/download`; anchor.click(); }}><Brain size={14} /><span>{version.model_name} / {version.version_name}</span><Download size={13} /></button>

))}

</AssetTreeGroup>

<AssetTreeGroup title="Python 环境" icon={Cpu} count={pythonEnvs.length} defaultOpen>

{pythonEnvs.map((env) => (

<button className={selectedExportAsset?.key === `env-${env.id}` ? "active" : ""} key={env.id} onClick={() => setSelectedExportAsset({ key: `env-${env.id}`, type: "Python 环境", name: env.name, href: env.source_type === "conda_pack" && env.artifact_key ? `/api/ml/python-envs/${encodeURIComponent(env.id)}/download` : "" })} onContextMenu={(event) => { event.preventDefault(); if (!env.artifact_key) return; const anchor = document.createElement("a"); anchor.href = `/api/ml/python-envs/${encodeURIComponent(env.id)}/download`; anchor.click(); }} title={env.artifact_key ? "左键选择，右键快捷导出 tar" : "此环境没有可导出的 conda-pack 资产"}><Cpu size={14} /><span>{env.name}</span><em>{env.artifact_key ? env.status : "不可导出"}</em></button>

))}

</AssetTreeGroup>

{selectedExportAsset && <div className="asset-export-selection"><div><span>{selectedExportAsset.type}</span><b title={selectedExportAsset.name}>{selectedExportAsset.name}</b></div><button type="button" disabled={!selectedExportAsset.href} onClick={exportSelectedAsset} title={selectedExportAsset.href ? `导出${selectedExportAsset.name}` : "该资产没有可下载归档"}><Download size={15} />{selectedExportAsset.href ? "导出" : "无归档"}</button></div>}

<div className="resource-usage asset-usage">

<div><span>存储使用</span><b>68%</b></div>

<progress value="68" max="100" />

<em>20 / 29 TB</em>

</div>

</aside>

<main className="asset-main">

<div className="asset-toolbar">

<div className="workspace-path-row">

<FolderOpen size={16} />

<button>{"\u8d44\u4ea7"}</button>

<ChevronRight size={14} />

<button>模型</button>

<ChevronRight size={14} />

<button>YOLOv8</button>

</div>

<div className="workspace-commandbar asset-commandbar">

<button onClick={() => setDrawerMode("cluster")}><span>+</span>登记模型</button>

<button onClick={() => setDrawerMode("version")}><Download size={15} />导入预训练权重</button>

<button onClick={() => setDrawerMode("version")}><span>+</span>登记模型版本</button>

<button onClick={() => setDrawerMode("algorithm")}><span>+</span>导入算法适配</button>

<button onClick={() => setDrawerMode("env")}><span>+</span>登记Python 环境</button>

<button><RefreshCw size={15} />刷新</button>

</div>

</div>

<div className="asset-filterbar">

<label className="search-control"><Search size={15} /><input placeholder="搜索资产" /></label>

<select><option>类型：全</option></select>

<select><option>状态：全部</option></select>

<select><option>框架：全</option></select>

</div>

<section className="asset-overview">

<h2>资产概览</h2>

<div className="asset-overview-grid">

{stats.map(([label, value, Icon]) => (

<article key={label}>

<Icon size={24} />

<span>{label}</span>

<b>{value}</b>

</article>

))}

</div>

</section>

<section className="asset-section">

<h2>模型簇与版本</h2>

<div className="asset-table model-asset-table">

<div className="asset-table-head"><span>资产名称</span><span>算法名称</span><span>训练数据</span><span>生成时间</span><span>状态</span><span>MinIO路径</span><span>操作</span></div>

{familyRows.map((family) => (

<React.Fragment key={family.family}>

<div className="asset-table-row family-row">

<b><ChevronDown size={13} /><FolderOpen size={15} />{family.family}</b>

<span>{family.models[0]?.framework || "Ultralytics YOLO"}</span><span>--</span><span>--</span><em>正常</em><span>minio://models/{family.family.toLowerCase()}/</span><AssetActionButtons />

</div>

{family.versions.map((version) => (

<div className="asset-table-row child-row" key={version.id}>

<b><span className="tree-spacer" /><Brain size={14} />{version.version_name}</b>

<span>{version.model_name || family.family}</span><span>{version.dataset_project_name || "未绑定数据集"}</span><span>{formatDateTime(version.created_at)}</span><em>正常</em><span>{version.artifact_root || `minio://models/${family.family.toLowerCase()}/`}</span>

<div className="asset-actions"><button title="查看"><Eye size={13} /></button><button title="重命名" onClick={() => renameModelVersion(version)}><Edit3 size={13} /></button><button title="更多"><MoreVertical size={13} /></button></div>

</div>

))}

</React.Fragment>

))}

</div>

</section>

<section className="asset-section">

<h2>运行环境资产</h2>

<div className="asset-table env-asset-table">

<div className="asset-table-head"><span>Python 环境名称</span><span>Python版本</span><span>Torch版本</span><span>CUDA/CPU</span><span>状态</span><span>创建时间</span><span>资产包路径</span><span>操作</span></div>

{pythonEnvs.map((env) => (

<div className="asset-table-row" key={env.id} title={envTooltip(env)}>

<b>{env.name}</b><span>{String(env.python_version || "3.12").replace(/^Python\s*/i, "")}</span><span>{env.torch_version || "未检"}</span><span>{env.cuda_available ? `CUDA ${env.cuda_version || ""}` : "CPU"}</span><em>可用</em><span>{formatDateTime(env.created_at)}</span><span>{env.source_type === "conda_pack" ? env.artifact_key : env.python_path}</span><AssetActionButtons />

</div>

))}

</div>

</section>

<section className="asset-section">

<h2>算法适配</h2>

<div className="asset-table adapter-asset-table">

<div className="asset-table-head"><span>适配器名</span><span>框架</span><span>任务类型</span><span>版本</span><span>MinIO代码前缀</span><span>状态</span><span>操作</span></div>

{algorithms.map((algorithm) => (

<div className="asset-table-row" key={algorithm.id || algorithm.name}>

<b>{algorithm.name}</b><span>{algorithm.framework || "Custom"}</span><span>{algorithm.task_type || "目标检测"}</span><span>{algorithm.version || "builtin"}</span><span>{algorithm.minio_prefix || algorithm.manifest_key || `minio://adapters/${algorithm.algorithm_key || algorithm.template_key || "custom"}/`}</span><em>可用</em><AssetActionButtons />

</div>

))}

</div>

</section>

</main>

<aside className="asset-inspector">

<div className="inspector-title"><h2>资产统计</h2><button><RefreshCw size={14} /></button></div>

<div className="asset-stat-grid">

<div><span>总资产</span><b>{algorithms.length + familyRows.length + modelVersions.length + pythonEnvs.length}</b><Boxes size={24} /></div>

<div><span>MinIO对象</span><b>{Math.max(42, modelVersions.length + pythonEnvs.length + algorithms.length)}</b><Database size={24} /></div>

<div><span>预训练权重</span><b>{modelVersions.filter((version) => !version.training_job_id || version.stage === "pretrained").length}</b><Brain size={24} /></div>

<div><span>可运行环境</span><b>{pythonEnvs.filter((env) => env.status === "ready").length || pythonEnvs.length}</b><Cpu size={24} /></div>

</div>

<section className="activity-panel">

<div className="panel-title"><h3>最近活</h3><button>查看全部</button></div>

{recentItems.map(([title, detail, time, user, Icon]) => (

<article className="activity-row" key={`${title}-${detail}`}>

<Icon size={15} />

<div><b>{title}</b><span>{detail}</span></div>

<em>{time}<br />{user}</em>

</article>

))}

</section>

</aside>

{drawerMode && (

<AssetDrawer

mode={drawerMode}

setMode={setDrawerMode}

onClose={() => setDrawerMode(null)}

mlModels={mlModels}

modelForm={modelForm}

setModelForm={setModelForm}

versionForm={versionForm}

setVersionForm={setVersionForm}

envForm={envForm}

setEnvForm={setEnvForm}

createModel={createModel}

createModelVersion={createModelVersion}

createPythonEnv={createPythonEnv}

/>

)}

</div>

);

}

function AssetModelFamilyTree({ families, onSelect }) {

const [modelGroupOpen, setModelGroupOpen] = useState(true);

const [expandedFamilies, setExpandedFamilies] = useState(() => new Set(families.map((family) => family.family)));

const [expandedVersions, setExpandedVersions] = useState(() => new Set());

const [contextMenu, setContextMenu] = useState(null);

useEffect(() => {

if (!contextMenu) return undefined;

const close = () => setContextMenu(null);

const closeOnEscape = (event) => { if (event.key === "Escape") close(); };

window.addEventListener("click", close);

window.addEventListener("blur", close);

window.addEventListener("keydown", closeOnEscape);

return () => {

window.removeEventListener("click", close);

window.removeEventListener("blur", close);

window.removeEventListener("keydown", closeOnEscape);

};

}, [contextMenu]);

const toggleFamily = (familyName) => {

setExpandedFamilies((current) => {

const next = new Set(current);

if (next.has(familyName)) next.delete(familyName);

else next.add(familyName);

return next;

});

};

const toggleVersion = (versionId) => {

setExpandedVersions((current) => {

const next = new Set(current);

if (next.has(versionId)) next.delete(versionId);

else next.add(versionId);

return next;

});

};

const openContextMenu = (event, node) => {

event.preventDefault();

event.stopPropagation();

setContextMenu({ ...node, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 120) });

};

const downloadVersion = (version, artifact = null) => {

if (!version?.id) return;

const query = artifact?.id ? `?artifactId=${encodeURIComponent(artifact.id)}` : "";

const anchor = document.createElement("a");

anchor.href = `/api/ml/model-versions/${encodeURIComponent(version.id)}/download${query}`;

anchor.download = "";

document.body.appendChild(anchor);

anchor.click();

anchor.remove();

setContextMenu(null);

};

return (

<>

<section className="asset-tree-group asset-model-tree">

<button className="asset-tree-head" type="button" onClick={() => setModelGroupOpen((open) => !open)}>

{modelGroupOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

<Database size={15} />

<b>模型</b>

<em>{families.length}</em>

</button>

{modelGroupOpen && <div className="asset-tree-children">

{families.map((family) => {

const open = expandedFamilies.has(family.family);

return (

<div className="asset-family-node" key={family.family}>

<button className="asset-family-row" title="左键选择模型簇，右键下载最新模型" onClick={() => { toggleFamily(family.family); const latest = family.versions[0]; if (latest) onSelect?.({ key: `model-${latest.id}`, type: "模型簇最新权重", name: family.family, href: `/api/ml/model-versions/${encodeURIComponent(latest.id)}/download` }); }} onContextMenu={(event) => openContextMenu(event, { type: "family", family, version: family.versions[0] || null })}>

<span className="tree-toggle">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>

{open ? <FolderOpen size={14} /> : <Folder size={14} />}

<span>{family.family}</span>

<em>{family.versions.length}</em>

</button>

{open && family.versions.map((version) => {

const artifacts = Array.isArray(version.artifacts) ? version.artifacts : [];

const versionOpen = expandedVersions.has(version.id);

return (

<React.Fragment key={version.id}>

<button className="depth-1 asset-version-row" title={`${version.training_job_id ? "训练任务产物" : "预训练版本"} · 右键下载模型权重`} onClick={() => { onSelect?.({ key: `model-${version.id}`, type: "模型权重", name: `${version.model_name || "模型"} / ${version.version_name}`, href: `/api/ml/model-versions/${encodeURIComponent(version.id)}/download` }); if (artifacts.length) toggleVersion(version.id); }} onContextMenu={(event) => openContextMenu(event, { type: "version", version })}>

{artifacts.length ? (versionOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <Brain size={13} />}<span>{version.version_name}<small>{version.training_job_id ? "训练任务" : "预训练"}</small></span><em>{artifacts.length} 文件</em>

</button>

{versionOpen && artifacts.map((artifact) => (

<button className="depth-2 asset-artifact-row" key={artifact.id} title="右键下载此文件" onClick={() => onSelect?.({ key: `artifact-${artifact.id}`, type: "模型文件", name: artifact.metadata_json?.relativePath || artifact.name || artifact.path?.split("/").pop() || "模型权重", href: `/api/ml/model-versions/${encodeURIComponent(version.id)}/download?artifactId=${encodeURIComponent(artifact.id)}` })} onContextMenu={(event) => openContextMenu(event, { type: "artifact", version, artifact })}>

<Download size={12} /><span>{artifact.metadata_json?.relativePath || artifact.name || artifact.path?.split("/").pop() || "模型权重"}</span><em>{Number(artifact.size || 0) >= 1048576 ? `${(Number(artifact.size) / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(Number(artifact.size || 0) / 1024))} KB`}</em>

</button>

))}

</React.Fragment>

);

})}

</div>

);

})}

{!families.length && <p className="resource-empty">暂无模型</p>}

</div>}

</section>

{contextMenu && (

<div className="model-tree-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}>

<strong>{contextMenu.type === "family" ? contextMenu.family.family : contextMenu.artifact?.metadata_json?.relativePath || contextMenu.version?.version_name}</strong>

<button role="menuitem" disabled={!contextMenu.version?.id} onClick={() => downloadVersion(contextMenu.version, contextMenu.artifact)}><Download size={14} /><span>{contextMenu.type === "artifact" ? "下载此权重文件" : "下载模型权重"}</span></button>

{!contextMenu.version?.id && <small>该模型簇暂无可下载权重</small>}

</div>

)}

</>

);

}

function AssetTreeGroup({ title, icon: Icon, count, defaultOpen = false, children }) {

const [open, setOpen] = useState(defaultOpen);

return (

<section className="asset-tree-group">

<button className="asset-tree-head" onClick={() => setOpen(!open)}>

{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

<Icon size={15} />

<b>{title}</b>

<em>{count}</em>

</button>

{open && <div className="asset-tree-children">{children}</div>}

</section>

);

}

function AssetActionButtons() {

return (

<div className="asset-actions">

<button title="查看"><Eye size={13} /></button>

<button title="编辑"><Edit3 size={13} /></button>

<button title="更多"><MoreVertical size={13} /></button>

</div>

);

}

function AssetDrawer({

  mode,

  setMode,

  onClose,

  projects = [],

  mlModels,

  modelForm,

  setModelForm,

  versionForm,

  setVersionForm,

  envForm,

  setEnvForm,

  createModel,

  createModelVersion,

  createPythonEnv,

}) {

  const drawerTitle = {

    cluster: "登记模型",

    version: "登记模型版本",

    algorithm: "导入算法适配",

    env: "登记Python 环境",

  }[mode] || "登记资产";

  const drawerSubtitle = mode === "version"

    ? "将权重文件登记为模型资产并存入 MinIO"

    : mode === "algorithm"

      ? "将算法源码、入口文件和默认参数注册为统一适配" : mode === "env"

        ? "登记 Python 运行环境，供训练和推理任务复" : "登记为平台统一资产，供训练和推理调";

  const submit = () => {

    if (mode === "cluster") createModel();

    if (mode === "version") createModelVersion();

    if (mode === "env") createPythonEnv();

    if (mode === "algorithm") window.alert("算法适配器导入接口待接入，当前已完成界面布局");

  };

  return (

    <aside className="asset-drawer" role="dialog" aria-modal="true" aria-label={drawerTitle}>

      <div className="drawer-head">

        <div>

          <h2>{drawerTitle}</h2>

          <p>{drawerSubtitle}</p>

        </div>

        <button className="drawer-close" onClick={onClose} aria-label="关闭"><X size={17} /></button>

      </div>

      <div className="drawer-tabs">

        <button type="button" className={mode === "cluster" ? "active" : ""} onClick={() => setMode("cluster")}>模型</button>

        <button type="button" className={mode === "version" ? "active" : ""} onClick={() => setMode("version")}>模型版本</button>

        <button type="button" className={mode === "algorithm" ? "active" : ""} onClick={() => setMode("algorithm")}>算法适配</button>

        <button type="button" className={mode === "env" ? "active" : ""} onClick={() => setMode("env")}>Python 环境</button>

      </div>

      <div className="drawer-body">

        {mode === "cluster" && (

          <>

            <DrawerField label="模型簇名"><input value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} placeholder="YOLOv8" /></DrawerField>

            <DrawerField label="任务类型"><select value={modelForm.taskType} onChange={(e) => setModelForm({ ...modelForm, taskType: e.target.value })}><option value="detect">目标检测</option><option value="segment">实例分割</option><option value="classify">分类</option></select></DrawerField>

            <DrawerField label="算法名称"><input value={modelForm.framework} onChange={(e) => setModelForm({ ...modelForm, framework: e.target.value })} placeholder="ultralytics" /></DrawerField>

            <DrawerField label="说明" tall><textarea value={modelForm.description} onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })} placeholder="模型簇用途、适用场景、版本策" /></DrawerField>

          </>

        )}

        {mode === "version" && (

          <>

            <DrawerField label="所属模型簇"><select value={versionForm.modelId} onChange={(e) => setVersionForm({ ...versionForm, modelId: e.target.value })}><option value="">请选择模型</option>{mlModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></DrawerField>

            <DrawerField label="版本名称"><input value={versionForm.versionName} onChange={(e) => setVersionForm({ ...versionForm, versionName: e.target.value })} placeholder="yolov8n_ultralytics_8.4.80_cpu" /></DrawerField>

            <DrawerField label="权重来源"><div className="drawer-segment"><button className="active" type="button">本地路径</button><button type="button">MinIO路径</button><button type="button">训练产物</button></div></DrawerField>

            <DrawerField label="权重文件路径"><DrawerInputWithIcon value={versionForm.sourcePath} onChange={(e) => setVersionForm({ ...versionForm, sourcePath: e.target.value })} placeholder="C:\\Users\\Administrator\\Downloads\\v8_s.pt" /></DrawerField>

            <DrawerField label="训练数据"><select value={versionForm.datasetProjectId || ""} onChange={(e) => setVersionForm({ ...versionForm, datasetProjectId: e.target.value })}><option value="">请选择训练数据</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></DrawerField>

            <DrawerField label="阶段"><select value={versionForm.stage} onChange={(e) => setVersionForm({ ...versionForm, stage: e.target.value })}><option value="pretrained">pretrained</option><option value="candidate">candidate</option><option value="published">published</option></select></DrawerField>

            <DrawerField label="说明" tall><textarea value={versionForm.description || ""} onChange={(e) => setVersionForm({ ...versionForm, description: e.target.value })} placeholder="请输入说明（可选）" maxLength={500} /></DrawerField>

            <DrawerField label="MinIO目标路径"><DrawerInputWithIcon readOnly copyIcon value={`assets/models/${versionForm.versionName || "model-version"}/best.pt`} /></DrawerField>

            <div className="auto-parse-card"><h3>自动解析</h3><p><span>文件大小</span><b>--</b></p><p><span>SHA256</span><b>提交后计</b></p><p><span>框架</span><b>Ultralytics</b></p><p><span>任务</span><b>detect</b></p></div>

          </>

        )}

        {mode === "algorithm" && (

          <>

            <DrawerField label="适配器名"><input placeholder="Ultralytics YOLO" /></DrawerField>

            <DrawerField label="算法 key"><input placeholder="ultralytics_yolo" /></DrawerField>

            <DrawerField label="框架"><select><option>Ultralytics</option><option>PyTorch</option><option>Custom</option></select></DrawerField>

            <DrawerField label="代码来源"><DrawerInputWithIcon placeholder="本地文件夹 / zip 包 / Git 地址" /></DrawerField>

            <DrawerField label="入口文件"><input placeholder="adapter.py" /></DrawerField>

            <DrawerField label="默认参数" tall><textarea placeholder='{"conf":0.25,"iou":0.7}' /></DrawerField>

            <div className="auto-parse-card"><h3>适配器检</h3><p><span>接口</span><b>统一 Adapter</b></p><p><span>数据加载</span><b>DatasetLoader</b></p><p><span>任务</span><b>detect</b></p></div>

          </>

        )}

        {mode === "env" && (

          <>

            <DrawerField label="来源类型"><select value={envForm.sourceType} onChange={(e) => setEnvForm({ ...envForm, sourceType: e.target.value })}><option value="conda_pack">conda-pack 环境包入 MinIO</option><option value="server_managed">服务器托管 Python</option></select></DrawerField>

            <DrawerField label="环境"><input value={envForm.name} onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })} placeholder="留空自动生成 py3.12-torch2.12-cpu" /></DrawerField>

            {envForm.sourceType === "server_managed" || envForm.sourceType === "server_python" ? (

              <DrawerField label="Python 路径"><DrawerInputWithIcon value={envForm.pythonPath} onChange={(e) => setEnvForm({ ...envForm, pythonPath: e.target.value })} placeholder="D:\\Program Files\\miniforge3\\envs\\yolo\\python.exe" /></DrawerField>

            ) : (

              <DrawerField label="环境包路"><DrawerInputWithIcon value={envForm.condaPackPath} onChange={(e) => setEnvForm({ ...envForm, condaPackPath: e.target.value })} placeholder="E:\\projects\\DD-runtime\\minio\\zbh-datasets\\envs\\yolo.tar.gz" /></DrawerField>

            )}

            {envForm.sourceType === "conda_pack" && (<DrawerField label="解包后路径"><input value={envForm.unpackPath} onChange={(e) => setEnvForm({ ...envForm, unpackPath: e.target.value })} placeholder="可留空；默认解包到 MinIO envs/python 目录" /></DrawerField>)}

            <div className="auto-parse-card"><h3>检测结</h3><p><span>Python</span><b>提交后检</b></p><p><span>Torch</span><b>提交后检</b></p><p><span>CUDA</span><b>提交后检</b></p></div>

          </>

        )}

      </div>

      <div className="drawer-actions">

        <button onClick={onClose}>取消</button>

        <button className="primary" onClick={submit}>{drawerTitle}</button>

      </div>

    </aside>

  );

}

function DrawerField({ label, tall = false, children }) {

  return <label className={`drawer-field ${tall ? "tall" : ""}`}><span>{label}</span>{children}</label>;

}

function DrawerInputWithIcon({ copyIcon = false, ...inputProps }) {

  const Icon = copyIcon ? Copy : FolderOpen;

  return (

    <span className="drawer-input-with-icon">

      <input {...inputProps} />

      <button type="button" aria-label={copyIcon ? "复制路径" : "选择路径"}><Icon size={15} /></button>

    </span>

  );

}

const evaluationPalette = { pr: "#0d8f89", f1: "#7c3aed", precision: "#f59e0b", recall: "#2563eb" };

const evaluationBarPalette = ["#0d8f89", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#10b981", "#06b6d4", "#f97316"];

function EvaluationCurve({ kind = "pr", curves = [] }) {

const points = curves.length ? curves : [{ confidence: 0, precision: 0, recall: 0, f1: 0 }];

const xValue = (row) => kind === "pr" ? Number(row.recall || 0) : Number(row.confidence || 0);

const yValue = (row) => kind === "pr" ? Number(row.precision || 0) : Number(row[kind] || 0);

const ordered = kind === "pr" ? points.slice().sort((a, b) => xValue(a) - xValue(b)) : points;

const stroke = evaluationPalette[kind] || evaluationPalette.pr;

const path = ordered.map((row, index) => {

const x = 38 + Math.max(0, Math.min(1, xValue(row))) * 372;

const y = 202 - Math.max(0, Math.min(1, yValue(row))) * 178;

return (index ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);

}).join(" ");

return (

<svg className={`evaluation-chart-svg chart-${kind}`} viewBox="0 0 430 224" preserveAspectRatio={kind === "pr" ? "xMidYMid meet" : "none"} aria-hidden="true">

{[60, 95, 131, 166].map((y) => <line key={"y" + y} x1="38" y1={y} x2="410" y2={y} />)}

{[100, 162, 224, 286, 348].map((x) => <line key={"x" + x} x1={x} y1="24" x2={x} y2="202" />)}

<line className="axis" x1="38" y1="202" x2="410" y2="202" />

<line className="axis" x1="38" y1="24" x2="38" y2="202" />

{[0, .2, .4, .6, .8, 1].map((value, index) => <text key={"xt" + index} x={38 + index * 74.4} y="214" textAnchor="middle">{value.toFixed(1)}</text>)}

{[0, .2, .4, .6, .8, 1].map((value, index) => <text key={"yt" + index} x="32" y={202 - index * 35.6} textAnchor="end">{value.toFixed(1)}</text>)}

{kind === "pr" && <><text className="axis-title" x="224" y="221" textAnchor="middle">Recall</text><text className="axis-title" x="9" y="113" textAnchor="middle" transform="rotate(-90 9 113)">Precision</text></>}

<path d={path} style={{ stroke }} />

</svg>

);

}

function EvaluationConfusionMatrix({ matrix }) {

const labels = matrix?.labels || [];

const values = matrix?.values || [];

const maxValue = Math.max(1, ...values.flat());

if (!labels.length) return <div className="empty-state">当前任务没有可用的混淆矩阵</div>;

return (

<div className="evaluation-live-matrix" style={{ "--matrix-size": labels.length }}>

<div className="matrix-corner">真实 / 预测</div>

{labels.map((label) => <b key={"head-" + label}>{label}</b>)}

{labels.map((truth, rowIndex) => (

<React.Fragment key={truth}>

<b>{truth}</b>

{labels.map((predicted, columnIndex) => {

const value = Number(values[rowIndex]?.[columnIndex] || 0);

const ratio = value / maxValue;

return <button key={truth + "-" + predicted} title={"真实" + truth + "；预测：" + predicted + "；数量：" + value} style={{ background: "rgba(15,157,151," + (0.08 + ratio * .82).toFixed(2) + ")" }}>{value}</button>;

})}

</React.Fragment>

))}

</div>

);

}

function evaluationErrorBoxes(row = {}, filter = "false_negative") {

  const errors = Array.isArray(row.errors) ? row.errors : [];

  const selected = errors.filter((item) => !filter || item.type === filter);

  if (!selected.length) return predictionItems(row.predictions_json).slice(0, 3).map((prediction) => ({ type: "prediction", item: prediction, label: prediction.label || "目标" }));

  return selected.flatMap((error) => {

    if (error.type === "false_negative" && error.groundTruth) return [{ type: "false_negative", item: error.groundTruth, label: error.groundTruth.label || "漏检" }];

    if (error.type === "false_positive" && error.prediction) return [{ type: "false_positive", item: error.prediction, label: error.prediction.label || "误检" }];

    const rows = [];

    if (error.groundTruth) rows.push({ type: error.type + " ground", item: error.groundTruth, label: error.groundTruth.label || "真实" });

    if (error.prediction) rows.push({ type: error.type + " prediction", item: error.prediction, label: error.prediction.label || "预测" });

    return rows;

  });

}

function EvaluationSampleViewer({ rows = [], initialIndex = 0, filter, onClose }) {

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

  const boxes = evaluationErrorBoxes(row, filter);

  return (

    <div className={`viewer-overlay evaluation-sample-dialog viewer-${viewerTheme}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>

      <div className="viewer-toolbar">

        <div><b>错误样本检</b><span>{row.display_name || "未命名图"}</span></div>

        <span className="viewer-counter">{index + 1} / {rows.length}</span>

        <em>{filter === "false_negative" ? "漏检" : filter === "false_positive" ? "误检" : filter === "localization" ? "定位偏差" : "类别错误"}</em>

        <button className="viewer-theme-toggle" onClick={() => setViewerTheme((value) => value === "dark" ? "light" : "dark")} title="切换查看器明暗模"><Sun size={17} /></button>

        <button onClick={onClose} title="关闭"><X size={18} /></button>

      </div>

      <button className="viewer-page-button viewer-page-prev" disabled={index <= 0} onClick={() => move(-1)} title="上一"><ChevronRight size={28} /></button>

      <div className="viewer-stage">

        <div className="evaluation-sample-large">

          {imageSrc && !imageFailed ? <img src={imageSrc} draggable="false" alt={row.display_name || "错误样本"} onError={() => setImageFailed(true)} /> : <div className="evaluation-sample-load-error"><ImageIcon size={34} /><b>图片加载失败</b><span>{imageId ? `图片索引：${imageId}` : "该记录没有关联图片索"}</span></div>}

          {boxes.map((box, boxIndex) => {

            const style = predictionBoxStyle(box.item, row);

            return style ? <i className={`sample-box ${box.type}`} key={boxIndex} style={style}><small>{box.label}</small>{box.type.includes("false_positive") && <strong>×</strong>}</i> : null;

          })}

        </div>

      </div>

      <button className="viewer-page-button viewer-page-next" disabled={index >= rows.length - 1} onClick={() => move(1)} title="下一"><ChevronRight size={28} /></button>

    </div>

  );

}
function EvaluationPage({ tasks, selectedTaskId, setSelectedTaskId }) {

const [searchText, setSearchText] = useState("");

const [statusFilter, setStatusFilter] = useState("all");

const [previewRows, setPreviewRows] = useState([]);

const [evaluation, setEvaluation] = useState(null);

const [activeAnalysis, setActiveAnalysis] = useState("overview");

const [errorFilter, setErrorFilter] = useState("false_negative");
  const [sampleOffset, setSampleOffset] = useState(0);
  const [sampleViewer, setSampleViewer] = useState(null);

useEffect(() => {

if (!tasks.length) return;

if (!tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(tasks[0]?.id || "");

}, [tasks, selectedTaskId]);

const filteredTasks = tasks.filter((task) => {

const status = String(task.sourceJob?.status || "").toLowerCase();

const statusMatch = statusFilter === "all" || (statusFilter === "done" ? completedEvaluationStatuses.has(status) : status === "failed");

const query = searchText.trim().toLowerCase();

return statusMatch && (!query || task.name.toLowerCase().includes(query) || String(task.sourceJob?.dataset_project_name || "").toLowerCase().includes(query));

});

const selectedTask = tasks.find((task) => task.id === selectedTaskId) || filteredTasks[0] || tasks[0];

const selectedJob = selectedTask?.sourceJob || {};

const storedMetrics = parseMaybeJson(selectedJob.metrics_json);

useEffect(() => {

if (!selectedJob.id) {

setPreviewRows([]);

setEvaluation(null);

return;

}

let ignore = false;

Promise.all([

fetch("/api/ml/inference-jobs/" + selectedJob.id + "/results").then((response) => response.json()),

fetch("/api/ml/inference-jobs/" + selectedJob.id + "/evaluation").then((response) => response.json()),

]).then(([resultsData, evaluationData]) => {

if (ignore) return;

setPreviewRows(resultsData.results || []);

setEvaluation(evaluationData.evaluation || null);

}).catch(() => {

if (ignore) return;

setPreviewRows([]);

setEvaluation(null);

});

return () => { ignore = true; };

}, [selectedJob.id]);

const metrics = { ...storedMetrics, ...(evaluation?.summary || {}), avg_iou: evaluation?.summary?.avgIou ?? storedMetrics.avg_iou };

const doneCount = tasks.filter((task) => completedEvaluationStatuses.has(String(task.sourceJob?.status || "").toLowerCase())).length;

const failedCount = tasks.filter((task) => String(task.sourceJob?.status || "").toLowerCase() === "failed").length;

const imageCount = metrics.images ?? selectedJob.image_count ?? previewRows.length ?? 0;

const predictionCount = metrics.predictions ?? selectedJob.prediction_count ?? previewRows.reduce((sum, row) => sum + predictionItems(row.predictions_json).length, 0);

const kpis = [

["Precision", formatMetric(metrics.precision)],

["Recall", formatMetric(metrics.recall)],

["F1", formatMetric(metrics.f1)],

["mAP50", formatMetric(metrics.map50)],

["mAP50-95", formatMetric(metrics.map)],

["Avg IoU", formatMetric(metrics.avg_iou)],

["推荐阈值", evaluation?.summary ? Number(evaluation.summary.recommendedConfidence || 0).toFixed(2) : "--"],

];

const allClassRows = (evaluation?.perClass || []).slice().sort((a, b) => Number(b.ap50 || 0) - Number(a.ap50 || 0));

  const classRows = allClassRows.slice(0, 8);

const rankRows = allClassRows.length > 8 && allClassRows.slice(0, 8).every((row) => Number(row.ap50 || 0) >= 0.995)

? [...allClassRows.slice(0, 4), ...allClassRows.slice(-4)].filter((row, index, rows) => rows.findIndex((item) => item.label === row.label) === index)

: classRows;

const curves = evaluation?.curves || [];

  const weakestClass = allClassRows.filter((row) => Number.isFinite(Number(row.ap50))).slice().sort((a, b) => Number(a.ap50) - Number(b.ap50))[0];

const insightRows = evaluation?.evaluated ? [

weakestClass ? weakestClass.label + " 的 AP50 最低，为 " + formatMetric(weakestClass.ap50) + "" : "暂无类别级结论",

"当前漏检 " + formatCount(evaluation.summary?.fn || 0) + " 个，误检 " + formatCount(evaluation.summary?.fp || 0) + " 个",

"平均匹配 IoU 为 " + formatMetric(evaluation.summary?.avgIou || 0) + "",

"推荐置信度阈值为 " + Number(evaluation.summary?.recommendedConfidence || 0).toFixed(2) + "",

] : [evaluation?.reason || "正在计算真实评估结果"];

const problemCounts = (evaluation?.errors || []).reduce((result, row) => ({

false_negative: result.false_negative + Number(row.counts?.false_negative || 0),

false_positive: result.false_positive + Number(row.counts?.false_positive || 0),

localization: result.localization + Number(row.counts?.localization || 0),

class_error: result.class_error + Number(row.counts?.class_error || 0),

}), { false_negative: 0, false_positive: 0, localization: 0, class_error: 0 });

const errorRows = (evaluation?.errors || []).filter((row) => Number(row.counts?.[errorFilter] || 0) > 0);

const samples = (errorRows.length ? errorRows : previewRows).slice(0, 5);

const visibleSampleRows = errorRows.length ? errorRows : previewRows;
  const sampleWindow = visibleSampleRows.slice(sampleOffset, sampleOffset + 5);
  const shiftSamples = (delta) => setSampleOffset((value) => Math.max(0, Math.min(Math.max(0, visibleSampleRows.length - 5), value + delta)));
  const errorTabs = [["false_negative", "漏检"], ["false_positive", "误检"], ["localization", "定位偏差"], ["class_error", "类别错误"]];

return (

<div className="evaluation-viz-workspace">

<aside className="evaluation-runs">

<div className="evaluation-runs-head"><h2>推理记录</h2><button title="筛"><SlidersHorizontal size={14} /></button></div>

<label className="evaluation-run-search"><Search size={14} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索任务名称或数据集" /></label>

<div className="evaluation-status-tabs">

<button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>全部</button>

<button className={statusFilter === "done" ? "active" : ""} onClick={() => setStatusFilter("done")}>已完</button>

<button className={statusFilter === "failed" ? "active" : ""} onClick={() => setStatusFilter("failed")}>失败</button>

</div>

<div className="evaluation-run-list">

{filteredTasks.map((task) => {

const job = task.sourceJob || {};

const active = task.id === selectedTask?.id;

const done = completedEvaluationStatuses.has(String(job.status || "").toLowerCase());

const rowMetrics = parseMaybeJson(job.metrics_json);

return (

<button className={"evaluation-run-row " + (active ? "active" : "")} key={task.id} onClick={() => setSelectedTaskId(task.id)}>

<span className="evaluation-run-check">{active ? <CheckCircle2 size={14} /> : <span />}</span>

<span className="evaluation-run-content">

<b>{task.name}</b><small>数据集：{job.dataset_project_name || "未绑"}</small><small>模型：{job.model_name || "未指"}</small>

<small>完成时间：{formatDateTime(job.finished_at || job.created_at)}</small>

<em>{formatCount(rowMetrics.images ?? job.image_count ?? 0)} 张图　|　{formatCount(rowMetrics.predictions ?? job.prediction_count ?? 0)} 个预测</em>

</span>

<i className={done ? "done" : "failed"}>{done ? "已完" : runStatusLabel(job.status)}</i>

</button>

);

})}

{!filteredTasks.length && <div className="empty-state">暂无推理记录</div>}

</div>

<div className="evaluation-run-footer"><span>共 {tasks.length} 条记录</span><b>已完成 {doneCount}</b><em>失败 {failedCount}</em></div>

</aside>

<main className="evaluation-viz-main">

<div className="evaluation-viz-toolbar">

<div className="workspace-path-row"><FolderOpen size={15} /><span>推理记录</span><ChevronRight size={13} /><b>{selectedTask?.name || "评估结果"}</b><ChevronRight size={13} /><b>评估结果</b></div>

<div><button><Copy size={14} />对比基线</button><button><Download size={14} />导出报告</button><button onClick={() => setSelectedTaskId(selectedJob.id)}><RefreshCw size={14} />重新评估</button><button><ArrowLeft size={14} />返回推理</button></div>

</div>

<div className="evaluation-context-strip">

<span><Database size={14} />数据集：<b>{selectedJob.dataset_project_name || "--"}</b></span><span><Brain size={14} />模型：<b>{selectedJob.model_name || "--"}</b></span>

<span><Tags size={14} />标签版本：<b>{evaluation?.labelVersionId ? String(evaluation.labelVersionId).slice(0, 8) : "--"}</b></span>

<span><ImageIcon size={14} />图像数量：<b>{formatCount(imageCount)}</b></span><span><Boxes size={14} />预测数量：<b>{formatCount(predictionCount)}</b></span>

</div>

<div className="evaluation-kpis">{kpis.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b><em className="up">{evaluation?.evaluated ? "真实评估" : "等待数据"}</em></div>)}</div>

<div className="evaluation-analysis-tabs">

{[["overview", "性能概览"], ["classes", "类别表现"], ["confusion", "混淆矩阵"], ["threshold", "阈值分布"]].map(([id, label]) => <button key={id} className={activeAnalysis === id ? "active" : ""} onClick={() => setActiveAnalysis(id)}>{label}</button>)}

</div>

<section className="evaluation-analysis-stage">

{activeAnalysis === "overview" && <div className="evaluation-overview-grid">

<article className="evaluation-pr-chart"><h3>Precision-Recall 曲线</h3><EvaluationCurve kind="pr" curves={curves} /></article>

<div className="evaluation-mini-charts">

<article><h3>F1-Confidence 曲线</h3><EvaluationCurve kind="f1" curves={curves} /></article>

<article><h3>Precision-Confidence 曲线</h3><EvaluationCurve kind="precision" curves={curves} /></article>

<article><h3>Recall-Confidence 曲线</h3><EvaluationCurve kind="recall" curves={curves} /></article>

</div>

<article className="evaluation-live-class-bars"><h3>类别 AP 排名</h3>{rankRows.map((row, index) => <p key={row.label}><span>{row.label}</span><i><b style={{ width: Number(row.ap50 || 0) * 100 + "%", background: evaluationBarPalette[index % evaluationBarPalette.length] }} /></i><em>{formatMetric(row.ap50)}</em></p>)}</article>

<article className="evaluation-histogram"><h3>置信度 / F1 分布</h3><div>{curves.map((row) => <i key={row.confidence} style={{ height: Number(row.f1 || 0) * 100 + "%" }} />)}<span style={{ left: Number(evaluation?.summary?.recommendedConfidence || 0) * 100 + "%" }}>推荐阈值</span></div></article>

</div>}

{activeAnalysis === "classes" && <div className="evaluation-class-detail">

<h3>类别指标明细</h3><div className="evaluation-class-table"><b>类别</b><b>GT</b><b>预测</b><b>TP</b><b>FP</b><b>FN</b><b>Precision</b><b>Recall</b><b>AP50</b>

{classRows.map((row) => <React.Fragment key={row.label}><span>{row.label}</span><span>{row.groundTruth}</span><span>{row.predictions}</span><span>{row.tp}</span><span>{row.fp}</span><span>{row.fn}</span><span>{formatMetric(row.precision)}</span><span>{formatMetric(row.recall)}</span><span>{formatMetric(row.ap50)}</span></React.Fragment>)}

</div></div>}

{activeAnalysis === "confusion" && <div className="evaluation-confusion-panel"><h3>混淆矩阵热力</h3><EvaluationConfusionMatrix matrix={evaluation?.confusionMatrix} /></div>}

{activeAnalysis === "threshold" && <div className="evaluation-threshold-grid">

<article><h3>F1-Confidence</h3><EvaluationCurve kind="f1" curves={curves} /></article><article><h3>Precision-Confidence</h3><EvaluationCurve kind="precision" curves={curves} /></article><article><h3>Recall-Confidence</h3><EvaluationCurve kind="recall" curves={curves} /></article>

<div className="evaluation-threshold-table"><b>阈</b><b>Precision</b><b>Recall</b><b>F1</b>{curves.filter((_, index) => index % 4 === 0).map((row) => <React.Fragment key={row.confidence}><span>{row.confidence.toFixed(2)}</span><span>{formatMetric(row.precision)}</span><span>{formatMetric(row.recall)}</span><span>{formatMetric(row.f1)}</span></React.Fragment>)}</div>

</div>}

</section>

<section className="evaluation-error-samples">

<div className="evaluation-sample-head"><h3>错误样本</h3><div>{errorTabs.map(([id, label]) => <button key={id} className={errorFilter === id ? "active" : ""} onClick={() => { setErrorFilter(id); setSampleOffset(0); }}>{label}</button>)}</div><span>{visibleSampleRows.length} </span></div>

<div className="evaluation-sample-grid">

<button className="sample-scroll prev" disabled={sampleOffset <= 0} onClick={() => shiftSamples(-1)}><ChevronRight size={18} /></button>{sampleWindow.map((row, index) => <article key={row.id || row.projectImageId || index} onDoubleClick={() => setSampleViewer({ rows: visibleSampleRows, index: sampleOffset + index })}>{row.thumb_url ? <img src={row.thumb_url} alt={row.display_name || "错误样本"} /> : <div className={"evaluation-sample-placeholder sample-" + index} />}<span>{row.display_name || "图片结果"}</span>{evaluationErrorBoxes(row, errorFilter).map((box, boxIndex) => { const style = predictionBoxStyle(box.item, row); return style ? <i className={`sample-box ${box.type}`} key={boxIndex} style={style}><small>{box.label}</small>{box.type.includes("false_positive") && <strong>×</strong>}</i> : null; })}</article>)}<button className="sample-scroll next" disabled={sampleOffset >= Math.max(0, visibleSampleRows.length - 5)} onClick={() => shiftSamples(1)}><ChevronRight size={18} /></button>

{!samples.length && <div className="empty-state">当前类型没有错误样本</div>}

</div>

</section>

</main>

<aside className="evaluation-insights">

<h2>评估洞察</h2>

<section className="evaluation-rating"><span>总体评级</span><div><b>{evaluation?.evaluated ? (Number(metrics.map50 || 0) >= .7 ? "A" : Number(metrics.map50 || 0) >= .4 ? "B" : "C") : "--"}</b><strong>{evaluation?.evaluated ? "已评" : "无标"}</strong></div><p>发布建议 <em>{Number(metrics.map50 || 0) >= .5 ? "可进入验" : "暂不建议发布"}</em></p></section>

<section className="evaluation-problems"><h3>问题统计</h3><div><p><span>漏检</span><b>{problemCounts.false_negative}</b></p><p><span>误检</span><b>{problemCounts.false_positive}</b></p><p><span>定位偏差</span><b>{problemCounts.localization}</b></p><p><span>类别错误</span><b>{problemCounts.class_error}</b></p></div></section>

<section className="evaluation-key-insights"><h3>关键结论</h3>{insightRows.map((text) => <p key={text}>{text}</p>)}</section>

<section className="evaluation-class-rank"><h3>类别表现 <span>（按 AP50）</span></h3>{rankRows.map((row, index) => <p key={row.label}><em>{index + 1}</em><span>{row.label}</span><i><b style={{ width: Number(row.ap50 || 0) * 100 + "%", background: evaluationBarPalette[index % evaluationBarPalette.length] }} /></i><strong>{formatMetric(row.ap50)}</strong></p>)}</section>

<div className="evaluation-insight-actions"><button onClick={() => setActiveAnalysis("confusion")}><Grid size={14} />查看混淆矩阵</button><button className="primary"><Download size={14} />生成评估报告</button></div>

<section className="evaluation-run-info"><h3>运行信息</h3><p><span>推理记录</span><b>{selectedTask?.name || "--"}</b></p><p><span>运行时间</span><b>{formatDateTime(selectedJob.finished_at)}</b></p><p><span>推理时长</span><b>{formatDuration(selectedJob.created_at, selectedJob.finished_at)}</b></p><p><span>评估状态</span><b>{evaluation?.evaluated ? "真实标注评估" : "等待标注"}</b></p></section>

</aside>

{sampleViewer && <EvaluationSampleViewer rows={sampleViewer.rows} initialIndex={sampleViewer.index} filter={errorFilter} onClose={() => setSampleViewer(null)} />}

</div>

);

}

function EvaluationDetailPage({ task, onBack, onRunDetail, onReport }) {

const job = task.sourceJob || {};

const params = parseMaybeJson(job.params_json);

const detailItems = [

["任务名称", task.name], ["任务ID", task.id], ["创建", task.creator], ["创建时间", task.createdAt],

["任务描述", task.description], ["模型", evaluationClusterLabels[task.cluster] || task.cluster],

["算法名称", job.template_name || params.templateName || "默认推理算法"],

["加载权重", job.model_name ? job.model_name + " / " + (job.version_name || "版本") : "未指定模型版"],

];

return (

<div className="evaluation-detail-page">

<div className="evaluation-detail-toolbar"><button type="button" onClick={onBack}><ArrowLeft size={14} />返回测试评估</button></div>

<section className="evaluation-detail-card platform-card"><div className="section-title-row"><h2>任务详情</h2></div><div className="evaluation-detail-grid">{detailItems.map(([label, value]) => <div className="evaluation-detail-item" key={label}><span>{label}</span><b>{value || "--"}</b></div>)}</div></section>

<section className="evaluation-run-card platform-card"><div className="evaluation-run-actions"><button type="button" onClick={() => onRunDetail(task)}>推理结果</button><button type="button" onClick={() => onReport(task)}>评估报告</button></div></section>

</div>

);

}

function EvaluationReportPage({ task, onBack }) {

const [expandedAp, setExpandedAp] = useState("类别");

const classes = ["车辆", "人员", "设备", "背景"];

const matrix = [

[96, 4, 2, 1],

[5, 88, 6, 3],

[1, 7, 91, 4],

[2, 3, 5, 84],

];

const maxValue = Math.max(...matrix.flat());

const metrics = [

["mAP@0.5", "92.6%"],

["mAP@0.5:0.95", "76.4%"],

["Precision", "90.8%"],

["Recall", "88.7%"],

];

const apGroups = [

{ name: "类别", items: [["车辆", 0.94], ["人员", 0.89], ["设备", 0.86], ["背景", 0.81]] },

{ name: "场景", items: [["城区", 0.91], ["道路", 0.88], ["园区", 0.85], ["夜间", 0.79]] },

{ name: "视角", items: [["俯视", 0.9], ["平视", 0.87], ["侧视", 0.84], ["远景", 0.78]] },

{ name: "模", items: [["RGB", 0.9], ["IR", 0.83], ["融合", 0.92], ["低照", 0.77]] },

];

const activeGroup = apGroups.find((group) => group.name === expandedAp) || apGroups[0];

const reportTitle = `${task.name} 评估报告`;

return (

<div className="evaluation-report-page">

<div className="evaluation-detail-toolbar">

<button type="button" onClick={onBack}><ArrowLeft size={14} />返回任务详情</button>

</div>

<div className="report-top-grid">

<section className="platform-card report-metrics-card">

<h2>概览指标</h2>

<p>{reportTitle}</p>

<div className="report-metric-grid">

{metrics.map(([label, value]) => (

<div className="report-metric" key={label}>

<span>{label}</span>

<b>{value}</b>

</div>

))}

</div>

</section>

<section className="platform-card confusion-card">

<h2>混淆矩阵热力</h2>

<div className="confusion-axis-label predicted">预测类别（Predicted</div>

<div className="confusion-layout">

<div className="confusion-axis-label ground">真实类别（Ground Truth</div>

<div className="confusion-grid" style={{ gridTemplateColumns: `72px repeat(${classes.length}, minmax(58px, 1fr))` }}>

<div />

{classes.map((label) => <b className="confusion-label" key={label}>{label}</b>)}

{classes.map((truth, rowIndex) => (

<React.Fragment key={truth}>

<b className="confusion-label">{truth}</b>

{classes.map((predicted, colIndex) => {

const value = matrix[rowIndex][colIndex];

const ratio = value / maxValue;

const background = rowIndex === colIndex

? `rgba(255, ${Math.round(245 - ratio * 80)}, ${Math.round(155 - ratio * 80)}, .96)`

: `rgba(${Math.round(95 + ratio * 155)}, ${Math.round(180 - ratio * 120)}, ${Math.round(220 - ratio * 170)}, .9)`;

return (

<div

className="confusion-cell"

key={`${truth}-${predicted}`}

style={{ background }}

title={`真实类别：${truth}；预测类别：${predicted}；数量：${value}`}

>

{value}

</div>

);

})}

</React.Fragment>

))}

</div>

</div>

</section>

</div>

<section className="platform-card report-ap-card">

<h2>AP </h2>

<div className="ap-card-strip">

{apGroups.map((group) => (

<button

type="button"

className={expandedAp === group.name ? "ap-dimension-card active" : "ap-dimension-card"}

key={group.name}

onClick={() => setExpandedAp(group.name)}

>

<span>{group.name}统计</span>

<b>{(group.items.reduce((sum, item) => sum + item[1], 0) / group.items.length * 100).toFixed(1)}%</b>

</button>

))}

</div>

<div className="pr-curve-panel">

<div>

<h3>{activeGroup.name}维度 PR 曲线</h3>

<p>点击上方维度卡片可切换展开内容</p>

</div>

<div className="pr-bars">

{activeGroup.items.map(([label, value]) => (

<div className="pr-row" key={label}>

<span>{label}</span>

<i><em style={{ width: `${value * 100}%` }} /></i>

<b>{(value * 100).toFixed(1)}%</b>

</div>

))}

</div>

</div>

</section>

<section className="platform-card bbox-compare-card">

<h2>预测框与标注框对</h2>

<div className="bbox-compare-stage">

<div className="bbox-image">

<div className="bbox gt one"><span>GT: 车辆</span></div>

<div className="bbox pred one"><span>Pred: 车辆 0.94</span></div>

<div className="bbox gt two"><span>GT: 人员</span></div>

<div className="bbox pred two"><span>Pred: 人员 0.87</span></div>

</div>

<div className="bbox-legend">

<span><i className="gt-color" />标注</span>

<span><i className="pred-color" />预测</span>

<p>用于快速检查预测框与人工标注框的重合程度、漏检与误检位置</p>

</div>

</div>

</section>

</div>

);

}

function MainNav({ view, goHome, openPlatform, theme, setTheme, user, onLogin, onLogout, onSettings }) {

const [userMenuOpen, setUserMenuOpen] = useState(false);

return (

<nav className="main-nav">

<div className="brand-mark">

<Boxes size={18} />

<span>Det Dashboard</span>

</div>

<div className="nav-tabs">

<button className={view === "home" ? "active" : ""} onClick={goHome}><FolderOpen size={16} />数据</button>

<button className={view === "models" ? "active" : ""} onClick={() => openPlatform("models")}><Brain size={16} />{"\u8d44\u4ea7"}</button>

<button className={view === "training" ? "active" : ""} onClick={() => openPlatform("training")}><Play size={16} />训练</button>

<button className={view === "inference" ? "active" : ""} onClick={() => openPlatform("inference")}><Cpu size={16} />推理</button>

<button className={view === "evaluation" ? "active" : ""} onClick={() => openPlatform("evaluation")}><Search size={16} />评估</button>

</div>

<div className="nav-tools">

<button title="帮助"><HelpCircle size={16} /></button>

<button title="通知"><Bell size={16} /></button>

<button title="设置" onClick={onSettings}><Settings size={16} /></button>

<button className="theme-toggle" aria-label="切换明暗模式" title="切换明暗模式" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><Sun size={16} /></button>

<div className="user-menu-wrap">
<button className="user-chip" onClick={() => user ? setUserMenuOpen((value) => !value) : onLogin()}><i>{(user?.username || "?").slice(0, 1).toUpperCase()}</i>{user?.displayName || user?.username || "未登"}<ChevronDown size={13} /></button>
{userMenuOpen && <div className="user-menu"><span>{user?.username}</span><button onClick={() => { setUserMenuOpen(false); onLogout?.(); }}>退出登</button></div>}
</div>

</div>

</nav>

);

}

function modelFamilyLabel(name = "") {

const text = String(name || "").trim();

const yolo = text.match(/\bYOLOv?(\d+)[nslmx]?\b/i) || text.match(/\byolov?(\d+)[nslmx]?\b/i);

if (yolo) return `YOLOv${yolo[1]}`;

if (/rt[-_ ]?detr/i.test(text)) return "RT-DETR";

if (/pp[-_ ]?yoloe/i.test(text)) return "PP-YOLOE";

return text || "未命名模型簇";

}

function envTooltip(env = {}) {

return [

`环境：${env.name || "未命名环境"}`,

`创建时间：${formatDateTime(env.created_at)}`,

`Python：${env.python_version || "未检测"}`,

`Torch：${env.torch_version || "未检测"}`,

`加速：${env.cuda_available ? `CUDA ${env.cuda_version || ""}` : (env.accelerator || "CPU").toUpperCase()}`,

].join("\n");

}

function versionTooltip(version = {}) {

return [

`模型：${version.model_name || "未命名模型"}`,

`版本：${version.version_name || "未命名版本"}`,

`训练数据集：${version.dataset_project_name || "未绑"}`,

`生成时间：${formatDateTime(version.created_at)}`,

].join("\n");

}

function bestAssetLink(assetLinks = [], algorithmId = "") {

return assetLinks

.filter((link) => !algorithmId || link.algorithm_asset_id === algorithmId)

.slice()

.sort((a, b) => {

const countDelta = Number(b.success_count || 0) - Number(a.success_count || 0);

if (countDelta) return countDelta;

return new Date(b.last_success_at || 0) - new Date(a.last_success_at || 0);

})[0] || null;

}

function projectTreeRows(projects = []) {

const byParent = new Map();

for (const project of projects) {

const key = project.parent_id || "";

if (!byParent.has(key)) byParent.set(key, []);

byParent.get(key).push(project);

}

const rows = [];

const visit = (parentId = "", depth = 0) => {

for (const project of byParent.get(parentId) || []) {

rows.push({ ...project, depth, hasChildren: Boolean((byParent.get(project.id) || []).length) });

if (depth < 2) visit(project.id, depth + 1);

}

};

visit();

return rows;

}

function predictionLegend(previewItems = []) {

const labels = [];

for (const item of previewItems) {

const predictions = Array.isArray(item.predictions_json) ? item.predictions_json : parseMaybeJson(item.predictions_json);

for (const prediction of Array.isArray(predictions) ? predictions : []) {

if (prediction && typeof prediction === "object" && prediction.label) labels.push(String(prediction.label));

if (typeof prediction === "string") {

const match = prediction.match(/label=([^;},]+)/);

if (match) labels.push(match[1].trim());

}

}

}

const unique = Array.from(new Set(labels));

  return unique.length ? unique : ["目标"];

}

function InferenceWorkspace({

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

moveRuntimeQueueJob,

}) {

const { columns, beginResize } = useWorkspaceColumns("det-dashboard.inference-columns", { left: 292, right: 418 });

const selectedProject = projects.find((project) => project.id === inferenceForm.datasetProjectId);

  const selectedVersion = modelVersions.find((version) => version.id === inferenceForm.modelVersionId);

  const visibleInferenceAlgorithms = inferenceAlgorithms.length ? inferenceAlgorithms : algorithmAssets;

  const selectedAlgorithm = visibleInferenceAlgorithms.find((algorithm) => algorithm.id === inferenceForm.templateId);

const sortedInferenceJobs = sortRuntimeJobsByTime(inferenceJobs);

const latestJob = sortedInferenceJobs[0];

const latestMetrics = parseMaybeJson(latestJob?.metrics_json);

const latestDone = completedEvaluationStatuses.has(String(latestJob?.status || "").toLowerCase());

const [previewRows, setPreviewRows] = useState([]);

const [evaluation, setEvaluation] = useState(null);

const [activeAnalysis, setActiveAnalysis] = useState("overview");

const [errorFilter, setErrorFilter] = useState("false_negative");
  const [sampleOffset, setSampleOffset] = useState(0);
  const [sampleViewer, setSampleViewer] = useState(null);

const [expandedGroups, setExpandedGroups] = useState(() => new Set(["算法适配", "Python 环境"]));

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

const datasetRows = projectTreeRows(projects).slice(0, 14);

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

active: project.id === inferenceForm.datasetProjectId,

title: `${project.name}\n图片：${project.image_count || 0}\n视频：${project.video_count || 0}`,

onClick: () => setField("datasetProjectId", project.id),

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

const displayJobs = sortedInferenceJobs;
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

const logLines = latestJob ? [

`[INFO] 任务已创建，任务ID：${latestJob.id?.slice(0, 12) || "infer_20250620_001"}`,

`[INFO] 加载模型 ${latestJob.model_name || selectedVersion?.model_name || "YOLOv8n"} 成功`,

`[INFO] 使用设备：${String(inferenceForm.device || "CPU").toUpperCase()}`,

`[INFO] 状态：${runStatusLabel(latestJob.status)}，进度：${latestJob.progress || 0}%`,

`[INFO] ${displayInferenceMessage(latestJob, latestMetrics)}`,

] : [

"[INFO] 等待创建推理任务",

"[INFO] 选择数据集、模型版本和算法适配器后提交",

];

return (
  <div className="inference-workspace resizable-workspace" style={{ "--workspace-left": `${columns.left}px`, "--workspace-right": `${columns.right}px` }}>
    <aside className="inference-sidebar reference-sidebar">
      <h2>推理资源</h2>
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
                  <button
                    className={`${row.active ? "active" : ""} depth-${row.depth || 0}`}
                    key={`${group.title}-${row.id}`}
                    title={row.title}
                    onClick={row.onClick}
                    style={{ "--depth": row.depth || 0 }}
                    type="button"
                  >
                    <RowIcon size={14} />
                    <span>{row.name}</span>
                    {row.badge && <i>{row.badge}</i>}
                    <em>{row.right}</em>
                  </button>
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
          <button className="primary" type="button" onClick={submitInferenceJob}><Play size={15} />开始推理</button>
          <button type="button"><Copy size={16} />批量运行</button>
          <button className="danger-outline" type="button" disabled={!sortedInferenceJobs.length} onClick={deleteInferenceQueue} title={selectedInferenceCount ? "删除选中的推理任务" : "删除全部推理任务队列"}><Trash2 size={16} />{selectedInferenceQueueLabel}</button>
          <button type="button"><RefreshCw size={16} />刷新</button>
        </div>
      </div>

      <section className="reference-builder">
        <div className="reference-section">
          <h2>数据来源</h2>
          <div className="config-row inference-task-name-row">
            <span className="row-label">任务名称</span>
            <input
              value={inferenceForm.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="请输入推理任务名称，留空则自动生成"
            />
          </div>
          <div className="config-row dataset-source-row">
            <span className="row-label">数据来源</span>
            <div className="segmented">
              <button type="button" className="active"><Database size={14} />数据集</button>
              <button type="button"><Folder size={14} />文件目录</button>
              <button type="button">文件列表</button>
            </div>
            <div className="inference-dataset-picker">
              <label className="path-select dataset-root-select">
                <FolderOpen size={15} />
                <select value={selectedRootProjectId} onChange={(e) => selectDatasetRoot(e.target.value)}>
                  <option value="">选择一级项目</option>
                  {topLevelDatasetProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
              <label className="path-select dataset-child-select">
                <Folder size={15} />
                <select value={inferenceForm.datasetProjectId} onChange={(e) => setField("datasetProjectId", e.target.value)} disabled={!selectedRootProjectId}>
                  <option value="">{selectedRootProjectId ? "选择二级数据集" : "先选择一级项目"}</option>
                  {secondLevelDatasetOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.datasetOptionLabel || project.name} · {formatCount(project.image_count || 0)} 图像
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="config-row filter-row">
            <span className="row-label">筛选条件</span>
            <select value={inferenceForm.inputViews} onChange={(e) => setField("inputViews", e.target.value)}><option value="">视角：全部</option></select>
            <select value={inferenceForm.inputScenes} onChange={(e) => setField("inputScenes", e.target.value)}><option value="">场景：全部</option></select>
            <select value={inferenceForm.inputModalities} onChange={(e) => setField("inputModalities", e.target.value)}><option value="">模式：RGB</option></select>
            <select value={inferenceForm.inputLabels} onChange={(e) => setField("inputLabels", e.target.value)}><option value="">标签：全部</option></select>
            <button type="button">清空</button>
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
            <select value={inferenceForm.modelVersionId} onChange={(e) => setField("modelVersionId", e.target.value)}>
              <option value="">请选择模型版本</option>
              {inferenceVersions.map((version) => <option key={version.id} value={version.id}>{version.model_name} / {version.version_name}</option>)}
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
        <div className="inference-table">
          <div className="inference-table-head">
            <span className="inference-task-name"><input type="checkbox" checked={allVisibleInferenceJobsSelected} onChange={toggleVisibleInferenceJobsSelection} disabled={!displayJobs.length} />任务名称</span>
            <span>数据集</span><span>模型</span><span>状态</span><span>进度</span><span>图像数</span><span>预测数</span><span>Precision</span><span>Recall</span><span>mAP50</span><span>操作</span>
          </div>
          {displayJobs.map((job) => {
            const metrics = parseMaybeJson(job.metrics_json);
            const done = completedEvaluationStatuses.has(String(job.status || "").toLowerCase());
            return (
              <div className="inference-table-row" key={job.id}>
                <b className="inference-task-name"><input type="checkbox" checked={selectedInferenceJobIds.has(job.id)} onChange={() => toggleInferenceJobSelection(job.id)} /><span>{job.name || `推理任务 ${job.id.slice(0, 8)}`}</span></b>
                <span>{job.dataset_project_name || "未绑定"}</span>
                <span>{job.model_name || selectedVersion?.model_name || "YOLOv8n"}</span>
                <em className={`status-badge status-${job.status}`}>{runStatusLabel(job.status)}</em>
                <progress value={job.progress || (done ? 100 : 0)} max="100" />
                <span>{metrics.images || job.image_count || 0}</span>
                <span>{metrics.predictions || job.prediction_count || 0}</span>
                <span>{formatMetric(metrics.precision)}</span>
                <span>{formatMetric(metrics.recall)}</span>
                <span>{formatMetric(metrics.map50)}</span>
                <div className="queue-actions">
                  <span className="queue-action-row">
                    <button type="button" disabled={!done} onClick={() => viewInferenceResults(job)}><Eye size={14} /></button>
                    <button className="restart-action" type="button" title="重新开始" onClick={() => requeueInferenceJob?.(job.id)}><RotateCcw size={15} strokeWidth={2.2} /></button>
                    <button className="danger-icon" type="button" title="删除任务" onClick={() => deleteInferenceJob(job.id)}><Trash2 size={14} /></button>
                  </span>
                  <span className="queue-priority">
                    <button type="button" title="优先级上移" onClick={(event) => { event.stopPropagation(); moveRuntimeQueueJob?.("inference", job.id, "up"); }}><ArrowUp size={13} /></button>
                    <button type="button" title="优先级下移" onClick={(event) => { event.stopPropagation(); moveRuntimeQueueJob?.("inference", job.id, "down"); }}><ArrowDown size={13} /></button>
                  </span>
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
        <h3>结果预览 <span>（最近 12 张）</span><button type="button">查看全部</button></h3>
        <div className="reference-preview-grid">
          {(previewItems.length ? previewItems : Array.from({ length: 8 }, (_, index) => ({ id: `empty-${index}`, display_name: "等待结果" }))).map((item, index) => (
            <div className={`result-thumb thumb-${index}`} key={item.id || item.display_name || index}>
              <div className="result-thumb-media">
                {item.thumb_url && <img src={item.thumb_url} alt={item.display_name || "推理结果"} loading="lazy" />}
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
                      {prediction.score != null && <small>{(Number(prediction.score) * 100).toFixed(0)}%</small>}
                    </i>
                  );
                })}
              </div>
            </div>
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
        <div>
          {logLines.concat(latestJob ? [
            `[INFO] 图片：${latestMetrics.images ?? "--"}，预测框：${latestMetrics.predictions ?? "--"}`,
            `[INFO] 输出：${latestJob.output_root || "等待生成"}`,
          ] : []).map((line, index) => <p key={index}>14:32:{String(18 + index).padStart(2, "0")} {line}</p>)}
        </div>
      </div>
    </aside>
  </div>
);
}
function JobList({ title, jobs, kind, activeId, setActiveId, onRequeue, onViewResults, onDelete, bare = false, resultReserved = false }) {

const Tag = bare ? "div" : "section";

return (

<Tag className={bare ? "job-panel" : "platform-card wide job-panel"}>

<h2>{title}</h2>

<div className="job-list">

{jobs.map((job) => (

<article className={`job-row ${activeId === job.id ? "active" : ""}`} key={job.id} onClick={() => setActiveId?.(job.id)}>

<div>

<b>{job.name}</b>

<span>{job.dataset_project_name || "未绑定数据集"} · {kind === "training" ? (job.model_name || "未绑定模") : (job.model_name ? `${job.model_name}/${job.version_name || "版本"}` : "未指定模型版")}</span>

<small>{job.message || job.status}</small>

</div>

<div className="job-status">

<strong>{job.status}</strong>

<progress value={job.progress || 0} max="100" />

<em>{new Date(job.created_at).toLocaleString()}</em>

{onRequeue && !["pending", "preparing", "running"].includes(job.status) && (

<button onClick={(event) => { event.stopPropagation(); onRequeue(job.id); }}>重新入队</button>

)}

{resultReserved && onViewResults && (

<button

className={job.status === "done" ? "result-ready" : ""}

disabled={job.status !== "done"}

title={job.status === "done" ? "查看推理结果" : "任务完成后可查看结果"}

onClick={(event) => { event.stopPropagation(); onViewResults(job); }}

>

查看结果

</button>

)}

{onDelete && (

<button className="danger-icon" title="删除任务" onClick={(event) => { event.stopPropagation(); onDelete(job.id); }}><Trash2 size={14} />删除</button>

)}

</div>

</article>

))}

{!jobs.length && <div className="empty-state">队列为空</div>}

</div>

</Tag>

);

}

function predictionBoxStyle(prediction, row) {

const imageWidth = Math.max(1, Number(row.image_width || row.width || 1));

const imageHeight = Math.max(1, Number(row.image_height || row.height || 1));

const x = Number(prediction.bbox_x ?? prediction.x ?? 0);

const y = Number(prediction.bbox_y ?? prediction.y ?? 0);

const width = Number(prediction.bbox_w ?? prediction.width ?? 0);

const height = Number(prediction.bbox_h ?? prediction.height ?? 0);

if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

const normalized = imageWidth === 1 && imageHeight === 1 && Math.max(x, y, width, height) <= 1;

const left = normalized ? x * 100 : x / imageWidth * 100;

const top = normalized ? y * 100 : y / imageHeight * 100;

const boxWidth = normalized ? width * 100 : width / imageWidth * 100;

const boxHeight = normalized ? height * 100 : height / imageHeight * 100;

return {

left: Math.max(0, Math.min(100, left)) + "%",

top: Math.max(0, Math.min(100, top)) + "%",

width: Math.max(0, Math.min(100 - left, boxWidth)) + "%",

height: Math.max(0, Math.min(100 - top, boxHeight)) + "%",

};

}

function predictionColor(label = "") {

let hash = 0;

for (const char of String(label)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;

return colors[Math.abs(hash) % colors.length];

}

function predictionItems(value) {

if (Array.isArray(value)) return value;

if (!value) return [];

if (typeof value === "string") {

try {

const parsed = JSON.parse(value);

return Array.isArray(parsed) ? parsed : [];

} catch {

return [];

}

}

return Array.isArray(value.predictions) ? value.predictions : [];

}

function parseMaybeJson(value) {

if (!value) return {};

if (typeof value === "string") {

try {

return JSON.parse(value);

} catch {

return {};

}

}

return value;

}

function metricValue(metrics, keys) {

for (const key of keys) {

const value = metrics?.[key];

if (value !== undefined && value !== null && value !== "") return value;

}

return null;

}

function formatMetric(value) {

  if (value === null || value === undefined || value === "") return "--";

  const number = Number(value);

  if (!Number.isFinite(number)) return String(value);

  if (number >= 0 && number <= 1) return `${(number * 100).toFixed(2)}%`;

  return number.toFixed(2);

}

function displayInferenceMessage(job, metrics = {}) {

  const message = String(job?.message || "").trim();

  const looksGarbled = /\\uFFFD|\\u0442|\\u037C/.test(message);

  if (message && !looksGarbled) return message;

  if (String(job?.status || "").toLowerCase() === "done") {

    const images = metrics.images ?? job?.image_count ?? "--";

    const predictions = metrics.predictions ?? job?.prediction_count ?? "--";

    return `YOLO 推理完成：${images} 张图片，${predictions} 个预测框`;

  }

  return message || "等待 worker 更新状";

}

function InferenceResultDialog({ resultState, onClose }) {

const { job, results, loading } = resultState;

const rows = results || [];

const totalPredictions = rows.reduce((sum, row) => sum + predictionItems(row.predictions_json).length, 0);

const previewRows = rows.slice(0, 12);

const params = parseMaybeJson(job.params_json);

const output = params.output || {};

const metrics = output.metrics || params.metrics || {};

const outputPath = output.predictionsPath || rows.find((row) => row.artifact_path)?.artifact_path || job.output_root || "";

const metricCards = [

["Precision", ["precision", "Precision", "p", "P"]],

["Recall", ["recall", "Recall", "r", "R"]],

["mAP50", ["map50", "mAP50", "map_50", "mAP_50"]],

["mAP50-95", ["map", "mAP", "map5095", "mAP50-95", "map_50_95"]],

];

return (

<div className="overlay" onClick={onClose}>

<div className="result-dialog" onClick={(event) => event.stopPropagation()}>

<div className="section-title-row">

<div>

<h2>推理结果</h2>

<p className="muted">{job.name} · {job.dataset_project_name || "未绑定数据集"}</p>

</div>

<button onClick={onClose}><X size={14} /></button>

</div>

<div className="result-summary">

<div className={`result-status ${job.status}`}><span>任务状态</span><b>{job.status}</b></div>

<div><span>图片结果</span><b>{loading ? "..." : rows.length}</b></div>

<div><span>预测数量</span><b>{loading ? "..." : totalPredictions}</b></div>

</div>

<div className="metric-summary">

{metricCards.map(([label, keys]) => (

<div key={label}><span>{label}</span><b>{loading ? "..." : formatMetric(metricValue(metrics, keys))}</b></div>

))}

</div>

<div className="result-path">

<span>输出文件路径</span>

<b>{outputPath || "暂无输出文件路径"}</b>

</div>

{loading ? (

<div className="empty-state">正在读取结果...</div>

) : rows.length ? (

<div className="result-table">

<div className="result-table-head">

<span>图片</span>

<span>预测</span>

<span>标签预览</span>

</div>

{previewRows.map((row) => {

const predictions = predictionItems(row.predictions_json);

const labels = Array.from(new Set(predictions.map((item) => item.label).filter(Boolean))).slice(0, 5);

return (

<div className="result-table-row" key={row.id || row.project_image_id || row.artifact_path}>

<b>{row.display_name || row.image_name || row.project_image_id || "图片结果"}</b>

<strong>{predictions.length}</strong>

<em>{labels.length ? labels.join("") : "无预测框"}</em>

</div>

);

})}

{rows.length > previewRows.length && <p className="result-more">仅显示前 {previewRows.length} 条，共 {rows.length} 条图片结果</p>}

</div>

) : (

<div className="empty-state">暂无图片级结果明细</div>

)}

</div>

</div>

);

}

function TrainingLogPanel({ logs }) {

return (

<section className="log-panel">

<h2>训练日志</h2>

<div className="log-box">

{logs.map((log) => <p key={log.id}><span>{log.stream}</span>{log.line}</p>)}

{!logs.length && <div className="muted">选择一个训练任务后查看日志</div>}

</div>

</section>

);

}

function optionList(values) {

return Array.from(new Set((values || []).filter(Boolean)));

}

function FilterPanel({ summary, filters, setFilters, imports }) {

const set = (key, value) => setFilters({ ...filters, [key]: value });

const toggle = (key, value) => {

const current = filters[key] || [];

set(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

};

const clear = () => setFilters({ q: "", scenes: [], views: [], modalities: [], labels: [], importBatchIds: [] });

return (

<aside className="filter-panel">

<h2>筛选条</h2>

<label className="search-control"><Search size={15} /><input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="搜索文件" /></label>

<MultiFilter title="视角" values={optionList(summary?.views)} selected={filters.views} onToggle={(value) => toggle("views", value)} />

<MultiFilter title="场景" values={optionList(summary?.scenes)} selected={filters.scenes} onToggle={(value) => toggle("scenes", value)} />

<MultiFilter title="模" values={[["infrared", "IR"], ["visible", "RGB"]]} selected={filters.modalities} onToggle={(value) => toggle("modalities", value)} />

<MultiFilter title="标签" values={optionList(summary?.labels)} selected={filters.labels} onToggle={(value) => toggle("labels", value)} />

<details className="filter-dropdown more-filter">

<summary>更多筛选<SlidersHorizontal size={14} /></summary>

<div className="filter-menu">

<MultiFilter title="导入批次" values={imports.map((x) => [x.id, new Date(x.created_at).toLocaleString()])} selected={filters.importBatchIds} onToggle={(value) => toggle("importBatchIds", value)} />

<button className="clear-filters" onClick={clear}>清空筛</button>

</div>

</details>

<div className="view-switch">

<button className="active" title="网格视图"><Grid size={16} /></button>

<button title="列表视图"><List size={16} /></button>

</div>

</aside>

);

}

function HomeSidebar({ projects, currentFolder, currentFolderId, setCurrentFolderId, expandedIds, setExpandedIds, openProject, openHomeFolder, createProject, stats }) {

const childrenByParent = useMemo(() => {

const map = new Map();

for (const project of projects || []) {

const key = project.parent_id || "root";

if (!map.has(key)) map.set(key, []);

map.get(key).push(project);

}

for (const rows of map.values()) rows.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

return map;

}, [projects]);

const rootRows = childrenByParent.get("root") || [];

return (

<aside className="workspace-sidebar home-sidebar">

<div className="sidebar-head">

<div>

<span>项目目录</span>

<b>{currentFolder?.name || "全部项目"}</b>

</div>

<button title="新建项目" onClick={createProject}><FolderPlus size={15} /></button>

</div>

<div className="tree-list">

{rootRows.map((project) => (

<HomeTreeNode

key={project.id}

project={project}

childrenByParent={childrenByParent}

currentFolderId={currentFolderId}

setCurrentFolderId={setCurrentFolderId}

expandedIds={expandedIds}

setExpandedIds={setExpandedIds}

openProject={openProject}

openHomeFolder={openHomeFolder}

depth={0}

/>

))}

</div>

<div className="storage-meter dataset-asset-meter">

<div><span>项目资产</span></div>

<progress value={Math.min(100, stats.images ? 14 : 0)} max="100" />

<em><b>{formatCount(stats.images)} 图像</b><b>{formatCount(stats.videos)} 视频</b></em>

</div>

</aside>

);

}

function HomeTreeNode({ project, childrenByParent, currentFolderId, setCurrentFolderId, expandedIds, setExpandedIds, openProject, openHomeFolder, depth }) {

const children = childrenByParent.get(project.id) || [];

const active = currentFolderId === project.id;

const hasActiveDescendant = children.some((child) => child.id === currentFolderId || (childrenByParent.get(child.id) || []).some((grand) => grand.id === currentFolderId));

const open = expandedIds.has(project.id) || active || hasActiveDescendant;

const toggleOpen = (event) => {

event.stopPropagation();

if (!children.length) return;

setExpandedIds((current) => {

const next = new Set(current);

if (next.has(project.id)) next.delete(project.id);

else next.add(project.id);

return next;

});

};

return (

<div className="tree-node">

<button

className={active ? "active" : ""}

style={{ "--depth": depth }}

onClick={() => openHomeFolder(project)}

onDoubleClick={() => openProject(project)}

>

{children.length ? (

<span className="tree-toggle" role="button" tabIndex={-1} onClick={toggleOpen}>

{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

</span>

) : <span className="tree-spacer" />}

{active ? <FolderOpen size={16} /> : <Folder size={16} />}

<span>{project.name}</span>

<em title="该项目及子目录中的图像数量">{formatCount(project.image_count || 0)} 图像</em>

</button>

{open && children.map((child) => (

<HomeTreeNode

key={child.id}

project={child}

childrenByParent={childrenByParent}

currentFolderId={currentFolderId}

setCurrentFolderId={setCurrentFolderId}

expandedIds={expandedIds}

setExpandedIds={setExpandedIds}

openProject={openProject}

openHomeFolder={openHomeFolder}

depth={depth + 1}

/>

))}

</div>

);

}

function HomeInspector({ stats, trashProjects, restoreProject, restoreAllProjects, emptyProjectTrash, deleteProjectPermanently }) {

return (

<aside className="inspector-panel home-inspector">

<section className="home-inspector-block stats-block">

<div className="inspector-title">

<h2>{stats.title === "全部项目" ? "全部项目统计" : `${stats.title}统计`}</h2>

<button title="刷新统计"><RefreshCw size={14} /></button>

</div>

<div className="inspector-stats">

<div><FolderOpen size={18} /><span>顶层项目数</span><b>{formatCount(stats.projects)}</b></div>

<div><ImageIcon size={18} /><span>当前范围图像</span><b>{formatCount(stats.images)}</b></div>

<div><Video size={18} /><span>当前范围视频</span><b>{formatCount(stats.videos)}</b></div>

<div><Tags size={18} /><span>当前范围标注</span><b>{formatCount(stats.annotations)}</b></div>

</div>

</section>

<section className="home-inspector-block home-trash-panel">

<div className="section-title-row compact-title">

<h2>回收</h2>

<span>共 {formatCount(trashProjects.length)} 项</span>

<span className="trash-toolbar-actions">

<button title="全部恢复" disabled={!trashProjects.length} onClick={restoreAllProjects}><RotateCcw size={14} /></button>

<button className="danger-icon" title="全部清空" disabled={!trashProjects.length} onClick={emptyProjectTrash}><Trash2 size={14} /></button>

</span>

</div>

<div className="trash-list">

{trashProjects.map((project) => (

<div className="trash-row" key={project.id}>

<Folder size={19} />

<div>

<b>{project.name}</b>

<span>删除时间：{project.deleted_at ? new Date(project.deleted_at).toLocaleString() : "--"}</span>

</div>

<span className="trash-row-actions"><button title="恢复项目" onClick={() => restoreProject(project.id)}><RotateCcw size={14} /></button><button title="永久删除" onClick={() => deleteProjectPermanently?.(project.id)}><Trash2 size={14} /></button></span>

</div>

))}

{!trashProjects.length && <div className="muted">回收站为空</div>}

</div>

</section>

</aside>

);

}

function WorkspaceSidebar({ root, activeProject, projects, openProject, createProject, summary, expandedIds, setExpandedIds }) {
  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const project of projects || []) {
      const key = project.parent_id || "root";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(project);
    }
    for (const rows of map.values()) rows.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    return map;
  }, [projects]);
  const rootRows = childrenByParent.get("root") || [];
  return (
    <aside className="workspace-sidebar home-sidebar">
      <div className="sidebar-head">
        <div>
          <span>项目目录</span>
          <b>{activeProject?.name || root?.name || "全部项目"}</b>
        </div>
        <button title="新建文件" onClick={createProject}><FolderPlus size={15} /></button>
      </div>
      <div className="tree-list">
        {rootRows.map((project) => (
          <TreeNode
            key={project.id}
            project={project}
            childrenByParent={childrenByParent}
            activeProject={activeProject}
            openProject={openProject}
            expandedIds={expandedIds}
            setExpandedIds={setExpandedIds}
            depth={0}
          />
        ))}
        {!rootRows.length && <p className="muted">当前目录没有下级文件</p>}
      </div>
      <div className="storage-meter">
        <div><span>存储使用</span><b>{formatCount(summary?.image_count || 0)} 图像</b></div>
        <progress value={Math.min(100, Number(summary?.image_count || 0) ? 12.5 : 0)} max="100" />
        <em>{Number(summary?.image_count || 0) ? "12.5%" : "0%"}</em>
      </div>
    </aside>
  );
}
function TreeNode({ project, childrenByParent, activeProject, openProject, expandedIds, setExpandedIds, depth }) {

const children = childrenByParent.get(project.id) || [];

const active = activeProject?.id === project.id;

const hasActiveDescendant = children.some((child) => child.id === activeProject?.id || (childrenByParent.get(child.id) || []).some((grand) => grand.id === activeProject?.id));

const open = expandedIds?.has(project.id) || active || hasActiveDescendant;

const toggleOpen = (event) => {

event.stopPropagation();

if (!children.length) return;

setExpandedIds((current) => {

const next = new Set(current);

if (next.has(project.id)) next.delete(project.id);

else next.add(project.id);

return next;

});

};

return (

<div className="tree-node">

<button className={active ? "active" : ""} style={{ "--depth": depth }} onClick={() => openProject(project)}>

{children.length ? (

<span className="tree-toggle" role="button" tabIndex={-1} onClick={toggleOpen}>

{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

</span>

) : <span className="tree-spacer" />}

{active ? <FolderOpen size={16} /> : <Folder size={16} />}

<span>{project.name}</span>

<em>{formatCount((project.image_count || 0) + (project.child_count || 0))}</em>

</button>

{open && children.map((child) => (

<TreeNode

key={child.id}

project={child}

childrenByParent={childrenByParent}

activeProject={activeProject}

openProject={openProject}

expandedIds={expandedIds}

setExpandedIds={setExpandedIds}

depth={depth + 1}

/>

))}

</div>

);

}

function EditableProjectName({

project,

editingProjectId,

editingProjectName,

setEditingProjectName,

startRenameProject,

commitRenameProject,

cancelRenameProject,

}) {

const isEditing = editingProjectId === project.id;

if (!isEditing) {

return <h3 onDoubleClick={(event) => { event.stopPropagation(); startRenameProject(project); }}>{project.name}</h3>;

}

return (

<input

className="inline-name-input"

value={editingProjectName}

autoFocus

onClick={(event) => event.stopPropagation()}

onDoubleClick={(event) => event.stopPropagation()}

onChange={(event) => setEditingProjectName(event.target.value)}

onBlur={() => commitRenameProject(project)}

onKeyDown={(event) => {

if (event.key === "Enter") {

event.preventDefault();

event.currentTarget.blur();

}

if (event.key === "Escape") {

event.preventDefault();

cancelRenameProject();

}

}}

/>

);

}

function WorkspaceFolders({

projects,

openProject,

deleteProject,

editingProjectId,

editingProjectName,

setEditingProjectName,

startRenameProject,

commitRenameProject,

cancelRenameProject,

projectLastImportAt,

}) {

if (!projects.length) return null;

return (

<section className="workspace-folders">

<div className="section-title-row compact-title">

<h2>文件</h2>

<span className="muted">{projects.length} </span>

</div>

<div className="project-grid workspace-folder-grid">

{projects.map((project) => (

<article className="project-folder" key={project.id} tabIndex={0} onClick={() => openProject(project)} onKeyDown={(event) => { if (event.key === "Enter") openProject(project); }}>

<div className="project-folder-icon project-stat-icon" aria-hidden="true"><FolderOpen size={25} /><ImageIcon className="project-folder-badge" size={12} /></div>

<div className="project-folder-body">

<EditableProjectName

project={project}

editingProjectId={editingProjectId}

editingProjectName={editingProjectName}

setEditingProjectName={setEditingProjectName}

startRenameProject={startRenameProject}

commitRenameProject={commitRenameProject}

cancelRenameProject={cancelRenameProject}

/>

<p className="project-folder-metrics">

<span><ImageIcon size={13} />{formatCount(project.image_count || 0)}</span>

<span><Video size={13} />{formatCount(project.video_count || 0)}</span>

<span><Folder size={13} />{formatCount(project.child_count || 0)}</span>

</p>

<span>最后导入： {projectLastImportAt.get(project.id) ? new Date(projectLastImportAt.get(project.id)).toLocaleString() : "暂无导入"}</span>

</div>

<div className="project-actions">

<button title="重命名" onClick={(event) => { event.stopPropagation(); startRenameProject(project); }}><Edit3 size={16} /></button>

<button title="删除文件" onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>

</div>

</article>

))}

</div>

</section>

);

}

function MultiFilter({ title, values, selected = [], onToggle }) {

const detailsRef = useRef(null);

const normalized = values.map((item) => Array.isArray(item) ? item : [item, item]);

const label = selected.length ? `${selected.length} 已选` : "全部";

const toggleValue = (value) => {

onToggle(value);

window.setTimeout(() => detailsRef.current?.removeAttribute("open"), 0);

};

return (

<details className="filter-group filter-dropdown" ref={detailsRef}>

<summary><span>{title}</span><b>{label}</b><ChevronDown size={14} /></summary>

<div className="check-list filter-menu">

{normalized.map(([value, label]) => (

<label className="check-row" key={value}>

<input type="checkbox" checked={selected.includes(value)} onChange={() => toggleValue(value)} />

<span>{label}</span>

</label>

))}

{!normalized.length && <div className="muted">暂无选项</div>}

</div>

</details>

);

}
function ProgressStrip({ latestImport, jobs, error, onCloseError, onCancelImport }) {

const runningStatuses = new Set(["pending", "scanning", "running", "cancel_requested", "preparing"]);

const visibleImport = latestImport && runningStatuses.has(latestImport.status) ? latestImport : null;

const latestExport = jobs.find((job) => job.type === "export" && runningStatuses.has(job.status));

const canCancelImport = visibleImport && ["scanning", "running", "cancel_requested"].includes(visibleImport.status);

return (

<div className="progress-stack">

{error && (

<div className="error-banner">

<span>{error}</span>

<button onClick={onCloseError}>&times;</button>

</div>

)}

{visibleImport && <ProgressBar title="导入进度" message={visibleImport.message || visibleImport.status} progress={visibleImport.progress || 0} onCancel={canCancelImport ? onCancelImport : null} />}

{latestExport && <ProgressBar title="导出进度" message={latestExport.message || latestExport.status} progress={latestExport.progress || 0} />}

</div>

);

}

function ProgressBar({ title, message, progress, onCancel }) {

return (

<div className="progress-card">

<div><span>{title}</span><b>{message}</b></div>

<progress value={progress} max="100" />

<em>{progress}%</em>

{onCancel && <button className="cancel-progress" onClick={onCancel}>取消</button>}

</div>

);

}

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

function ImageGrid({ items, selected, setSelected, page, setPage, openViewer, checkedIds, setCheckedIds, lastCheckedId, setLastCheckedId, deleteCheckedImages }) {

const allChecked = items.length > 0 && items.every((item) => checkedIds.includes(item.id));

const toggleItem = (event, id) => {

event.stopPropagation();

const pageIds = items.map((item) => item.id);

const currentIndex = pageIds.indexOf(id);

const previousIndex = pageIds.indexOf(lastCheckedId);

const shouldCheck = !checkedIds.includes(id);

setCheckedIds((ids) => {

if (event.shiftKey && previousIndex >= 0 && currentIndex >= 0) {

const [start, end] = previousIndex < currentIndex ? [previousIndex, currentIndex] : [currentIndex, previousIndex];

const range = pageIds.slice(start, end + 1);

return shouldCheck ? Array.from(new Set([...ids, ...range])) : ids.filter((item) => !range.includes(item));

}

return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];

});

setLastCheckedId(id);

};

const togglePage = () => setCheckedIds((ids) => {

const pageIds = items.map((item) => item.id);

if (pageIds.every((id) => ids.includes(id))) return ids.filter((id) => !pageIds.includes(id));

return Array.from(new Set([...ids, ...pageIds]));

});

return (

<section className="preview-panel">

<div className="preview-head">

<div><h2>数据预览</h2><p>当前筛选结果 · 双击缩略图打开大图</p></div>

<div className="bulk-actions">

<label><input type="checkbox" checked={allChecked} onChange={togglePage} />本页全</label>

<span>{checkedIds.length} 已</span>

</div>

</div>

<div className="asset-grid">

{items.map((item) => (

<button className={`asset-card ${selected?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => setSelected(item)} onDoubleClick={() => openViewer(item)}>

{checkedIds.includes(item.id) ? <span className="selected-mark"><CheckCircle size={18} /></span> : <span className="select-box"><input type="checkbox" checked={false} onClick={(event) => toggleItem(event, item.id)} onChange={() => {}} /></span>}

<div className="thumb-wrap" style={{ aspectRatio: `${Number(item.image_width || 16)} / ${Number(item.image_height || 9)}` }}>

<img src={`/api/project-images/${item.id}/thumb`} loading="lazy" />

<AnnotationOverlay item={item} compact />

<span className="thumb-tags"><em>{item.view || "视角"}</em><em>{item.modality === "infrared" ? "IR" : "RGB"}</em></span>



<b className="thumb-name">{item.display_name}</b>

</div>

</button>

))}

{!items.length && <div className="empty-state">该级文件夹无数据</div>}

</div>

<div className="dataset-bottom-bar">

<label><input type="checkbox" checked={allChecked} onChange={togglePage} />已选择 {checkedIds.length} </label>

<button disabled={!selected} onClick={() => selected && openViewer(selected)}><Eye size={14} />查看标签</button>

<button disabled={!checkedIds.length} onClick={() => window.alert("下载功能待接入后端批量导出接")}><Download size={14} />下载</button>

<button disabled={!checkedIds.length} onClick={() => window.alert("移动功能待接入项目内文件移动接口")}><Move size={14} />移动</button>

<button disabled={!checkedIds.length} onClick={() => window.alert("复制功能待接入项目内文件复制接口")}><Copy size={14} />复制</button>

<button disabled={!checkedIds.length} onClick={deleteCheckedImages}>删除</button>

<div className="pager">

<span>共 {formatCount(items.length)} 项</span>

<button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronRight className="prev-icon" size={15} /></button>

<b>{page}</b>

<span>/ {Math.max(page, page + (items.length ? 1 : 0))}</span>

<button onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>

<select defaultValue="48">

<option value="48">48 项</option>

<option value="100">100 项</option>

</select>

</div>

</div>

</section>

);

}

function ImportRecords({ imports, trashImports, deleteImport, restoreImport, emptyImportTrash }) {

return (

<section className="records-panel">

<h2>导入记录</h2>

{imports.map((item) => (

<div className="record-row" key={item.id}>

<div><b>{pathName(item.source_path)}</b><span>{item.message} · {new Date(item.created_at).toLocaleString()}</span></div>

<button onClick={() => deleteImport(item.id)}><Trash2 size={14} />删除本次导入</button>

</div>

))}

{!imports.length && <div className="muted">暂无导入记录</div>}

<div className="section-title-row">

<h3>导入回收</h3>

<button disabled={!trashImports.length} onClick={emptyImportTrash}>清空回收</button>

</div>

{trashImports.map((item) => (

<div className="record-row deleted" key={item.id}>

<div><b>{pathName(item.source_path)}</b><span>{item.message}</span></div>

<button onClick={() => restoreImport(item.id)}><RotateCcw size={14} />恢复</button>

</div>

))}

{!trashImports.length && <div className="muted">导入回收站为空</div>}

</section>

);

}

function pathName(value = "") {

return value.split(/[\\/]/).filter(Boolean).pop() || value;

}

function ConflictReview({ conflicts, activeId, setActiveId, selectedIds, toggleSelected, resolveSelected }) {

if (!conflicts.length) {

return <div className="conflict-empty">当前预分析没有发现标注冲突</div>;

}

const active = conflicts.find((item) => item.id === activeId) || conflicts[0];

const preview = active?.preview_json || {};

const sources = preview.sources || [];

return (

<div className="conflict-review">

<aside className="conflict-list">

<div className="section-title-row">

<h3>冲突图片</h3>

<span>{selectedIds.length} 已</span>

</div>

{conflicts.map((item, index) => (

<button key={item.id} className={`conflict-item ${active?.id === item.id ? "active" : ""}`} onClick={() => setActiveId(item.id)}>

<input type="checkbox" checked={selectedIds.includes(item.id)} onClick={(event) => { event.stopPropagation(); toggleSelected(item.id); }} onChange={() => {}} />

<b>冲突 {index + 1}</b>

<span>{item.conflict_type} · {item.severity} · {item.status}</span>

</button>

))}

</aside>

<main className="conflict-stage">

{sources[0]?.image_id ? (

<img src={`/api/project-images/${sources[0].image_id}/full`} />

) : (

<div className="empty-state">没有可预览图</div>

)}

<div className="merge-log compact">

{(preview.log || []).map((line, index) => <p key={index}>{line}</p>)}

</div>

</main>

<aside className="conflict-side">

<h3>来源对比</h3>

{sources.map((source) => (

<div className="source-row" key={source.project_id}>

<div>

<b>{source.project_name}</b>

<span>{source.annotations} 标注</span>

</div>

<button onClick={() => resolveSelected(`source_project:${source.project_id}`)}>保留该来</button>

</div>

))}

<button onClick={() => resolveSelected("pending")}>标记待复</button>

</aside>

</div>

);

}

function Inspector({ item, summary }) {

const topLabels = optionList(summary?.labels).slice(0, 6);

if (!item) {

return (

<aside className="inspector-panel">

<div className="inspector-title"><h2>数据集统</h2><button title="刷新"><RefreshCw size={14} /></button></div>

<InspectorStats summary={summary} labels={topLabels} />

<p className="muted">选择一张图片查看详情</p>

</aside>

);

}

const annotations = item.annotations || [];

const grouped = annotations.reduce((acc, ann) => {

acc[ann.label] = (acc[ann.label] || 0) + 1;

return acc;

}, {});

return (

<aside className="inspector-panel">

<div className="inspector-title"><h2>数据集统</h2><button title="刷新"><RefreshCw size={14} /></button></div>

<InspectorStats summary={summary} labels={topLabels} />

<section className="image-info-panel">

<h3>图像信息 <span>({item.display_name})</span></h3>

<div className="kv path-kv"><span>绝对路径</span><b>{item.absolute_path || item.source_path || "未记"}</b></div>

<div className="kv"><span>文件</span><b>{item.display_name}</b></div>

<div className="kv"><span>尺寸</span><b>{item.image_width || "--"} × {item.image_height || "--"}</b></div>

<div className="kv"><span>场景</span><b>{item.scene || "--"}</b></div>

<div className="kv"><span>视角</span><b>{item.view || "--"}</b></div>

<div className="kv"><span>模</span><b>{item.modality === "infrared" ? "IR" : "RGB"}</b></div>

<div className="kv"><span>坐标</span><b>WGS84</b></div>

</section>

<section className="annotation-list">

<h3>标签（{annotations.length}</h3>

<div className="annotation-table-head"><span>类别</span><span>数量</span><span>操作</span></div>

{Object.entries(grouped).map(([label, count]) => (

<div className="annotation-table-row" key={label}>

<span><i style={{ background: labelColor(label) }} />{label}</span>

<b>{count}</b>

<em><Eye size={14} /><MoreVertical size={14} /></em>

</div>

))}

{!annotations.length && <p className="muted">当前筛选下没有标注框</p>}

</section>

</aside>

);

}

function InspectorStats({ summary, labels }) {

const imageCount = Number(summary?.image_count || 0);

const labeledImageCount = Number(summary?.labeled_image_count || 0);

const annotationCount = Number(summary?.annotation_count || 0);

const labelRows = Array.isArray(summary?.label_counts)
  ? summary.label_counts.map((item) => ({ label: item.label, count: Number(item.count || 0) })).filter((item) => item.label)
  : labels.map((label) => ({ label, count: 0 }));

const labelCount = labelRows.length || optionList(summary?.labels).length;

const maxLabelCount = Math.max(1, ...labelRows.map((item) => item.count));

return (

<>

<section className="inspector-stats">

<div><ImageIcon size={15} /><span>图像数量</span><b>{formatCount(imageCount)}</b></div>

<div><CheckCircle size={15} /><span>已标注图</span><b>{formatCount(labeledImageCount)}</b></div>

<div><Tags size={15} /><span>标注框总数</span><b>{formatCount(annotationCount)}</b></div>

<div><Database size={15} /><span>类别</span><b>{formatCount(labelCount)}</b></div>

</section>

<section className="class-bars">

<h3>类别分布（标注框</h3>

{labelRows.slice(0, 6).map((item) => (

<p key={item.label}>

<span><i style={{ background: labelColor(item.label) }} />{item.label}</span>

<strong><em style={{ width: `${Math.max(8, Math.round((item.count / maxLabelCount) * 100))}%`, background: labelColor(item.label) }} /></strong>

<b>{formatCount(item.count)}</b>

</p>

))}

{!labelRows.length && <small className="muted">暂无类别统计</small>}

</section>

</>

);

}

function ImageViewer({ items, index, setIndex, onClose, onSaved }) {

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

useEffect(() => {

setScale(1);

setPan({ x: 0, y: 0 });

setEditMode(false);

setTool("select");

setDraft((item?.annotations || []).map((ann) => ({ ...ann })));

setSelectedAnnId(null);

setDefaultLabel((item?.annotations || [])[0]?.label || "");

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

const width = Number(item.image_width || 1);

const height = Number(item.image_height || 1);

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

const save = () => {

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

<button className={editMode ? "active-tool edit-toggle" : "edit-toggle"} onClick={() => setEditMode((value) => !value)}>{editMode ? "退出编" : "编辑"}</button>

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

<img src={`/api/project-images/${item.id}/full`} draggable="false" />

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

createRoot(document.getElementById("root")).render(<App />);
