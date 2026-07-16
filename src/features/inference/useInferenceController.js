import { useState } from "react";

import {
  buildInferencePayload,
  createDefaultInferenceForm,
  normalizeInferenceJobIds,
  resolveInferenceAlgorithm,
  validateInferenceSubmission,
} from "./inference-controller-core.js";

const requestWithFetch = (...args) => fetch(...args);
const confirmWithWindow = (message) => window.confirm(message);

export function useInferenceController({
  algorithmAssets,
  loadMlPlatform,
  restoredInferenceForm,
  setError,
  request = requestWithFetch,
  confirmDelete = confirmWithWindow,
}) {
  const [inferenceForm, setInferenceForm] = useState(
    () => createDefaultInferenceForm(restoredInferenceForm),
  );
  const [activeInferenceResult, setActiveInferenceResult] = useState(null);

  function submitInferenceJob() {
    const algorithmResolution = resolveInferenceAlgorithm(inferenceForm, algorithmAssets);
    const validationError = validateInferenceSubmission(inferenceForm, algorithmResolution);

    if (validationError) {
      setError(validationError);
      return;
    }

    request("/api/ml/inference-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildInferencePayload(
        inferenceForm,
        algorithmResolution.selectedAlgorithm,
      )),
    })
      .then((response) => Promise.all([response.status, response.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "提交推理失败");

        setInferenceForm({ ...inferenceForm, name: "" });
        loadMlPlatform();
      })
      .catch((error) => setError(error.message));
  }

  function deleteInferenceJob(jobId) {
    if (!confirmDelete("确认删除这个推理任务")) return;

    request(`/api/ml/inference-jobs/${jobId}`, { method: "DELETE" })
      .then((response) => Promise.all([response.status, response.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "删除推理任务失败");

        loadMlPlatform();
      })
      .catch((error) => setError(error.message));
  }

  function requeueInferenceJob(jobId) {
    request(`/api/ml/inference-jobs/${jobId}/requeue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    })
      .then((response) => Promise.all([
        response.status,
        response.json().catch(() => ({})),
      ]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "重新开始推理任务失败");

        loadMlPlatform();
      })
      .catch((error) => setError(error.message || "重新开始推理任务失败"));
  }

  function deleteInferenceJobs(jobIds) {
    const ids = normalizeInferenceJobIds(jobIds);

    if (!ids.length) {
      setError("请选择要删除的推理任务");
      return Promise.resolve(false);
    }

    if (!confirmDelete(`确认删除 ${ids.length} 个推理任务？`)) return Promise.resolve(false);

    return Promise.all(ids.map((jobId) => (
      request(`/api/ml/inference-jobs/${jobId}`, { method: "DELETE" })
        .then((response) => Promise.all([
          response.status,
          response.json().catch(() => ({})),
        ]))
        .then(([status, data]) => {
          if (status >= 400) throw new Error(data.error || "删除推理任务失败");
          return data;
        })
    )))
      .then(() => {
        loadMlPlatform();
        return true;
      })
      .catch((error) => {
        setError(error.message);
        return false;
      });
  }

  function viewInferenceResults(job) {
    setError(null);
    setActiveInferenceResult({ job, results: [], loading: true });

    request(`/api/ml/inference-jobs/${job.id}/results`)
      .then((response) => Promise.all([response.status, response.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "读取推理结果失败");

        setActiveInferenceResult({ job, results: data.results || [], loading: false });
      })
      .catch((error) => {
        setActiveInferenceResult(null);
        setError(error.message);
      });
  }

  return {
    activeInferenceResult,
    deleteInferenceJob,
    deleteInferenceJobs,
    inferenceForm,
    requeueInferenceJob,
    setActiveInferenceResult,
    setInferenceForm,
    submitInferenceJob,
    viewInferenceResults,
  };
}
