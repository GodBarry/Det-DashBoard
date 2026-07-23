import { useCallback, useEffect, useState } from "react";

import {
  buildInferencePayload,
  createDefaultInferenceForm,
  normalizeInferenceJobIds,
  resolveInferenceAlgorithm,
  validateNetworkInferenceSubmission,
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
  addInferenceJob,
  refreshInferenceJobs,
}) {
  const [inferenceForm, setInferenceForm] = useState(
    () => createDefaultInferenceForm(restoredInferenceForm),
  );
  const [activeInferenceResult, setActiveInferenceResult] = useState(null);
  const [networkInferenceService, setNetworkInferenceService] = useState({ running: false, status: "stopped", port: 4180 });

  const refreshNetworkInferenceStatus = useCallback(() => request("/api/ml/network-inference/status")
    .then((response) => Promise.all([response.status, response.json().catch(() => ({}))]))
    .then(([status, data]) => {
      if (status >= 400) throw new Error(data.error || "读取网络推理服务状态失败");
      setNetworkInferenceService(data.service || { running: false, status: "stopped", port: 4180 });
      return data.service;
    })
    .catch(() => null), [request]);

  useEffect(() => {
    refreshNetworkInferenceStatus();
    const timer = window.setInterval(refreshNetworkInferenceStatus, 5000);
    return () => window.clearInterval(timer);
  }, [refreshNetworkInferenceStatus]);

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

        addInferenceJob?.(data.job);
        setInferenceForm({ ...inferenceForm, name: "" });
        (refreshInferenceJobs || loadMlPlatform)();
      })
      .catch((error) => setError(error.message));
  }

  function startNetworkInference() {
    const algorithmResolution = resolveInferenceAlgorithm(inferenceForm, algorithmAssets);
    const validationError = validateNetworkInferenceSubmission(inferenceForm, algorithmResolution);
    if (validationError) return setError(validationError);
    request("/api/ml/network-inference/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildInferencePayload(inferenceForm, algorithmResolution.selectedAlgorithm)),
    })
      .then((response) => Promise.all([response.status, response.json().catch(() => ({}))]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "开启网络推理服务失败");
        setNetworkInferenceService(data.service);
        (refreshInferenceJobs || loadMlPlatform)();
      })
      .catch((error) => setError(error.message));
  }

  function stopNetworkInference() {
    request("/api/ml/network-inference/stop", { method: "POST", headers: { "content-type": "application/json" } })
      .then((response) => Promise.all([response.status, response.json().catch(() => ({}))]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "关闭网络推理服务失败");
        setNetworkInferenceService(data.service);
        (refreshInferenceJobs || loadMlPlatform)();
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

  function updateInferenceJobState(jobId, action) {
    request(`/api/ml/inference-jobs/${jobId}/${action}`, { method: "POST", headers: { "content-type": "application/json" } })
      .then((response) => Promise.all([response.status, response.json().catch(() => ({}))]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "推理任务状态更新失败");
        (refreshInferenceJobs || loadMlPlatform)();
      })
      .catch((error) => setError(error.message || "推理任务状态更新失败"));
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
    networkInferenceService,
    requeueInferenceJob,
    updateInferenceJobState,
    setActiveInferenceResult,
    setInferenceForm,
    submitInferenceJob,
    startNetworkInference,
    stopNetworkInference,
    viewInferenceResults,
  };
}
