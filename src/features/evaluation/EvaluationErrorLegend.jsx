import { evaluationErrorDefinitions, evaluationErrorLegend } from "./evaluationPresentation.js";

export function EvaluationErrorLegend({ filter = "" }) {
  const rows = evaluationErrorLegend;
  return (
    <div className="evaluation-box-legend" aria-label="错误框线型说明">
      <div className="evaluation-box-legend-lines">
        {rows.map((item) => <span key={item.type}><i className={`legend-line ${item.type}`} />{item.label}</span>)}
      </div>
      <div className="evaluation-box-legend-definitions">
        {evaluationErrorDefinitions.map((item) => <span key={item}>{item}</span>)}
      </div>
    </div>
  );
}
