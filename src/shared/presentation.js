export const colors = ["#31d0aa", "#72a7ff", "#ffcc66", "#ff7c7c", "#b48cff", "#6ee7ff", "#f59bd3", "#a3e635"];

export const evaluationClusterLabels = { detect: "目标检测", segment: "实例分割", classify: "图像分类" };

export const evaluationTypeLabels = { training: "训练模型", inference: "推理模型" };

export const completedEvaluationStatuses = new Set(["done", "completed", "succeeded", "success"]);

export function taskLabel(task) {
  if (task === "detect") return "目标检测";
  if (task === "segment") return "实例分割";
  if (task === "classify") return "图像分类";
  return task || "未知任务";
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "--";
}

export function formatDuration(start, end) {
  if (!start || !end) return "--";
  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return "--";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

export function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

export function runStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (completedEvaluationStatuses.has(normalized)) return "运行完成";
  if (["pending", "preparing"].includes(normalized)) return "等待处理";
  if (normalized === "running") return "运行中";
  if (normalized === "failed") return "运行失败";
  if (normalized === "cancelled") return "已取消";
  return status || "未知状态态";
}

export function sortRuntimeJobsByTime(jobs = []) {
  return [...jobs].sort((left, right) => {
    const leftPriority = Number(left.priority || 0);
    const rightPriority = Number(right.priority || 0);
    if (rightPriority !== leftPriority) return rightPriority - leftPriority;
    const leftTime = Date.parse(left.finished_at || left.started_at || left.created_at || 0) || 0;
    const rightTime = Date.parse(right.finished_at || right.started_at || right.created_at || 0) || 0;
    return rightTime - leftTime;
  });
}
