import { useRef, useState } from "react";

import { readUiState, restorableViews, updateUiState } from "./ui-state.js";

export function useUiStateController() {
  const restoredUiStateRef = useRef(readUiState());
  const restoredUiState = restoredUiStateRef.current;
  const [view, setView] = useState(() => (
    restorableViews.has(restoredUiState.view) || restoredUiState.view === "admin"
      ? restoredUiState.view
      : "home"
  ));
  const [theme, setTheme] = useState(() => restoredUiState.theme === "dark" ? "dark" : "light");
  const [currentFolderId, setCurrentFolderId] = useState(() => restoredUiState.currentFolderId || null);
  const [activeTrainingJobId, setActiveTrainingJobId] = useState(
    () => restoredUiState.activeTrainingJobId || null,
  );
  const restoredActiveProjectIdRef = useRef(
    restoredUiState.view === "workspace" ? restoredUiState.activeProjectId || null : null,
  );
  const restoredSelectedImageIdRef = useRef(restoredUiState.selectedImageId || null);

  const consumeRestoredActiveProjectId = (currentProjectId) => {
    const projectId = currentProjectId || restoredActiveProjectIdRef.current;
    restoredActiveProjectIdRef.current = null;
    return projectId;
  };

  const consumeRestoredSelected = (items) => {
    const restoredSelected = restoredSelectedImageIdRef.current
      ? items?.find((item) => item.id === restoredSelectedImageIdRef.current)
      : null;
    if (restoredSelected) restoredSelectedImageIdRef.current = null;
    return restoredSelected;
  };

  const persistUiState = ({ activeProject, selected, trainingForm, inferenceForm }) => {
    const persistedActiveProjectId = activeProject?.id
      || (view === "workspace" ? restoredActiveProjectIdRef.current : null);
    const persistedSelectedImageId = selected?.id
      || (view === "workspace" ? restoredSelectedImageIdRef.current : null);
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
  };

  return {
    activeTrainingJobId,
    consumeRestoredActiveProjectId,
    consumeRestoredSelected,
    currentFolderId,
    persistUiState,
    restoredInferenceForm: restoredUiState.inferenceForm,
    restoredTrainingForm: restoredUiState.trainingForm,
    setActiveTrainingJobId,
    setCurrentFolderId,
    setTheme,
    setView,
    theme,
    view,
  };
}
