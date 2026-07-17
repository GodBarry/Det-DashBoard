import { Fragment } from "react";

export function EvaluationConfusionMatrix({ matrix }) {
  const labels = matrix?.labels || [];
  const values = matrix?.values || [];
  const maxValue = Math.max(1, ...values.flat());

  if (!labels.length) return <div className="empty-state">当前任务没有可用的混淆矩阵</div>;

  return (
    <div className="evaluation-live-matrix" style={{ "--matrix-size": labels.length }}>
      <div className="matrix-corner">真实 / 预测</div>
      {labels.map((label) => <b key={"head-" + label}>{label}</b>)}
      {labels.map((truth, rowIndex) => (
        <Fragment key={truth}>
          <b>{truth}</b>
          {labels.map((predicted, columnIndex) => {
            const value = Number(values[rowIndex]?.[columnIndex] || 0);
            const ratio = value / maxValue;
            return <button key={truth + "-" + predicted} title={"真实" + truth + "；预测：" + predicted + "；数量：" + value} style={{ background: "rgba(15,157,151," + (0.08 + ratio * .82).toFixed(2) + ")" }}>{value}</button>;
          })}
        </Fragment>
      ))}
    </div>
  );
}
