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

Upload,

Video,

X,

} from "lucide-react";

import { useAuthSessionController } from "./features/auth/useAuthSessionController.js";
import { AssetManagementWorkspace } from "./features/assets/AssetManagementWorkspace.jsx";
import { useAssetMutationController } from "./features/assets/useAssetMutationController.js";
import { MainNav } from "./components/layout/MainNav.jsx";
import { EvaluationDetailPage } from "./features/evaluation/EvaluationDetailPage.jsx";
import { EvaluationPage } from "./features/evaluation/EvaluationPage.jsx";
import { EvaluationReportPage } from "./features/evaluation/EvaluationReportPage.jsx";
import { useEvaluationController } from "./features/evaluation/useEvaluationController.js";
import { useSettingsOverlayController } from "./features/settings/useSettingsOverlayController.js";
import { InferenceWorkspace } from "./features/inference/InferenceWorkspace.jsx";
import { InferenceResultDialog } from "./features/inference/InferenceResultDialog.jsx";
import { useInferenceController } from "./features/inference/useInferenceController.js";
import { TrainingWorkspace } from "./features/training/TrainingWorkspace.jsx";
import { useTrainingController } from "./features/training/useTrainingController.js";
import { DatasetWorkspace } from "./features/datasets/DatasetWorkspace.jsx";
import { useBaselineController } from "./features/datasets/useBaselineController.js";
import { useDatasetImportController } from "./features/datasets/useDatasetImportController.js";
import { useDatasetWorkspaceController } from "./features/datasets/useDatasetWorkspaceController.js";
import { useProjectCatalogController } from "./features/datasets/useProjectCatalogController.js";
import { useMlPlatformController } from "./features/platform/useMlPlatformController.js";
import { PlatformPage as PlatformPageView } from "./features/platform/PlatformPage.jsx";
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
import { AuthDialog, SettingsDialog } from "./app/AppOverlays.jsx";
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

<PlatformPageView

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

