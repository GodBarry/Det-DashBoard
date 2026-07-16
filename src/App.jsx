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
import { AssetManagementWorkspace } from "./features/assets/AssetManagementWorkspace.jsx";
import { MainNav } from "./components/layout/MainNav.jsx";
import { EvaluationDetailPage } from "./features/evaluation/EvaluationDetailPage.jsx";
import { EvaluationPage } from "./features/evaluation/EvaluationPage.jsx";
import { EvaluationReportPage } from "./features/evaluation/EvaluationReportPage.jsx";
import { useEvaluationController } from "./features/evaluation/useEvaluationController.js";
import { SettingsDialog as SettingsDialogView } from "./features/settings/SettingsDialog.jsx";
import { InferenceWorkspace } from "./features/inference/InferenceWorkspace.jsx";
import { TrainingWorkspace } from "./features/training/TrainingWorkspace.jsx";
import {
  EditableProjectName,
  HomeInspector,
  HomeSidebar,
  WorkspaceFolders,
  WorkspaceSidebar,
} from "./features/datasets/DatasetTreePanels.jsx";

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
import {
  clearSession,
  login as loginSession,
  logout as logoutSession,
  me as loadSession,
  readSession,
  register as registerSession,
  UNAUTHORIZED_EVENT,
  withScope,
} from "./api-client.js";
import { AdminCenter, AnnotationTaskPanel, PublicRequestDialog, ScopeTabs, ShareDialog } from "./multi-user-ui.jsx";

export default function App() {

const restoredUiStateRef = useRef(readUiState());
const restoredUiState = restoredUiStateRef.current;

const [view, setView] = useState(() => restorableViews.has(restoredUiState.view) || restoredUiState.view === "admin" ? restoredUiState.view : "home");

const [theme, setTheme] = useState(() => restoredUiState.theme === "dark" ? "dark" : "light");

const [currentUser, setCurrentUser] = useState(() => readSession());

const [userPermissions, setUserPermissions] = useState([]);

const [authMode, setAuthMode] = useState(() => window.localStorage.getItem("det-dashboard-user") ? null : "login");

const signOut = async () => {
  await logoutSession().catch(() => clearSession());
  setCurrentUser(null);
  setAuthMode("login");
};

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
  const handleUnauthorized = () => {
    clearSession();
    setCurrentUser(null);
    setAuthMode("login");
  };
  window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
}, []);

useEffect(() => {
  if (!currentUser) return;
  loadSession()
    .then(() => setCurrentUser(readSession()))
    .catch(() => {});
}, [currentUser?.token]);

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

<ScopeTabs value={datasetScope} onChange={(scope) => { setDatasetScope(scope); setCurrentFolderId(null); }} />

<button className={homeSection === "annotation" ? "active" : ""} onClick={() => setHomeSection(homeSection === "annotation" ? "projects" : "annotation")}><ClipboardList size={16} />{"协同标注"}</button>

{currentFolder && <button onClick={() => setCurrentFolderId(currentFolder.parent_id || null)}><ArrowLeft size={16} />返回</button>}

<button onClick={createProject}><FolderPlus size={16} />新建项目</button>

<button onClick={createProject}><FolderPlus size={16} />新建文件</button>

<button onClick={importDataFromHome}><Import size={16} />导入数据</button>

<button onClick={() => setError("请先进入具体项目后再导出数据集")}><Upload size={16} />导出数据</button>

<button onClick={() => document.querySelector(".home-trash-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}><Trash2 size={16} />回收</button>

</div>

</div>

{error && <div className="error-msg home-error-msg">{error}</div>}

{homeSection === "projects" ? <>

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

{(currentUser?.role === "admin" || project.owner_user_id === currentUser?.id) && <div className="project-actions">

<button title={"分享项目"} onClick={(event) => { event.stopPropagation(); setProjectShareResource({ ...project, resourceType: "project" }); }}><Share2 size={16} /></button>

<button title={"申请公开"} onClick={(event) => { event.stopPropagation(); setProjectPublicResource({ ...project, resourceType: "project" }); }}><Globe2 size={16} /></button>

<button title="重命名" onClick={(event) => { event.stopPropagation(); startRenameProject(project); }}><Edit3 size={16} /></button>

<button title="删除项目" aria-label={`删除 ${project.name}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>

</div>}

</article>

))}

{!visibleProjects.length && <div className="empty-state folder-empty">空文件夹</div>}

</div>

</> : <AnnotationTaskPanel projects={projects} currentUser={currentUser} onOpenItem={(item, context) => setCollaborationViewer({ item, context })} />}

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

<ShareDialog open={Boolean(projectShareResource)} resource={projectShareResource} onClose={() => setProjectShareResource(null)} />

<PublicRequestDialog open={Boolean(projectPublicResource)} resource={projectPublicResource} onClose={() => setProjectPublicResource(null)} />

{collaborationViewer && <ImageViewer items={[collaborationViewer.item]} index={0} setIndex={() => {}} onClose={() => setCollaborationViewer(null)} readOnly={collaborationViewer.context?.readOnly} saveAnnotations={collaborationViewer.context?.save} onSaved={() => setCollaborationViewer(null)} />}

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
      onSubmit={({ mode, credentials }) => (
        mode === "login" ? loginSession(credentials) : registerSession(credentials)
      )}
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

<img src={`/api/project-images/${item.id}/full`} draggable="false" onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })} />

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

