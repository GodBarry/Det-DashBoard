import React, { useState } from "react";
import { ArrowLeft } from "lucide-react";

export function EvaluationReportPage({ task, onBack }) {

const [expandedAp, setExpandedAp] = useState("类别");

const classes = ["车辆", "人员", "设备", "背景"];

const matrix = [

[96, 4, 2, 1],

[5, 88, 6, 3],

[1, 7, 91, 4],

[2, 3, 5, 84],

];

const maxValue = Math.max(...matrix.flat());

const metrics = [

["mAP@0.5", "92.6%"],

["mAP@0.5:0.95", "76.4%"],

["Precision", "90.8%"],

["Recall", "88.7%"],

];

const apGroups = [

{ name: "类别", items: [["车辆", 0.94], ["人员", 0.89], ["设备", 0.86], ["背景", 0.81]] },

{ name: "场景", items: [["城区", 0.91], ["道路", 0.88], ["园区", 0.85], ["夜间", 0.79]] },

{ name: "视角", items: [["俯视", 0.9], ["平视", 0.87], ["侧视", 0.84], ["远景", 0.78]] },

{ name: "模", items: [["RGB", 0.9], ["IR", 0.83], ["融合", 0.92], ["低照", 0.77]] },

];

const activeGroup = apGroups.find((group) => group.name === expandedAp) || apGroups[0];

const reportTitle = `${task.name} 评估报告`;

return (

<div className="evaluation-report-page">

<div className="evaluation-detail-toolbar">

<button type="button" onClick={onBack}><ArrowLeft size={14} />返回任务详情</button>

</div>

<div className="report-top-grid">

<section className="platform-card report-metrics-card">

<h2>概览指标</h2>

<p>{reportTitle}</p>

<div className="report-metric-grid">

{metrics.map(([label, value]) => (

<div className="report-metric" key={label}>

<span>{label}</span>

<b>{value}</b>

</div>

))}

</div>

</section>

<section className="platform-card confusion-card">

<h2>混淆矩阵热力</h2>

<div className="confusion-axis-label predicted">预测类别（Predicted</div>

<div className="confusion-layout">

<div className="confusion-axis-label ground">真实类别（Ground Truth</div>

<div className="confusion-grid" style={{ gridTemplateColumns: `72px repeat(${classes.length}, minmax(58px, 1fr))` }}>

<div />

{classes.map((label) => <b className="confusion-label" key={label}>{label}</b>)}

{classes.map((truth, rowIndex) => (

<React.Fragment key={truth}>

<b className="confusion-label">{truth}</b>

{classes.map((predicted, colIndex) => {

const value = matrix[rowIndex][colIndex];

const ratio = value / maxValue;

const background = rowIndex === colIndex

? `rgba(255, ${Math.round(245 - ratio * 80)}, ${Math.round(155 - ratio * 80)}, .96)`

: `rgba(${Math.round(95 + ratio * 155)}, ${Math.round(180 - ratio * 120)}, ${Math.round(220 - ratio * 170)}, .9)`;

return (

<div

className="confusion-cell"

key={`${truth}-${predicted}`}

style={{ background }}

title={`真实类别：${truth}；预测类别：${predicted}；数量：${value}`}

>

{value}

</div>

);

})}

</React.Fragment>

))}

</div>

</div>

</section>

</div>

<section className="platform-card report-ap-card">

<h2>AP </h2>

<div className="ap-card-strip">

{apGroups.map((group) => (

<button

type="button"

className={expandedAp === group.name ? "ap-dimension-card active" : "ap-dimension-card"}

key={group.name}

onClick={() => setExpandedAp(group.name)}

>

<span>{group.name}统计</span>

<b>{(group.items.reduce((sum, item) => sum + item[1], 0) / group.items.length * 100).toFixed(1)}%</b>

</button>

))}

</div>

<div className="pr-curve-panel">

<div>

<h3>{activeGroup.name}维度 PR 曲线</h3>

<p>点击上方维度卡片可切换展开内容</p>

</div>

<div className="pr-bars">

{activeGroup.items.map(([label, value]) => (

<div className="pr-row" key={label}>

<span>{label}</span>

<i><em style={{ width: `${value * 100}%` }} /></i>

<b>{(value * 100).toFixed(1)}%</b>

</div>

))}

</div>

</div>

</section>

<section className="platform-card bbox-compare-card">

<h2>预测框与标注框对</h2>

<div className="bbox-compare-stage">

<div className="bbox-image">

<div className="bbox gt one"><span>GT: 车辆</span></div>

<div className="bbox pred one"><span>Pred: 车辆 0.94</span></div>

<div className="bbox gt two"><span>GT: 人员</span></div>

<div className="bbox pred two"><span>Pred: 人员 0.87</span></div>

</div>

<div className="bbox-legend">

<span><i className="gt-color" />标注</span>

<span><i className="pred-color" />预测</span>

<p>用于快速检查预测框与人工标注框的重合程度、漏检与误检位置</p>

</div>

</div>

</section>

</div>

);

}
