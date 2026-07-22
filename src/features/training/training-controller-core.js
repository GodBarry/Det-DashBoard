export const DEFAULT_RECOGNITION_CLASSES = ["car", "tank", "zhuangjiache", "fasheche", "hanma", "buzhanche", "kache", "daodanfasheche"];

export function createDefaultTrainingForm(restoredTrainingForm) {
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  const legacySavePeriod = storage ? storage.getItem("det-dashboard.save-period-default-v2") !== "1" : false;
  if (legacySavePeriod) storage.setItem("det-dashboard.save-period-default-v2", "1");
  const form = {
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
    recognitionClasses: [...DEFAULT_RECOGNITION_CLASSES],
    classMappings: null,
    classMappingsConfigured: false,
    learningRate: 0.0032,
    optimizer: "SGD",
    savePeriod: 0,
    earlyStop: true,
    amp: true,
    freezeBackbone: false,
    device: "0",
    algorithmParams: {},
    ...(restoredTrainingForm || {}),
    savePeriod: legacySavePeriod ? 0 : Number(restoredTrainingForm?.savePeriod || 0),
  };
  return {
    ...form,
    recognitionClasses: Array.isArray(form.recognitionClasses) && form.recognitionClasses.length
      ? [...form.recognitionClasses]
      : [...DEFAULT_RECOGNITION_CLASSES],
    classMappings: form.classMappingsConfigured ? (Array.isArray(form.classMappings) ? form.classMappings : []) : null,
    classMappingsConfigured: Boolean(form.classMappingsConfigured),
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
      recognitionClasses: [...(trainingForm.recognitionClasses || DEFAULT_RECOGNITION_CLASSES)],
      classMappings: trainingForm.classMappingsConfigured ? (trainingForm.classMappings || []) : null,
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
