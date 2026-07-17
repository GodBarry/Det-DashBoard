export function createDefaultInferenceForm(restoredInferenceForm) {
  return {
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
    ...(restoredInferenceForm || {}),
  };
}

export function resolveInferenceAlgorithm(inferenceForm, algorithmAssets) {
  const assets = algorithmAssets || [];
  const fakeAlgorithm = assets.find(
    (item) => item.algorithm_key === "fake_reference_detector"
      || item.template_key === "fake_reference_detector",
  );
  const selectedAlgorithm = inferenceForm.fakeReferenceMode
    ? fakeAlgorithm
    : assets.find((item) => item.id === inferenceForm.templateId);
  const algorithmKey = selectedAlgorithm?.algorithm_key || selectedAlgorithm?.template_key || "";

  return {
    algorithmKey,
    isBuiltInNoEnvAlgorithm: algorithmKey === "dummy_empty_detector"
      || algorithmKey === "fake_reference_detector",
    selectedAlgorithm,
  };
}

export function validateInferenceSubmission(inferenceForm, algorithmResolution) {
  if (!inferenceForm.datasetProjectId) return "请选择数据集项目";
  if (!algorithmResolution.selectedAlgorithm) return "请选择算法名称";

  if (!algorithmResolution.isBuiltInNoEnvAlgorithm) {
    if (!inferenceForm.pythonEnvId) return "真实算法推理需要先选择运行环境资产";
    if (!inferenceForm.modelVersionId) return "真实算法推理需要先选择模型权重版本";
  }

  return null;
}

function splitCommaSeparated(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function buildInferencePayload(inferenceForm, selectedAlgorithm) {
  return {
    name: inferenceForm.name,
    datasetProjectId: inferenceForm.datasetProjectId,
    modelVersionId: inferenceForm.fakeReferenceMode
      ? null
      : (inferenceForm.modelVersionId || null),
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
          scenes: splitCommaSeparated(inferenceForm.inputScenes),
          views: splitCommaSeparated(inferenceForm.inputViews),
          modalities: splitCommaSeparated(inferenceForm.inputModalities),
          importBatchIds: splitCommaSeparated(inferenceForm.inputImportBatchIds),
          labels: splitCommaSeparated(inferenceForm.inputLabels),
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
  };
}

export function normalizeInferenceJobIds(jobIds) {
  return Array.from(new Set((jobIds || []).filter(Boolean)));
}
