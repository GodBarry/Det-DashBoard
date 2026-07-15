import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  Download,
  FolderOpen,
  Grid,
  Image as ImageIcon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tags,
} from "lucide-react";

import {
  completedEvaluationStatuses,
  formatCount,
  formatDateTime,
  formatDuration,
  runStatusLabel,
} from "../../shared/presentation.js";
import { EvaluationConfusionMatrix } from "./EvaluationConfusionMatrix.jsx";
import { EvaluationCurve } from "./EvaluationCurve.jsx";
import { EvaluationSampleViewer } from "./EvaluationSampleViewer.jsx";
import { evaluationBarPalette, evaluationErrorBoxes } from "./evaluationPresentation.js";

export function EvaluationPage({ tasks, selectedTaskId, setSelectedTaskId, parseMaybeJson, predictionItems, predictionBoxStyle, formatMetric }) {

const [searchText, setSearchText] = useState("");

const [statusFilter, setStatusFilter] = useState("all");

const [previewRows, setPreviewRows] = useState([]);

const [evaluation, setEvaluation] = useState(null);

const [activeAnalysis, setActiveAnalysis] = useState("overview");

const [errorFilter, setErrorFilter] = useState("false_negative");
  const [sampleOffset, setSampleOffset] = useState(0);
  const [sampleViewer, setSampleViewer] = useState(null);

useEffect(() => {

if (!tasks.length) return;

if (!tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(tasks[0]?.id || "");

}, [tasks, selectedTaskId]);

const filteredTasks = tasks.filter((task) => {

const status = String(task.sourceJob?.status || "").toLowerCase();

const statusMatch = statusFilter === "all" || (statusFilter === "done" ? completedEvaluationStatuses.has(status) : status === "failed");

const query = searchText.trim().toLowerCase();

return statusMatch && (!query || task.name.toLowerCase().includes(query) || String(task.sourceJob?.dataset_project_name || "").toLowerCase().includes(query));

});

const selectedTask = tasks.find((task) => task.id === selectedTaskId) || filteredTasks[0] || tasks[0];

const selectedJob = selectedTask?.sourceJob || {};

const storedMetrics = parseMaybeJson(selectedJob.metrics_json);

useEffect(() => {

if (!selectedJob.id) {

setPreviewRows([]);

setEvaluation(null);

return;

}

let ignore = false;

Promise.all([

fetch("/api/ml/inference-jobs/" + selectedJob.id + "/results").then((response) => response.json()),

fetch("/api/ml/inference-jobs/" + selectedJob.id + "/evaluation").then((response) => response.json()),

]).then(([resultsData, evaluationData]) => {

if (ignore) return;

setPreviewRows(resultsData.results || []);

setEvaluation(evaluationData.evaluation || null);

}).catch(() => {

if (ignore) return;

setPreviewRows([]);

setEvaluation(null);

});

return () => { ignore = true; };

}, [selectedJob.id]);

const metrics = { ...storedMetrics, ...(evaluation?.summary || {}), avg_iou: evaluation?.summary?.avgIou ?? storedMetrics.avg_iou };

const doneCount = tasks.filter((task) => completedEvaluationStatuses.has(String(task.sourceJob?.status || "").toLowerCase())).length;

const failedCount = tasks.filter((task) => String(task.sourceJob?.status || "").toLowerCase() === "failed").length;

const imageCount = metrics.images ?? selectedJob.image_count ?? previewRows.length ?? 0;

const predictionCount = metrics.predictions ?? selectedJob.prediction_count ?? previewRows.reduce((sum, row) => sum + predictionItems(row.predictions_json).length, 0);

const kpis = [

["Precision", formatMetric(metrics.precision)],

["Recall", formatMetric(metrics.recall)],

["F1", formatMetric(metrics.f1)],

["mAP50", formatMetric(metrics.map50)],

["mAP50-95", formatMetric(metrics.map)],

["Avg IoU", formatMetric(metrics.avg_iou)],

["推荐阈值", evaluation?.summary ? Number(evaluation.summary.recommendedConfidence || 0).toFixed(2) : "--"],

];

const allClassRows = (evaluation?.perClass || []).slice().sort((a, b) => Number(b.ap50 || 0) - Number(a.ap50 || 0));

  const classRows = allClassRows.slice(0, 8);

const rankRows = allClassRows.length > 8 && allClassRows.slice(0, 8).every((row) => Number(row.ap50 || 0) >= 0.995)

? [...allClassRows.slice(0, 4), ...allClassRows.slice(-4)].filter((row, index, rows) => rows.findIndex((item) => item.label === row.label) === index)

: classRows;

const curves = evaluation?.curves || [];

  const weakestClass = allClassRows.filter((row) => Number.isFinite(Number(row.ap50))).slice().sort((a, b) => Number(a.ap50) - Number(b.ap50))[0];

const insightRows = evaluation?.evaluated ? [

weakestClass ? weakestClass.label + " 的 AP50 最低，为 " + formatMetric(weakestClass.ap50) + "" : "暂无类别级结论",

"当前漏检 " + formatCount(evaluation.summary?.fn || 0) + " 个，误检 " + formatCount(evaluation.summary?.fp || 0) + " 个",

"平均匹配 IoU 为 " + formatMetric(evaluation.summary?.avgIou || 0) + "",

"推荐置信度阈值为 " + Number(evaluation.summary?.recommendedConfidence || 0).toFixed(2) + "",

] : [evaluation?.reason || "正在计算真实评估结果"];

const problemCounts = (evaluation?.errors || []).reduce((result, row) => ({

false_negative: result.false_negative + Number(row.counts?.false_negative || 0),

false_positive: result.false_positive + Number(row.counts?.false_positive || 0),

localization: result.localization + Number(row.counts?.localization || 0),

class_error: result.class_error + Number(row.counts?.class_error || 0),

}), { false_negative: 0, false_positive: 0, localization: 0, class_error: 0 });

const errorRows = (evaluation?.errors || []).filter((row) => Number(row.counts?.[errorFilter] || 0) > 0);

const samples = (errorRows.length ? errorRows : previewRows).slice(0, 5);

const visibleSampleRows = errorRows.length ? errorRows : previewRows;
  const sampleWindow = visibleSampleRows.slice(sampleOffset, sampleOffset + 5);
  const shiftSamples = (delta) => setSampleOffset((value) => Math.max(0, Math.min(Math.max(0, visibleSampleRows.length - 5), value + delta)));
  const errorTabs = [["false_negative", "漏检"], ["false_positive", "误检"], ["localization", "定位偏差"], ["class_error", "类别错误"]];

return (

<div className="evaluation-viz-workspace">

<aside className="evaluation-runs">

<div className="evaluation-runs-head"><h2>推理记录</h2><button title="筛"><SlidersHorizontal size={14} /></button></div>

<label className="evaluation-run-search"><Search size={14} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索任务名称或数据集" /></label>

<div className="evaluation-status-tabs">

<button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>全部</button>

<button className={statusFilter === "done" ? "active" : ""} onClick={() => setStatusFilter("done")}>已完</button>

<button className={statusFilter === "failed" ? "active" : ""} onClick={() => setStatusFilter("failed")}>失败</button>

</div>

<div className="evaluation-run-list">

{filteredTasks.map((task) => {

const job = task.sourceJob || {};

const active = task.id === selectedTask?.id;

const done = completedEvaluationStatuses.has(String(job.status || "").toLowerCase());

const rowMetrics = parseMaybeJson(job.metrics_json);

return (

<button className={"evaluation-run-row " + (active ? "active" : "")} key={task.id} onClick={() => setSelectedTaskId(task.id)}>

<span className="evaluation-run-check">{active ? <CheckCircle2 size={14} /> : <span />}</span>

<span className="evaluation-run-content">

<b>{task.name}</b><small>数据集：{job.dataset_project_name || "未绑"}</small><small>模型：{job.model_name || "未指"}</small>

<small>完成时间：{formatDateTime(job.finished_at || job.created_at)}</small>

<em>{formatCount(rowMetrics.images ?? job.image_count ?? 0)} 张图　|　{formatCount(rowMetrics.predictions ?? job.prediction_count ?? 0)} 个预测</em>

</span>

<i className={done ? "done" : "failed"}>{done ? "已完" : runStatusLabel(job.status)}</i>

</button>

);

})}

{!filteredTasks.length && <div className="empty-state">暂无推理记录</div>}

</div>

<div className="evaluation-run-footer"><span>共 {tasks.length} 条记录</span><b>已完成 {doneCount}</b><em>失败 {failedCount}</em></div>

</aside>

<main className="evaluation-viz-main">

<div className="evaluation-viz-toolbar">

<div className="workspace-path-row"><FolderOpen size={15} /><span>推理记录</span><ChevronRight size={13} /><b>{selectedTask?.name || "评估结果"}</b><ChevronRight size={13} /><b>评估结果</b></div>

<div><button><Copy size={14} />对比基线</button><button><Download size={14} />导出报告</button><button onClick={() => setSelectedTaskId(selectedJob.id)}><RefreshCw size={14} />重新评估</button><button><ArrowLeft size={14} />返回推理</button></div>

</div>

<div className="evaluation-context-strip">

<span><Database size={14} />数据集：<b>{selectedJob.dataset_project_name || "--"}</b></span><span><Brain size={14} />模型：<b>{selectedJob.model_name || "--"}</b></span>

<span><Tags size={14} />标签版本：<b>{evaluation?.labelVersionId ? String(evaluation.labelVersionId).slice(0, 8) : "--"}</b></span>

<span><ImageIcon size={14} />图像数量：<b>{formatCount(imageCount)}</b></span><span><Boxes size={14} />预测数量：<b>{formatCount(predictionCount)}</b></span>

</div>

<div className="evaluation-kpis">{kpis.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b><em className="up">{evaluation?.evaluated ? "真实评估" : "等待数据"}</em></div>)}</div>

<div className="evaluation-analysis-tabs">

{[["overview", "性能概览"], ["classes", "类别表现"], ["confusion", "混淆矩阵"], ["threshold", "阈值分布"]].map(([id, label]) => <button key={id} className={activeAnalysis === id ? "active" : ""} onClick={() => setActiveAnalysis(id)}>{label}</button>)}

</div>

<section className="evaluation-analysis-stage">

{activeAnalysis === "overview" && <div className="evaluation-overview-grid">

<article className="evaluation-pr-chart"><h3>Precision-Recall 曲线</h3><EvaluationCurve kind="pr" curves={curves} /></article>

<div className="evaluation-mini-charts">

<article><h3>F1-Confidence 曲线</h3><EvaluationCurve kind="f1" curves={curves} /></article>

<article><h3>Precision-Confidence 曲线</h3><EvaluationCurve kind="precision" curves={curves} /></article>

<article><h3>Recall-Confidence 曲线</h3><EvaluationCurve kind="recall" curves={curves} /></article>

</div>

<article className="evaluation-live-class-bars"><h3>类别 AP 排名</h3>{rankRows.map((row, index) => <p key={row.label}><span>{row.label}</span><i><b style={{ width: Number(row.ap50 || 0) * 100 + "%", background: evaluationBarPalette[index % evaluationBarPalette.length] }} /></i><em>{formatMetric(row.ap50)}</em></p>)}</article>

<article className="evaluation-histogram"><h3>置信度 / F1 分布</h3><div>{curves.map((row) => <i key={row.confidence} style={{ height: Number(row.f1 || 0) * 100 + "%" }} />)}<span style={{ left: Number(evaluation?.summary?.recommendedConfidence || 0) * 100 + "%" }}>推荐阈值</span></div></article>

</div>}

{activeAnalysis === "classes" && <div className="evaluation-class-detail">

<h3>类别指标明细</h3><div className="evaluation-class-table"><b>类别</b><b>GT</b><b>预测</b><b>TP</b><b>FP</b><b>FN</b><b>Precision</b><b>Recall</b><b>AP50</b>

{classRows.map((row) => <React.Fragment key={row.label}><span>{row.label}</span><span>{row.groundTruth}</span><span>{row.predictions}</span><span>{row.tp}</span><span>{row.fp}</span><span>{row.fn}</span><span>{formatMetric(row.precision)}</span><span>{formatMetric(row.recall)}</span><span>{formatMetric(row.ap50)}</span></React.Fragment>)}

</div></div>}

{activeAnalysis === "confusion" && <div className="evaluation-confusion-panel"><h3>混淆矩阵热力</h3><EvaluationConfusionMatrix matrix={evaluation?.confusionMatrix} /></div>}

{activeAnalysis === "threshold" && <div className="evaluation-threshold-grid">

<article><h3>F1-Confidence</h3><EvaluationCurve kind="f1" curves={curves} /></article><article><h3>Precision-Confidence</h3><EvaluationCurve kind="precision" curves={curves} /></article><article><h3>Recall-Confidence</h3><EvaluationCurve kind="recall" curves={curves} /></article>

<div className="evaluation-threshold-table"><b>阈</b><b>Precision</b><b>Recall</b><b>F1</b>{curves.filter((_, index) => index % 4 === 0).map((row) => <React.Fragment key={row.confidence}><span>{row.confidence.toFixed(2)}</span><span>{formatMetric(row.precision)}</span><span>{formatMetric(row.recall)}</span><span>{formatMetric(row.f1)}</span></React.Fragment>)}</div>

</div>}

</section>

<section className="evaluation-error-samples">

<div className="evaluation-sample-head"><h3>错误样本</h3><div>{errorTabs.map(([id, label]) => <button key={id} className={errorFilter === id ? "active" : ""} onClick={() => { setErrorFilter(id); setSampleOffset(0); }}>{label}</button>)}</div><span>{visibleSampleRows.length} </span></div>

<div className="evaluation-sample-grid">

<button className="sample-scroll prev" disabled={sampleOffset <= 0} onClick={() => shiftSamples(-1)}><ChevronRight size={18} /></button>{sampleWindow.map((row, index) => <article key={row.id || row.projectImageId || index} onDoubleClick={() => setSampleViewer({ rows: visibleSampleRows, index: sampleOffset + index })}>{row.thumb_url ? <img src={row.thumb_url} alt={row.display_name || "错误样本"} /> : <div className={"evaluation-sample-placeholder sample-" + index} />}<span>{row.display_name || "图片结果"}</span>{evaluationErrorBoxes(row, errorFilter, predictionItems).map((box, boxIndex) => { const style = predictionBoxStyle(box.item, row); return style ? <i className={`sample-box ${box.type}`} key={boxIndex} style={style}><small>{box.label}</small>{box.type.includes("false_positive") && <strong>×</strong>}</i> : null; })}</article>)}<button className="sample-scroll next" disabled={sampleOffset >= Math.max(0, visibleSampleRows.length - 5)} onClick={() => shiftSamples(1)}><ChevronRight size={18} /></button>

{!samples.length && <div className="empty-state">当前类型没有错误样本</div>}

</div>

</section>

</main>

<aside className="evaluation-insights">

<h2>评估洞察</h2>

<section className="evaluation-rating"><span>总体评级</span><div><b>{evaluation?.evaluated ? (Number(metrics.map50 || 0) >= .7 ? "A" : Number(metrics.map50 || 0) >= .4 ? "B" : "C") : "--"}</b><strong>{evaluation?.evaluated ? "已评" : "无标"}</strong></div><p>发布建议 <em>{Number(metrics.map50 || 0) >= .5 ? "可进入验" : "暂不建议发布"}</em></p></section>

<section className="evaluation-problems"><h3>问题统计</h3><div><p><span>漏检</span><b>{problemCounts.false_negative}</b></p><p><span>误检</span><b>{problemCounts.false_positive}</b></p><p><span>定位偏差</span><b>{problemCounts.localization}</b></p><p><span>类别错误</span><b>{problemCounts.class_error}</b></p></div></section>

<section className="evaluation-key-insights"><h3>关键结论</h3>{insightRows.map((text) => <p key={text}>{text}</p>)}</section>

<section className="evaluation-class-rank"><h3>类别表现 <span>（按 AP50）</span></h3>{rankRows.map((row, index) => <p key={row.label}><em>{index + 1}</em><span>{row.label}</span><i><b style={{ width: Number(row.ap50 || 0) * 100 + "%", background: evaluationBarPalette[index % evaluationBarPalette.length] }} /></i><strong>{formatMetric(row.ap50)}</strong></p>)}</section>

<div className="evaluation-insight-actions"><button onClick={() => setActiveAnalysis("confusion")}><Grid size={14} />查看混淆矩阵</button><button className="primary"><Download size={14} />生成评估报告</button></div>

<section className="evaluation-run-info"><h3>运行信息</h3><p><span>推理记录</span><b>{selectedTask?.name || "--"}</b></p><p><span>运行时间</span><b>{formatDateTime(selectedJob.finished_at)}</b></p><p><span>推理时长</span><b>{formatDuration(selectedJob.created_at, selectedJob.finished_at)}</b></p><p><span>评估状态</span><b>{evaluation?.evaluated ? "真实标注评估" : "等待标注"}</b></p></section>

</aside>

{sampleViewer && <EvaluationSampleViewer rows={sampleViewer.rows} initialIndex={sampleViewer.index} filter={errorFilter} onClose={() => setSampleViewer(null)} getErrorBoxes={(row, filter) => evaluationErrorBoxes(row, filter, predictionItems)} getBoxStyle={predictionBoxStyle} />}

</div>

);

}
