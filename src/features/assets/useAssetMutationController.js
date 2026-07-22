import { useCallback, useState } from "react";

const initialModelForm = { name: "", taskType: "detect", framework: "ultralytics", description: "" };
const initialVersionForm = { modelId: "", versionName: "", sourcePath: "", datasetProjectId: "unknown", stage: "pretrained" };
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

  async function createModelVersion() {
    try {
      const response = await fetch("/api/ml/model-versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(versionForm),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.error || messages.createModelVersion);
      setVersionForm({ ...initialVersionForm, modelId: versionForm.modelId });
      await loadMlPlatform();
      return data.version;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  const inspectModelWeight = useCallback(async (payload) => {
    const response = await fetch("/api/ml/model-versions/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(data.error || "权重文件解析失败");
    return data.analysis;
  }, []);

  async function deleteModelVersion(version) {
    if (!window.confirm(`确定删除模型版本“${version.version_name}”吗？`)) return;
    const response = await fetch(`/api/ml/model-versions/${encodeURIComponent(version.id)}`, { method: "DELETE" });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      setError(data.error || "删除模型版本失败");
      return;
    }
    await loadMlPlatform();
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
    deleteModelVersion,
    createPythonEnv,
    envForm,
    modelForm,
    inspectModelWeight,
    renameModelVersion,
    setEnvForm,
    setModelForm,
    setVersionForm,
    versionForm,
  };
}
