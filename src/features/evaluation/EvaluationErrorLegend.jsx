import { evaluationErrorLegend } from "./evaluationPresentation.js";

export function EvaluationErrorLegend({ filter = "" }) {
  const rows = filter
    ? evaluationErrorLegend.filter((item) => item.type.startsWith(filter))
    : evaluationErrorLegend;
  return (
    <div className="evaluation-box-legend" aria-label="错误框线型说明">
      {rows.map((item) => <span key={item.type}><i className={`legend-line ${item.type}`} />{item.label}</span>)}
    </div>
  );
}
