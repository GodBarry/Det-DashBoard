import { useState } from "react";

export function useBaselineController({ refreshHome, setError }) {
  const [showBaselineDialog, setShowBaselineDialog] = useState(false);
  const [baselineName, setBaselineName] = useState("");
  const [baselineSources, setBaselineSources] = useState([]);
  const [baselineParams, setBaselineParams] = useState({ iouSame: 0.9, iouLight: 0.75 });
  const [baselinePreview, setBaselinePreview] = useState(null);
  const [baselineConflicts, setBaselineConflicts] = useState([]);
  const [selectedConflictIds, setSelectedConflictIds] = useState([]);
  const [activeConflictId, setActiveConflictId] = useState(null);
  const [baselineBusy, setBaselineBusy] = useState(false);

  function openBaselineDialog() {
    setBaselineName(`baseline_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
    setBaselineSources([]);
    setBaselinePreview(null);
    setBaselineConflicts([]);
    setSelectedConflictIds([]);
    setActiveConflictId(null);
    setError(null);
    setShowBaselineDialog(true);
  }

  function toggleBaselineSource(projectId) {
    setBaselineSources((ids) => ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId]);
  }

  function previewBaseline() {
    if (!baselineSources.length) {
      setError("璇烽€夋嫨鑷冲皯涓€涓潵婧愰」");
      return;
    }
    setBaselineBusy(true);
    setError(null);
    fetch("/api/baselines/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: baselineName, sourceProjectIds: baselineSources, sourcePriority: baselineSources, ...baselineParams }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "鍩哄噯棰勫垎鏋愬け");
        setBaselinePreview(data);
        setSelectedConflictIds([]);
        setActiveConflictId(null);
        if (data.summary?.conflicts) loadBaselineConflicts(data.runId);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBaselineBusy(false));
  }

  function loadBaselineConflicts(runId = baselinePreview?.runId) {
    if (!runId) return;
    fetch(`/api/baselines/${runId}/conflicts`)
      .then((r) => r.json())
      .then((d) => {
        const rows = d.conflicts || [];
        setBaselineConflicts(rows);
        setActiveConflictId((id) => id || rows[0]?.id || null);
      })
      .catch((err) => setError("璇诲彇鍐茬獊鍒楄〃澶辫触: " + err.message));
  }

  function toggleConflict(id) {
    setSelectedConflictIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
    setActiveConflictId(id);
  }

  function resolveSelectedConflicts(resolution) {
    const ids = selectedConflictIds.length ? selectedConflictIds : activeConflictId ? [activeConflictId] : [];
    if (!ids.length || !baselinePreview?.runId) return;
    fetch(`/api/baselines/${baselinePreview.runId}/conflicts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conflictIds: ids, resolution }),
    })
      .then((r) => r.json())
      .then(() => loadBaselineConflicts())
      .catch((err) => setError("淇濆瓨鍐茬獊鍐崇瓥澶辫触: " + err.message));
  }

  function applyBaseline() {
    if (!baselinePreview?.runId) return;
    if (!window.confirm("纭畾鎸夊綋鍓嶉鍒嗘瀽缁撴灉鐢熸垚鍩哄噯鏁版嵁闆嗛」鐩悧")) return;
    setBaselineBusy(true);
    fetch(`/api/baselines/${baselinePreview.runId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: baselineName }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "搴旂敤鍩哄噯澶辫触");
        setShowBaselineDialog(false);
        setBaselinePreview(null);
        refreshHome();
        window.alert(`鍩哄噯椤圭洰宸茬敓鎴愶細${data.project?.name || baselineName}锛屽浘鍍忥細${data.imageCount}锛屾爣娉細${data.annotationCount}`);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBaselineBusy(false));
  }

  return {
    showBaselineDialog,
    setShowBaselineDialog,
    baselineName,
    setBaselineName,
    baselineSources,
    toggleBaselineSource,
    baselineParams,
    setBaselineParams,
    baselineBusy,
    previewBaseline,
    baselinePreview,
    applyBaseline,
    baselineConflicts,
    activeConflictId,
    setActiveConflictId,
    selectedConflictIds,
    toggleConflict,
    resolveSelectedConflicts,
    openBaselineDialog,
  };
}
