import { useState } from "react";

const initialModelForm = { name: "", taskType: "detect", framework: "ultralytics", description: "" };
const initialVersionForm = { modelId: "", versionName: "", sourcePath: "", stage: "pretrained" };
const initialEnvForm = { name: "", sourceType: "conda_pack", pythonPath: "", condaPackPath: "", unpackPath: "" };

export function useAssetMutationController({
  loadMlPlatform,
  messages,
  promptForModelVersionName,
  setError,
}) {
  const [modelForm, setModelForm] = useState(initialModelForm);
  const [versionForm, setVersionForm] = useState(initialVersionForm);
  const [envForm, setEnvForm] = useState(initialEnvForm);

  function createModel() {
    fetch("/api/ml/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(modelForm),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || messages.createModel);

        setModelForm(initialModelForm);
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
        if (status >= 400) throw new Error(data.error || messages.createModelVersion);

        setVersionForm({ ...initialVersionForm, modelId: versionForm.modelId });
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function createPythonEnv() {
    const payload = envForm.sourceType === "server_managed" || envForm.sourceType === "server_python"
      ? { ...envForm, sourceType: "server_managed", preferCondaPack: false }
      : envForm;

    fetch("/api/ml/python-envs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || messages.createPythonEnv);

        setEnvForm(initialEnvForm);
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function renameModelVersion(version) {
    const next = promptForModelVersionName(version);

    if (!next || next === version.version_name) return;

    fetch(`/api/ml/model-versions/${version.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versionName: next }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || messages.renameModelVersion);

        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  return {
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
  };
}
