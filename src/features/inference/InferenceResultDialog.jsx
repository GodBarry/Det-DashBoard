import { X } from "lucide-react";
import {
  formatMetric,
  metricValue,
  parseMaybeJson,
  predictionItems,
} from "../platform/mlPresentation.js";

export function InferenceResultDialog({ resultState, onClose }) {
  const { job, results, loading } = resultState;
  const rows = results || [];
  const totalPredictions = rows.reduce(
    (sum, row) => sum + predictionItems(row.predictions_json).length,
    0,
  );
  const previewRows = rows.slice(0, 12);
  const params = parseMaybeJson(job.params_json);
  const output = params.output || {};
  const metrics = output.metrics || params.metrics || {};
  const outputPath = output.predictionsPath
    || rows.find((row) => row.artifact_path)?.artifact_path
    || job.output_root
    || "";
  const metricCards = [
    ["Precision", ["precision", "Precision", "p", "P"]],
    ["Recall", ["recall", "Recall", "r", "R"]],
    ["mAP50", ["map50", "mAP50", "map_50", "mAP_50"]],
    ["mAP50-95", ["map", "mAP", "map5095", "mAP50-95", "map_50_95"]],
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="result-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="section-title-row">
          <div>
            <h2>推理结果</h2>
            <p className="muted">{job.name} · {job.dataset_project_name || "未绑定数据集"}</p>
          </div>
          <button onClick={onClose}><X size={14} /></button>
        </div>

        <div className="result-summary">
          <div className={`result-status ${job.status}`}><span>任务状态</span><b>{job.status}</b></div>
          <div><span>图片结果</span><b>{loading ? "..." : rows.length}</b></div>
          <div><span>预测数量</span><b>{loading ? "..." : totalPredictions}</b></div>
        </div>

        <div className="metric-summary">
          {metricCards.map(([label, keys]) => (
            <div key={label}>
              <span>{label}</span>
              <b>{loading ? "..." : formatMetric(metricValue(metrics, keys))}</b>
            </div>
          ))}
        </div>

        <div className="result-path">
          <span>输出文件路径</span>
          <b>{outputPath || "暂无输出文件路径"}</b>
        </div>

        {loading ? (
          <div className="empty-state">正在读取结果...</div>
        ) : rows.length ? (
          <div className="result-table">
            <div className="result-table-head">
              <span>图片</span>
              <span>预测</span>
              <span>标签预览</span>
            </div>
            {previewRows.map((row) => {
              const predictions = predictionItems(row.predictions_json);
              const labels = Array.from(new Set(predictions.map((item) => item.label).filter(Boolean))).slice(0, 5);
              return (
                <div className="result-table-row" key={row.id || row.project_image_id || row.artifact_path}>
                  <b>{row.display_name || row.image_name || row.project_image_id || "图片结果"}</b>
                  <strong>{predictions.length}</strong>
                  <em>{labels.length ? labels.join("") : "无预测框"}</em>
                </div>
              );
            })}
            {rows.length > previewRows.length && (
              <p className="result-more">仅显示前 {previewRows.length} 条，共 {rows.length} 条图片结果</p>
            )}
          </div>
        ) : (
          <div className="empty-state">暂无图片级结果明细</div>
        )}
      </div>
    </div>
  );
}

export default InferenceResultDialog;
