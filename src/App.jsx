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
import { useAssetMutationController } from "./features/assets/useAssetMutationController.js";
import { MainNav } from "./components/layout/MainNav.jsx";
import { EvaluationDetailPage } from "./features/evaluation/EvaluationDetailPage.jsx";
import { EvaluationPage } from "./features/evaluation/EvaluationPage.jsx";
import { EvaluationReportPage } from "./features/evaluation/EvaluationReportPage.jsx";
import { useEvaluationController } from "./features/evaluation/useEvaluationController.js";
import { SettingsDialog as SettingsDialogView } from "./features/settings/SettingsDialog.jsx";
import { useSettingsOverlayController } from "./features/settings/useSettingsOverlayController.js";
import { InferenceWorkspace } from "./features/inference/InferenceWorkspace.jsx";
import { useInferenceController } from "./features/inference/useInferenceController.js";
import { TrainingWorkspace } from "./features/training/TrainingWorkspace.jsx";
import { useTrainingController } from "./features/training/useTrainingController.js";
import { DatasetWorkspace } from "./features/datasets/DatasetWorkspace.jsx";
import { useBaselineController } from "./features/datasets/useBaselineController.js";
import { useDatasetImportController } from "./features/datasets/useDatasetImportController.js";
import { useDatasetWorkspaceController } from "./features/datasets/useDatasetWorkspaceController.js";
import { useProjectCatalogController } from "./features/datasets/useProjectCatalogController.js";
import { useMlPlatformController } from "./features/platform/useMlPlatformController.js";
import {
  bestAssetLink,
  envTooltip,
  formatMetric,
  metricValue,
  modelFamilyLabel,
  parseMaybeJson,
  predictionBoxStyle,
  predictionColor,
  predictionItems,
  predictionLegend,
  projectTreeRows,
  versionTooltip,
} from "./features/platform/mlPresentation.js";

import { useUiStateController } from "./app/useUiStateController.js";
import {
  evaluationTypeLabels,
  formatCount,
  formatDateTime,
  formatDuration,
  runStatusLabel,
  taskLabel,
} from "./shared/presentation.js";
import { useWorkspaceColumns } from "./shared/useWorkspaceColumns.jsx";
import { withScope } from "./api-client.js";
import { AdminCenter, AnnotationTaskPanel, PublicRequestDialog, ScopeTabs, ShareDialog } from "./multi-user-ui.jsx";

export default function App() {

const {
  activeTrainingJobId,
  consumeRestoredActiveProjectId,
  consumeRestoredSelected,
  currentFolderId,
  persistUiState,
  restoredInferenceForm,
  restoredTrainingForm,
  setActiveTrainingJobId,
  setCurrentFolderId,
  setTheme,
  setView,
  theme,
  view,
} = useUiStateController();

const { authMode, currentUser, setAuthMode, setCurrentUser, signOut } = useAuthSessionController();

const [userPermissions, setUserPermissions] = useState([]);

const [datasetScope, setDatasetScope] = useState(() => window.localStorage.getItem("det-dashboard-dataset-scope") || "mine");
const [assetScope, setAssetScope] = useState(() => window.localStorage.getItem("det-dashboard-asset-scope") || "mine");
const [homeSection, setHomeSection] = useState(() => window.localStorage.getItem("det-dashboard-home-section") || "projects");
const [projectShareResource, setProjectShareResource] = useState(null);
const [projectPublicResource, setProjectPublicResource] = useState(null);
const [collaborationViewer, setCollaborationViewer] = useState(null);

const { closeSettings, openSettings, showSettings } = useSettingsOverlayController();

const [error, setError] = useState(null);

const [appConfig, setAppConfig] = useState({ dataRoot: "/home/barry/图片", dataRootDisplay: "/home/barry/图片", browseRootDisplay: "/", browseAllDrives: false, hostDialogUrl: "", nativeDialogMode: "server" });

const datasetWorkspaceRef = useRef(null);

const {
  activeBreadcrumbs,
  activeChildProjects,
  activeProject,
  breadcrumbs,
  cancelRenameProject,
  commitRenameProject,
  createProject,
  currentFolder,
  deleteProject,
  deleteProjectPermanently,
  editingProjectId,
  editingProjectName,
  emptyProjectTrash,
  goHome,
  goUpFolder,
  homeExpandedIds,
  homeStats,
  openDatasetView,
  openHomeFolder,
  openProject,
  projectById,
  projectLastImportAt,
  projects,
  refreshHome,
  restoreAllProjects,
  restoreProject,
  setActiveProject,
  setEditingProjectName,
  setHomeExpandedIds,
  startRenameProject,
  trashProjects,
  visibleProjects,
  workspaceRoot,
} = useProjectCatalogController({
  fetch,
  prompt: (...args) => window.prompt(...args),
  confirm: (...args) => window.confirm(...args),
  withScope,
  datasetScope,
  view,
  currentFolderId,
  setCurrentFolderId,
  setView,
  setError,
  consumeRestoredActiveProjectId,
  resetWorkspace: () => datasetWorkspaceRef.current?.resetWorkspace(),
});

const {
  cancelLatestImport,
  checkedIds,
  deleteCheckedImages,
  deleteImport,
  emptyImportTrash,
  exportFormat,
  exportProject,
  filters,
  imports,
  items,
  jobs,
  lastCheckedId,
  latestImport,
  loadWorkspace,
  openWorkspaceTrash,
  page,
  pageSize,
  resetWorkspace,
  restoreImport,
  selected,
  setCheckedIds,
  setExportFormat,
  setFilters,
  setImports,
  setItems,
  setJobs,
  setLastCheckedId,
  setLatestImport,
  setPage,
  setSelected,
  setSummary,
  setTrashImports,
  setViewerIndex,
  summary,
  trashImports,
  viewerIndex,
} = useDatasetWorkspaceController({
  activeProject,
  currentUser,
  consumeRestoredSelected,
  setError,
  fetch,
});

datasetWorkspaceRef.current = { resetWorkspace };

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

const {
  algorithmAssets,
  assetLinks,
  inferenceJobs,
  loadMlPlatform,
  mlModels,
  modelVersions,
  pythonEnvs,
  trainingJobs,
  trainingTemplates,
} = useMlPlatformController({ assetScope, currentUser, refreshHome, view });

const {
  deleteTrainingJob,
  requeueTrainingJob,
  setTrainingForm,
  submitTrainingJob,
  trainingForm,
  trainingLogs,
  updateTrainingJobState,
} = useTrainingController({
  activeTrainingJobId,
  currentUser,
  loadMlPlatform,
  restoredTrainingForm,
  setActiveTrainingJobId,
  setError,
  trainingJobs,
});

const {
  activeInferenceResult,
  deleteInferenceJob,
  deleteInferenceJobs,
  inferenceForm,
  requeueInferenceJob,
  setActiveInferenceResult,
  setInferenceForm,
  submitInferenceJob,
  viewInferenceResults,
} = useInferenceController({
  algorithmAssets,
  confirmDelete: (message) => window.confirm(message),
  loadMlPlatform,
  restoredInferenceForm,
  setError,
});

const {
  createModel,
  createModelVersion,
  createPythonEnv,
  envForm,
  modelForm,
  renameModelVersion,
  setEnvForm,
  setModelForm,
  setVersionForm,
  versionForm,
} = useAssetMutationController({
  loadMlPlatform,
  setError,
  messages: {
    createModel: "创建模型簇失",
    createModelVersion: "登记模型版本失败",
    createPythonEnv: "登记环境失败",
    renameModelVersion: "重命名失",
  },
  promptForModelVersionName: (version) => window.prompt("请输入新的模型版本名", version.version_name),
});

useEffect(() => {
  persistUiState({ activeProject, selected, trainingForm, inferenceForm });
}, [view, theme, currentFolderId, activeProject, selected, activeTrainingJobId, trainingForm, inferenceForm]);

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

function openPlatform(nextView) {

setView(nextView);

setError(null);

loadMlPlatform();

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

<MainNav view={view} goHome={openDatasetView} openPlatform={openPlatform} theme={theme} setTheme={setTheme} user={currentUser} onLogin={() => setAuthMode("login")} onLogout={signOut} onSettings={openSettings} />

<DatasetWorkspace mode="home" viewModel={datasetViewModel} />

{authMode && <AuthDialog mode={authMode} setMode={setAuthMode} required={!currentUser} onClose={() => setAuthMode(null)} onSignedIn={setCurrentUser} />}

{showSettings && <SettingsDialog config={appConfig} onClose={closeSettings} />}

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
        openSettings={openSettings}
        closeSettings={closeSettings}
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

<MainNav view="home" goHome={openDatasetView} openPlatform={openPlatform} theme={theme} setTheme={setTheme} user={currentUser} onLogin={() => setAuthMode("login")} onLogout={signOut} onSettings={openSettings} />

<DatasetWorkspace mode="workspace" viewModel={datasetViewModel} />

{authMode && <AuthDialog mode={authMode} setMode={setAuthMode} required={!currentUser} onClose={() => setAuthMode(null)} onSignedIn={setCurrentUser} />}

{showSettings && <SettingsDialog config={appConfig} onClose={closeSettings} />}

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
  openSettings,
  closeSettings,
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

<MainNav view={view} goHome={openDatasetView || (() => { setView("home"); setError(null); })} openPlatform={openPlatform} theme={theme} setTheme={setTheme} user={currentUser} onLogin={() => setAuthMode("login")} onLogout={onLogout} onSettings={openSettings} />

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
        {showSettings && <SettingsDialog config={appConfig} onClose={closeSettings} />}
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
