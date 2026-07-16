import { useEffect, useState } from "react";

import { readUiState, updateUiState } from "../../app/ui-state.js";
import { formatDateTime } from "../../shared/presentation.js";

export function useEvaluationController({ inferenceJobs }) {
  const [evaluationCluster, setEvaluationCluster] = useState("all");
  const [evaluationType, setEvaluationType] = useState("all");
  const [hiddenEvaluationJobIds, setHiddenEvaluationJobIds] = useState([]);
  const [activeEvaluationTask, setActiveEvaluationTask] = useState(null);
  const [activeEvaluationReportTask, setActiveEvaluationReportTask] = useState(null);
  const [selectedEvaluationTaskId, setSelectedEvaluationTaskId] = useState(
    () => readUiState().evaluation?.selectedTaskId || "",
  );

  useEffect(() => {
    updateUiState({ evaluation: { selectedTaskId: selectedEvaluationTaskId } });
  }, [selectedEvaluationTaskId]);

  const evaluationTasks = inferenceJobs
    .filter((job) => !hiddenEvaluationJobIds.includes(job.id))
    .map((job) => {
      const cluster = job.task_type || job.taskType || "detect";
      const modelText = job.model_name
        ? `${job.model_name}/${job.version_name || "版本"}`
        : "未指定模型版";

      return {
        id: job.id,
        name: job.name || `推理任务 ${job.id}`,
        cluster,
        type: "inference",
        description:
          job.message ||
          `${job.dataset_project_name || "未绑定数据集"} · ${modelText} · 已完成推理任务，可进入评估`,
        creator: job.created_by || job.creator || "admin",
        createdAt: formatDateTime(job.created_at),
        sourceJob: job,
      };
    });

  const filteredEvaluationTasks = evaluationTasks.filter((task) => {
    const clusterMatch = evaluationCluster === "all" || task.cluster === evaluationCluster;
    const typeMatch = evaluationType === "all" || task.type === evaluationType;
    return clusterMatch && typeMatch;
  });

  const hideEvaluationTask = (taskId) => {
    setHiddenEvaluationJobIds((ids) => Array.from(new Set([...ids, taskId])));
  };

  return {
    activeEvaluationReportTask,
    activeEvaluationTask,
    evaluationCluster,
    evaluationType,
    filteredEvaluationTasks,
    hideEvaluationTask,
    selectedEvaluationTaskId,
    setActiveEvaluationReportTask,
    setActiveEvaluationTask,
    setEvaluationCluster,
    setEvaluationType,
    setSelectedEvaluationTaskId,
  };
}
