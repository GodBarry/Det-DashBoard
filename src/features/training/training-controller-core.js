export function createDefaultTrainingForm(restoredTrainingForm) {
  return {
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
    ...(restoredTrainingForm || {}),
  };
}

function buildDatasetSplits(trainingForm) {
  return {
    trainProjectId: trainingForm.trainProjectId || trainingForm.datasetProjectId || null,
    trainProjectIds: trainingForm.trainProjectIds?.length
      ? trainingForm.trainProjectIds
      : (trainingForm.trainProjectId ? [trainingForm.trainProjectId] : []),
    valProjectId: trainingForm.valProjectId || null,
    valProjectIds: trainingForm.valProjectIds?.length
      ? trainingForm.valProjectIds
      : (trainingForm.valProjectId ? [trainingForm.valProjectId] : []),
    testProjectId: trainingForm.testProjectId || null,
    testProjectIds: trainingForm.testProjectIds?.length
      ? trainingForm.testProjectIds
      : (trainingForm.testProjectId ? [trainingForm.testProjectId] : []),
  };
}

export function buildTrainingPayload(trainingForm) {
  return {
    name: trainingForm.name,
    datasetProjectId: trainingForm.trainProjectId || trainingForm.datasetProjectId,
    datasetSplits: buildDatasetSplits(trainingForm),
    datasetFilters: trainingForm.datasetFilters,
    modelId: trainingForm.modelId || null,
    templateId: trainingForm.templateId || null,
    initializationStrategy: trainingForm.initializationMode,
    resume: Boolean(trainingForm.resume),
    savePeriod: Number(trainingForm.savePeriod),
    taskType: trainingForm.taskType,
    pythonEnvId: trainingForm.pythonEnvId || null,
    initialModelVersionId: ["pretrained", "training"].includes(trainingForm.initializationMode)
      ? (trainingForm.initialModelVersionId || null)
      : null,
    params: {
      ...(trainingForm.algorithmParams || {}),
      python: trainingForm.python,
      initializationMode: trainingForm.initializationMode,
      initializationStrategy: trainingForm.initializationMode,
      resume: Boolean(trainingForm.resume),
      yoloVersion: trainingForm.yoloVersion,
      yolo_version: trainingForm.yoloVersion === "v11"
        ? "yolo11"
        : `yolov${String(trainingForm.yoloVersion || "v8").replace(/^v/i, "")}`,
      epochs: Number(trainingForm.epochs),
      imgsz: Number(trainingForm.imgsz),
      batch: Number(trainingForm.batch),
      learningRate: Number(trainingForm.learningRate),
      lr0: Number(trainingForm.learningRate),
      optimizer: trainingForm.optimizer,
      savePeriod: Number(trainingForm.savePeriod),
      save_period: Number(trainingForm.savePeriod),
      datasetSplits: buildDatasetSplits(trainingForm),
      datasetFilters: trainingForm.datasetFilters,
      earlyStop: Boolean(trainingForm.earlyStop),
      amp: Boolean(trainingForm.amp),
      freezeBackbone: Boolean(trainingForm.freezeBackbone),
      device: trainingForm.device,
    },
  };
}

export function buildTrainingRequeuePayload(trainingForm) {
  return {
    params: {
      python: trainingForm.python,
      initialModelVersionId: trainingForm.initialModelVersionId || undefined,
    },
  };
}
