import { useEffect, useState } from "react";

import { withScope } from "../../api-client.js";
import { sortRuntimeJobsByTime } from "../../shared/presentation.js";

export function useMlPlatformController({ assetScope, currentUser, refreshHome, view }) {
  const [mlModels, setMlModels] = useState([]);
  const [modelVersions, setModelVersions] = useState([]);
  const [trainingJobs, setTrainingJobs] = useState([]);
  const [inferenceJobs, setInferenceJobs] = useState([]);
  const [trainingTemplates, setTrainingTemplates] = useState([]);
  const [algorithmAssets, setAlgorithmAssets] = useState([]);
  const [pythonEnvs, setPythonEnvs] = useState([]);
  const [assetLinks, setAssetLinks] = useState([]);

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

  useEffect(() => {
    if (!currentUser) return;

    if (!["training", "inference", "models", "evaluation"].includes(view)) return;

    loadMlPlatform();

    const timer = window.setInterval(() => loadMlPlatform(), 2500);

    return () => window.clearInterval(timer);
  }, [view, assetScope, currentUser?.id]);

  return {
    algorithmAssets,
    assetLinks,
    inferenceJobs,
    loadMlPlatform,
    mlModels,
    modelVersions,
    pythonEnvs,
    trainingJobs,
    trainingTemplates,
  };
}
