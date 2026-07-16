import { useEffect, useState } from "react";

import {
  buildTrainingPayload,
  buildTrainingRequeuePayload,
  createDefaultTrainingForm,
} from "./training-controller-core.js";

const requestWithFetch = (...args) => fetch(...args);
const confirmWithWindow = (message) => window.confirm(message);

export function useTrainingController({
  activeTrainingJobId,
  currentUser,
  loadMlPlatform,
  restoredTrainingForm,
  setActiveTrainingJobId,
  setError,
  trainingJobs,
  request = requestWithFetch,
  confirmDelete = confirmWithWindow,
}) {
  const [trainingForm, setTrainingForm] = useState(
    () => createDefaultTrainingForm(restoredTrainingForm),
  );
  const [trainingLogs, setTrainingLogs] = useState([]);

  useEffect(() => {
    if (!currentUser || !activeTrainingJobId || String(activeTrainingJobId).startsWith("mock-")) {
      setTrainingLogs([]);
      return;
    }

    request(`/api/ml/training-jobs/${activeTrainingJobId}/logs`)
      .then((response) => response.json())
      .then((data) => setTrainingLogs(data.logs || []))
      .catch(() => {});
  }, [activeTrainingJobId, trainingJobs, currentUser?.id, request]);

  function submitTrainingJob() {
    request("/api/ml/training-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildTrainingPayload(trainingForm)),
    })
      .then((response) => Promise.all([response.status, response.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "提交训练失败");

        setTrainingForm({ ...trainingForm, name: "" });
        loadMlPlatform();
      })
      .catch((error) => setError(error.message));
  }

  function requeueTrainingJob(jobId) {
    request(`/api/ml/training-jobs/${jobId}/requeue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildTrainingRequeuePayload(trainingForm)),
    })
      .then((response) => Promise.all([response.status, response.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "重新入队失败");

        setActiveTrainingJobId(jobId);
        loadMlPlatform();
      })
      .catch((error) => setError(error.message));
  }

  function updateTrainingJobState(jobId, action) {
    request(`/api/ml/training-jobs/${jobId}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    })
      .then((response) => Promise.all([response.status, response.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "训练任务状态更新失败");

        setActiveTrainingJobId(jobId);
        loadMlPlatform();
      })
      .catch((error) => setError(error.message));
  }

  function deleteTrainingJob(jobId) {
    if (!confirmDelete("确定删除该训练任务吗？正在运行的任务会先停止。")) return;

    request(`/api/ml/training-jobs/${jobId}`, { method: "DELETE" })
      .then((response) => Promise.all([response.status, response.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "删除训练任务失败");

        if (activeTrainingJobId === jobId) setActiveTrainingJobId(null);
        loadMlPlatform();
      })
      .catch((error) => setError(error.message));
  }

  return {
    deleteTrainingJob,
    requeueTrainingJob,
    setTrainingForm,
    submitTrainingJob,
    trainingForm,
    trainingLogs,
    updateTrainingJobState,
  };
}
