import React, { useEffect, useMemo, useRef, useState } from "react";

import {

ArrowLeft,

Bell,

ClipboardList,

Brain,

CheckCircle,

CheckCircle2,

ChevronDown,

ChevronRight,

Copy,

Database,

Download,

Edit3,

Eye,

Folder,

FolderPlus,

Globe2,

FolderOpen,

Grid,

HelpCircle,

Image as ImageIcon,

Import,

List,

MoreVertical,

Move,

Pause,

RefreshCw,

RotateCcw,

Search,

Share2,

Settings,

SlidersHorizontal,

Sun,

Tags,

Trash2,

Upload,

Video,

X,

} from "lucide-react";

import { AuthDialog as AuthDialogView } from "./features/auth/AuthDialog.jsx";
import { submitAuth, useAuthSessionController } from "./features/auth/useAuthSessionController.js";
import { AssetManagementWorkspace } from "./features/assets/AssetManagementWorkspace.jsx";
import { MainNav } from "./components/layout/MainNav.jsx";
import { EvaluationDetailPage } from "./features/evaluation/EvaluationDetailPage.jsx";
import { EvaluationPage } from "./features/evaluation/EvaluationPage.jsx";
import { EvaluationReportPage } from "./features/evaluation/EvaluationReportPage.jsx";
import { useEvaluationController } from "./features/evaluation/useEvaluationController.js";
import { SettingsDialog as SettingsDialogView } from "./features/settings/SettingsDialog.jsx";
import { InferenceWorkspace } from "./features/inference/InferenceWorkspace.jsx";
import { TrainingWorkspace } from "./features/training/TrainingWorkspace.jsx";
import { DatasetWorkspace } from "./features/datasets/DatasetWorkspace.jsx";
import { useBaselineController } from "./features/datasets/useBaselineController.js";
import { useDatasetImportController } from "./features/datasets/useDatasetImportController.js";

import { readUiState, restorableViews, updateUiState } from "./app/ui-state.js";
import {
  colors,
  evaluationTypeLabels,
  formatCount,
  formatDateTime,
  formatDuration,
  runStatusLabel,
  sortRuntimeJobsByTime,
  taskLabel,
} from "./shared/presentation.js";
import { useWorkspaceColumns } from "./shared/useWorkspaceColumns.jsx";
import { withScope } from "./api-client.js";
import { AdminCenter, AnnotationTaskPanel, PublicRequestDialog, ScopeTabs, ShareDialog } from "./multi-user-ui.jsx";

export default function App() {

const restoredUiStateRef = useRef(readUiState());
const restoredUiState = restoredUiStateRef.current;

const [view, setView] = useState(() => restorableViews.has(restoredUiState.view) || restoredUiState.view === "admin" ? restoredUiState.view : "home");

const [theme, setTheme] = useState(() => restoredUiState.theme === "dark" ? "dark" : "light");

const { authMode, currentUser, setAuthMode, setCurrentUser, signOut } = useAuthSessionController();

const [userPermissions, setUserPermissions] = useState([]);

const [datasetScope, setDatasetScope] = useState(() => window.localStorage.getItem("det-dashboard-dataset-scope") || "mine");
const [assetScope, setAssetScope] = useState(() => window.localStorage.getItem("det-dashboard-asset-scope") || "mine");
const [homeSection, setHomeSection] = useState(() => window.localStorage.getItem("det-dashboard-home-section") || "projects");
const [projectShareResource, setProjectShareResource] = useState(null);
const [projectPublicResource, setProjectPublicResource] = useState(null);
const [collaborationViewer, setCollaborationViewer] = useState(null);

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

const [exportFormat, setExportFormat] = useState("labelme");

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
valProjectIds: [],
testProjectId: "",
testProjectIds: [],
datasetFilters: {
  train: { scenes: [], views: [], modalities: [], labels: [], keywords: [] },
  val: { scenes: [], views: [], modalities: [], labels: [], keywords: [] },
  test: { scenes: [], views: [], modalities: [], labels: [], keywords: [] },
},
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
  if (!currentUser) {
    setUserPermissions([]);
    return;
  }
  fetch("/api/me/permissions")
    .then((response) => response.json())
    .then((payload) => setUserPermissions(Array.isArray(payload.permissions) ? payload.permissions : []))
    .catch(() => setUserPermissions([]));
}, [currentUser?.id]);

useEffect(() => {
  if (currentUser) refreshHome();
}, [datasetScope, currentUser?.id]);

useEffect(() => {
  if (!currentUser) return;
  fetch("/api/config").then((r) => r.json()).then((d) => setAppConfig(d)).catch(() => {});
}, [currentUser?.id]);

useEffect(() => {
  window.localStorage.setItem("det-dashboard-dataset-scope", datasetScope);
  window.localStorage.setItem("det-dashboard-asset-scope", assetScope);
  window.localStorage.setItem("det-dashboard-home-section", homeSection);
}, [datasetScope, assetScope, homeSection]);

useEffect(() => {

if (!activeProject) return;

loadWorkspace(activeProject.id);

}, [activeProject, page, filters]);

useEffect(() => {

if (!currentUser) return;

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

}, [activeProject, currentUser?.id]);

useEffect(() => {

if (!activeProject) return;

const terminalImport = imports.find((row) => ["done", "failed", "cancelled"].includes(row.status));

const refreshKey = terminalImport ? `${activeProject.id}:${terminalImport.id}:${terminalImport.status}:${terminalImport.finished_at || ""}` : "";

if (!refreshKey || importRefreshKeyRef.current === refreshKey) return;

importRefreshKeyRef.current = refreshKey;

loadWorkspace(activeProject.id);

}, [activeProject, imports]);

useEffect(() => {

if (!currentUser) return;

if (!["training", "inference", "models", "evaluation"].includes(view)) return;

loadMlPlatform();

const timer = window.setInterval(() => loadMlPlatform(), 2500);

return () => window.clearInterval(timer);

}, [view, assetScope, currentUser?.id]);

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
      valProjectIds: trainingForm.valProjectIds,
      testProjectId: trainingForm.testProjectId,
      testProjectIds: trainingForm.testProjectIds,
      datasetFilters: trainingForm.datasetFilters,
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

if (!currentUser || !activeTrainingJobId || String(activeTrainingJobId).startsWith("mock-")) {

setTrainingLogs([]);

return;

}

fetch(`/api/ml/training-jobs/${activeTrainingJobId}/logs`)

.then((r) => r.json())

.then((d) => setTrainingLogs(d.logs || []))

.catch(() => {});

}, [activeTrainingJobId, trainingJobs, currentUser?.id]);

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

const datasetImportController = useDatasetImportController({
  activeProject,
  currentFolder,
  openProject,
  loadWorkspace,
  setLatestImport,
  appConfig,
  setError,
});

const baselineController = useBaselineController({
  refreshHome,
  setError,
});

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

fetch(withScope("/api/projects", datasetScope)).then((r) => r.json()).then((d) => {

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

fetch(withScope("/api/ml/models", assetScope)).then((r) => r.json()).then((d) => setMlModels(d.models || [])).catch(() => {});

fetch(withScope("/api/ml/model-versions", assetScope)).then((r) => r.json()).then((d) => setModelVersions(d.versions || [])).catch(() => {});

fetch("/api/ml/training-jobs").then((r) => r.json()).then((d) => setTrainingJobs(d.jobs || [])).catch(() => {});

fetch("/api/ml/inference-jobs").then((r) => r.json()).then((d) => setInferenceJobs(sortRuntimeJobsByTime(d.jobs || []))).catch(() => {});

fetch(withScope("/api/ml/algorithm-assets", assetScope)).then((r) => r.json()).then((d) => {

const algorithms = d.algorithms || [];

setAlgorithmAssets(algorithms);

setTrainingTemplates(algorithms.map((item) => ({

...item,

template_key: item.algorithm_key,

capabilities_json: item.capabilities_json || { tasks: [item.task_type || "detect"] },

})));

}).catch(() => {

fetch(withScope("/api/ml/training-templates", assetScope)).then((r) => r.json()).then((d) => setTrainingTemplates(d.templates || [])).catch(() => {});

});

fetch(withScope("/api/ml/python-envs", assetScope)).then((r) => r.json()).then((d) => setPythonEnvs(d.envs || [])).catch(() => {});

fetch(withScope("/api/ml/asset-links", assetScope)).then((r) => r.json()).then((d) => setAssetLinks(d.links || [])).catch(() => setAssetLinks([]));

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
valProjectIds: trainingForm.valProjectIds?.length ? trainingForm.valProjectIds : (trainingForm.valProjectId ? [trainingForm.valProjectId] : []),
testProjectId: trainingForm.testProjectId || null,
testProjectIds: trainingForm.testProjectIds?.length ? trainingForm.testProjectIds : (trainingForm.testProjectId ? [trainingForm.testProjectId] : []),
},
datasetFilters: trainingForm.datasetFilters,

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
valProjectIds: trainingForm.valProjectIds?.length ? trainingForm.valProjectIds : (trainingForm.valProjectId ? [trainingForm.valProjectId] : []),
testProjectId: trainingForm.testProjectId || null,
testProjectIds: trainingForm.testProjectIds?.length ? trainingForm.testProjectIds : (trainingForm.testProjectId ? [trainingForm.testProjectId] : []),
},
datasetFilters: trainingForm.datasetFilters,
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

function openHomeFolder(project) {

const hasChildren = Number(project?.child_count || 0) > 0;

const hasAssets = Number(project?.image_count || 0) > 0 || Number(project?.video_count || 0) > 0;

if (!hasChildren && hasAssets) {

openProject(project);

return;

}

setCurrentFolderId(project.id);

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

const datasetViewModel = {

projects,

currentFolder,

currentFolderId,

setCurrentFolderId,

homeExpandedIds,

setHomeExpandedIds,

openProject,

openHomeFolder,

createProject,

homeStats,

breadcrumbs,

datasetScope,

setDatasetScope,

homeSection,

setHomeSection,

currentUser,

...datasetImportController,

setError,

error,

visibleProjects,

editingProjectId,

editingProjectName,

setEditingProjectName,

startRenameProject,

commitRenameProject,

cancelRenameProject,

projectLastImportAt,

setProjectShareResource,

setProjectPublicResource,

deleteProject,

trashProjects,

restoreProject,

restoreAllProjects,

emptyProjectTrash,

deleteProjectPermanently,

projectShareResource,

projectPublicResource,

collaborationViewer,

setCollaborationViewer,

hasCurrentImages,

workspaceRoot,

activeProject,

summary,

activeBreadcrumbs,

goHome,

exportProject,

openWorkspaceTrash,

exportFormat,

setExportFormat,

filters,

setFilters,

setPage,

imports,

latestImport,

jobs,

cancelLatestImport,

activeChildProjects,

trashImports,

deleteImport,

restoreImport,

emptyImportTrash,

items,

selected,

setSelected,

page,

viewerIndex,

setViewerIndex,

checkedIds,

setCheckedIds,

lastCheckedId,

setLastCheckedId,

deleteCheckedImages,

...baselineController,

setItems,

};

if (view === "home") {

return (

<div className={`app-shell ${theme}`}>

<MainNav view={view} goHome={openDatasetView} openPlatform={openPlatform} theme={theme} setTheme={setTheme} user={currentUser} onLogin={() => setAuthMode("login")} onLogout={signOut} onSettings={() => setShowSettings(true)} />

<DatasetWorkspace mode="home" viewModel={datasetViewModel} />

{authMode && <AuthDialog mode={authMode} setMode={setAuthMode} required={!currentUser} onClose={() => setAuthMode(null)} onSignedIn={setCurrentUser} />}

{showSettings && <SettingsDialog config={appConfig} onClose={() => setShowSettings(false)} />}

</div>

);

}

if (view === "training" || view === "inference" || view === "models" || view === "evaluation" || view === "admin") {

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
        userPermissions={userPermissions}
        assetScope={assetScope}
        setAssetScope={setAssetScope}
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

<DatasetWorkspace mode="workspace" viewModel={datasetViewModel} />

{authMode && <AuthDialog mode={authMode} setMode={setAuthMode} required={!currentUser} onClose={() => setAuthMode(null)} onSignedIn={setCurrentUser} />}

{showSettings && <SettingsDialog config={appConfig} onClose={() => setShowSettings(false)} />}

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
  userPermissions,
  assetScope,
  setAssetScope,
  authMode,
  setAuthMode,
  setCurrentUser,
  onLogout,
  showSettings,
  setShowSettings,
  appConfig,
}) {

const title = view === "training" ? "训练平台" : view === "inference" ? "推理平台" : view === "evaluation" ? "测试评估平台" : view === "admin" ? "管理员中心" : "\u8d44\u4ea7";

const supportedTasks = ["detect", "segment", "classify"];

const {
  activeEvaluationReportTask,
  activeEvaluationTask,
  evaluationCluster,
  evaluationType,
  filteredEvaluationTasks,
  hideEvaluationTask,
  selectedEvaluationTaskId,
  setActiveEvaluationReportTask,
  setActiveEvaluationTask,
  setEvaluationCluster,
  setEvaluationType,
  setSelectedEvaluationTaskId,
} = useEvaluationController({ inferenceJobs });

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

            helpers={{ bestAssetLink, formatCount, formatMetric, parseMaybeJson, runStatusLabel }}

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

requeueInferenceJob={requeueInferenceJob}

moveRuntimeQueueJob={moveRuntimeQueueJob}

helpers={{ bestAssetLink, envTooltip, formatMetric, modelFamilyLabel, parseMaybeJson, predictionBoxStyle, predictionColor, predictionItems, predictionLegend, projectTreeRows, versionTooltip }}

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

parseMaybeJson={parseMaybeJson}

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

onDelete={hideEvaluationTask}

parseMaybeJson={parseMaybeJson}

predictionItems={predictionItems}

predictionBoxStyle={predictionBoxStyle}

formatMetric={formatMetric}

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

assetScope={assetScope}

setAssetScope={setAssetScope}

currentUser={currentUser}

userPermissions={userPermissions}

ScopeTabs={ScopeTabs}

ShareDialog={ShareDialog}

PublicRequestDialog={PublicRequestDialog}

formatDateTime={formatDateTime}

modelFamilyLabel={modelFamilyLabel}

envTooltip={envTooltip}

/>

)}

{view === "admin" && <AdminCenter />}

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

function AuthDialog(props) {
  return (
    <AuthDialogView
      {...props}
      onSubmit={submitAuth}
    />
  );
}

function SettingsDialog(props) {
  return (
    <SettingsDialogView
      {...props}
      onSave={async (settings) => {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ settings }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "保存设置失败");
        return data;
      }}
    />
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

const params = parseMaybeJson(version.params_json);
const inferredEpoch = String(version.version_name || "").match(/epoch[_-]?(\d+)/i)?.[1];
const epochText = version.training_current_epoch != null
  ? `${version.training_current_epoch}/${version.training_total_epochs || "--"}`
  : (params.epoch ?? inferredEpoch ?? "未记录");

return [

`模型：${version.model_name || "未命名模型"}`,

`版本：${version.version_name || "未命名版本"}`,

`来源任务：${version.training_job_name || (version.training_job_id ? version.training_job_id : "手动登记/预训练")}`,

`训练数据集：${version.dataset_project_name || "未绑"}`,

`训练轮次：${epochText}`,

`模型阶段：${version.stage || "未记录"}`,

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
