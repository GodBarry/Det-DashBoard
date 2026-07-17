import { ArrowLeft } from "lucide-react";

import { evaluationClusterLabels } from "../../shared/presentation.js";

export function EvaluationDetailPage({ task, onBack, onRunDetail, onReport, parseMaybeJson }) {

const job = task.sourceJob || {};

const params = parseMaybeJson(job.params_json);

const detailItems = [

["任务名称", task.name], ["任务ID", task.id], ["创建", task.creator], ["创建时间", task.createdAt],

["任务描述", task.description], ["模型", evaluationClusterLabels[task.cluster] || task.cluster],

["算法名称", job.template_name || params.templateName || "默认推理算法"],

["加载权重", job.model_name ? job.model_name + " / " + (job.version_name || "版本") : "未指定模型版"],

];

return (

<div className="evaluation-detail-page">

<div className="evaluation-detail-toolbar"><button type="button" onClick={onBack}><ArrowLeft size={14} />返回测试评估</button></div>

<section className="evaluation-detail-card platform-card"><div className="section-title-row"><h2>任务详情</h2></div><div className="evaluation-detail-grid">{detailItems.map(([label, value]) => <div className="evaluation-detail-item" key={label}><span>{label}</span><b>{value || "--"}</b></div>)}</div></section>

<section className="evaluation-run-card platform-card"><div className="evaluation-run-actions"><button type="button" onClick={() => onRunDetail(task)}>推理结果</button><button type="button" onClick={() => onReport(task)}>评估报告</button></div></section>

</div>

);

}
