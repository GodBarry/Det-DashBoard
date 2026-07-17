const evaluationPalette = {
  pr: "#0d8f89",
  f1: "#7c3aed",
  precision: "#f59e0b",
  recall: "#2563eb",
};

export function EvaluationCurve({ kind = "pr", curves = [] }) {
  const points = curves.length ? curves : [{ confidence: 0, precision: 0, recall: 0, f1: 0 }];
  const xValue = (row) => kind === "pr" ? Number(row.recall || 0) : Number(row.confidence || 0);
  const yValue = (row) => kind === "pr" ? Number(row.precision || 0) : Number(row[kind] || 0);
  const ordered = kind === "pr" ? points.slice().sort((a, b) => xValue(a) - xValue(b)) : points;
  const stroke = evaluationPalette[kind] || evaluationPalette.pr;
  const path = ordered.map((row, index) => {
    const x = 38 + Math.max(0, Math.min(1, xValue(row))) * 372;
    const y = 202 - Math.max(0, Math.min(1, yValue(row))) * 178;
    return (index ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");

  return (
    <svg className={`evaluation-chart-svg chart-${kind}`} viewBox="0 0 430 224" preserveAspectRatio={kind === "pr" ? "xMidYMid meet" : "none"} aria-hidden="true">
      {[60, 95, 131, 166].map((y) => <line key={"y" + y} x1="38" y1={y} x2="410" y2={y} />)}
      {[100, 162, 224, 286, 348].map((x) => <line key={"x" + x} x1={x} y1="24" x2={x} y2="202" />)}
      <line className="axis" x1="38" y1="202" x2="410" y2="202" />
      <line className="axis" x1="38" y1="24" x2="38" y2="202" />
      {[0, .2, .4, .6, .8, 1].map((value, index) => <text key={"xt" + index} x={38 + index * 74.4} y="214" textAnchor="middle">{value.toFixed(1)}</text>)}
      {[0, .2, .4, .6, .8, 1].map((value, index) => <text key={"yt" + index} x="32" y={202 - index * 35.6} textAnchor="end">{value.toFixed(1)}</text>)}
      {kind === "pr" && <><text className="axis-title" x="224" y="221" textAnchor="middle">Recall</text><text className="axis-title" x="9" y="113" textAnchor="middle" transform="rotate(-90 9 113)">Precision</text></>}
      <path d={path} style={{ stroke }} />
    </svg>
  );
}
