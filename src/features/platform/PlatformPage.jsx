import { useState } from "react";
import { MainNav } from "../../components/layout/MainNav.jsx";
import { AuthDialog, SettingsDialog } from "../../app/AppOverlays.jsx";
import { AssetManagementWorkspace } from "../assets/AssetManagementWorkspace.jsx";
import { EvaluationDetailPage } from "../evaluation/EvaluationDetailPage.jsx";
import { EvaluationPage } from "../evaluation/EvaluationPage.jsx";
import { EvaluationReportPage } from "../evaluation/EvaluationReportPage.jsx";
import { useEvaluationController } from "../evaluation/useEvaluationController.js";
import { InferenceResultDialog } from "../inference/InferenceResultDialog.jsx";
import { InferenceWorkspace } from "../inference/InferenceWorkspace.jsx";
import { TrainingWorkspace } from "../training/TrainingWorkspace.jsx";
import {
  bestAssetLink,
  envTooltip,
  formatMetric,
  modelFamilyLabel,
  parseMaybeJson,
  predictionBoxStyle,
  predictionColor,
  predictionItems,
  predictionLegend,
  projectTreeRows,
  versionTooltip,
} from "./mlPresentation.js";
import {
  formatCount,
  formatDateTime,
  runStatusLabel,
} from "../../shared/presentation.js";
import {
  AdminCenter,
  PublicRequestDialog,
  ScopeTabs,
  ShareDialog,
} from "../../multi-user-ui.jsx";

export function PlatformPage({
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
  const title = view === "training"
    ? "训练平台"
    : view === "inference"
      ? "推理平台"
      : view === "evaluation"
        ? "测试评估平台"
        : view === "admin"
          ? "管理员中心"
          : "资产";

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
      <MainNav
        view={view}
        goHome={openDatasetView || (() => { setView("home"); setError(null); })}
        openPlatform={openPlatform}
        theme={theme}
        setTheme={setTheme}
        user={currentUser}
        onLogin={() => setAuthMode("login")}
        onLogout={onLogout}
        onSettings={openSettings}
      />

      {!['training', 'inference', 'models', 'evaluation'].includes(view) && (
        <header className="app-header"><div><h1>{title}</h1></div></header>
      )}

      <main className={`platform-page ${view === "training" ? "training-platform-page" : ""} ${view === "inference" ? "inference-platform-page" : ""} ${view === "models" ? "asset-platform-page" : ""} ${view === "evaluation" ? "evaluation-platform-page" : ""}`}>
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>&times;</button>
          </div>
        )}

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
        {authMode && (
          <AuthDialog
            mode={authMode}
            setMode={setAuthMode}
            required={!currentUser}
            onClose={() => setAuthMode(null)}
            onSignedIn={setCurrentUser}
          />
        )}
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

export default PlatformPage;
