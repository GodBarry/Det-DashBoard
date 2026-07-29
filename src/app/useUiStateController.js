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
  const [activeProjectId, setActiveProjectId] = useState(() => (
    restoredUiState.view === "workspace" ? restoredUiState.activeProjectId || null : null
  ));
  const [activeTrainingJobId, setActiveTrainingJobId] = useState(
    () => restoredUiState.activeTrainingJobId || null,
  );
  const restoredSelectedImageIdRef = useRef(restoredUiState.selectedImageId || null);

  const consumeRestoredSelected = (items) => {
    const restoredSelected = restoredSelectedImageIdRef.current
      ? items?.find((item) => item.id === restoredSelectedImageIdRef.current)
      : null;
    if (restoredSelected) restoredSelectedImageIdRef.current = null;
    return restoredSelected;
  };

  const persistUiState = ({ selected, trainingForm, inferenceForm }) => {
    const persistedSelectedImageId = selected?.id
      || (view === "workspace" ? restoredSelectedImageIdRef.current : null);
    updateUiState({
      view,
      theme,
      currentFolderId,
      activeProjectId: view === "workspace" ? activeProjectId : null,
      selectedImageId: persistedSelectedImageId,
      activeTrainingJobId,
      trainingForm: { ...trainingForm },
      inferenceForm: { ...inferenceForm },
    });
  };

  return {
    activeTrainingJobId,
    activeProjectId,
    consumeRestoredSelected,
    currentFolderId,
    persistUiState,
    restoredInferenceForm: restoredUiState.inferenceForm,
    restoredTrainingForm: restoredUiState.trainingForm,
    setActiveTrainingJobId,
    setActiveProjectId,
    setCurrentFolderId,
    setTheme,
    setView,
    theme,
    view,
  };
}
