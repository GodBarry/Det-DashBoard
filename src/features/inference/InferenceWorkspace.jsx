import React, { useEffect, useMemo, useState } from "react";

import {
  ArrowDown,
  ArrowUp,
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Eye,
  Folder,
  FolderOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import {
  completedEvaluationStatuses,
  formatCount,
  runStatusLabel,
  sortRuntimeJobsByTime,
} from "../../shared/presentation.js";
import { metadataLabel } from "../../shared/datasetMetadata.js";
import { useWorkspaceColumns, WorkspaceResizeHandle } from "../../shared/useWorkspaceColumns.jsx";
export function InferenceWorkspace({

projects,

mlModels,

modelVersions,

inferenceVersions,

inferenceAlgorithms,

algorithmAssets,

pythonEnvs,

assetLinks,

inferenceJobs,

inferenceForm,

setInferenceForm,

selectedInferenceEnv,

submitInferenceJob,

viewInferenceResults,

deleteInferenceJob,

deleteInferenceJobs,

requeueInferenceJob,

moveRuntimeQueueJob,

helpers,

}) {

const { bestAssetLink, envTooltip, formatMetric, modelFamilyLabel, parseMaybeJson, predictionBoxStyle, predictionColor, predictionItems, predictionLegend, projectTreeRows, versionTooltip } = helpers;

const { columns, beginResize } = useWorkspaceColumns("det-dashboard.inference-columns", { left: 292, right: 418 });

const selectedProject = projects.find((project) => project.id === inferenceForm.datasetProjectId);

const inferenceMetadataValues = (key) => Array.from(new Set(projects.flatMap((project) => {
  const value = project[key];
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : [parsed]; } catch { return String(value).split(","); }
}).map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

const inferenceFilterOptions = { scenes: inferenceMetadataValues("scenes"), views: inferenceMetadataValues("views"), modalities: inferenceMetadataValues("modalities"), labels: inferenceMetadataValues("labels") };

  const selectedVersion = modelVersions.find((version) => version.id === inferenceForm.modelVersionId);

  const visibleInferenceAlgorithms = inferenceAlgorithms.length ? inferenceAlgorithms : algorithmAssets;

  const selectedAlgorithm = visibleInferenceAlgorithms.find((algorithm) => algorithm.id === inferenceForm.templateId);

const sortedInferenceJobs = sortRuntimeJobsByTime(inferenceJobs);

const latestJob = sortedInferenceJobs[0];

const latestMetrics = parseMaybeJson(latestJob?.metrics_json);

const latestDone = completedEvaluationStatuses.has(String(latestJob?.status || "").toLowerCase());

const [previewRows, setPreviewRows] = useState([]);

const [liveLogs, setLiveLogs] = useState([]);

const [evaluation, setEvaluation] = useState(null);

const [activeAnalysis, setActiveAnalysis] = useState("overview");

const [errorFilter, setErrorFilter] = useState("false_negative");
  const [sampleOffset, setSampleOffset] = useState(0);
  const [sampleViewer, setSampleViewer] = useState(null);

const [expandedGroups, setExpandedGroups] = useState(() => new Set(["算法适配", "Python 环境"]));

const setField = (key, value) => setInferenceForm({ ...inferenceForm, [key]: value });

const inferenceProjectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

const topLevelDatasetProjects = useMemo(
  () => projects.filter((project) => !project.parent_id),
  [projects],
);

const selectedRootProject = useMemo(() => {
  let cursor = selectedProject;
  const seen = new Set();
  while (cursor?.parent_id && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    cursor = inferenceProjectById.get(cursor.parent_id) || cursor;
    if (!cursor?.parent_id) break;
  }
  return cursor || null;
}, [selectedProject, inferenceProjectById]);

const selectedRootProjectId = selectedRootProject?.id || "";

const secondLevelDatasetOptions = useMemo(() => {
  if (!selectedRootProjectId) return [];
  const root = inferenceProjectById.get(selectedRootProjectId);
  const children = projects.filter((project) => project.parent_id === selectedRootProjectId);
  const rootHasAssets = Number(root?.image_count || 0) > 0 || Number(root?.video_count || 0) > 0;
  const rows = (rootHasAssets || !children.length) ? [{ ...root, datasetOptionLabel: "当前一级项目" }] : [];
  rows.push(...children.map((project) => ({ ...project, datasetOptionLabel: project.name })));
  if (selectedProject && !rows.some((project) => project.id === selectedProject.id)) {
    rows.push({ ...selectedProject, datasetOptionLabel: `${selectedRootProject?.name || "项目"} / ${selectedProject.name}` });
  }
  return rows;
}, [projects, inferenceProjectById, selectedRootProjectId, selectedProject, selectedRootProject]);

const selectDatasetRoot = (rootId) => {
  const root = inferenceProjectById.get(rootId);
  const children = projects.filter((project) => project.parent_id === rootId);
  const rootHasAssets = Number(root?.image_count || 0) > 0 || Number(root?.video_count || 0) > 0;
  const nextProjectId = (rootHasAssets || !children.length) ? rootId : (children[0]?.id || rootId || "");
  setField("datasetProjectId", nextProjectId);
};

const toggleGroup = (title) => {

setExpandedGroups((current) => {

const next = new Set(current);

if (next.has(title)) next.delete(title);

else next.add(title);

return next;

});

};

useEffect(() => {

if (!latestJob?.id) {

setPreviewRows([]);

return;

}

let ignore = false;

fetch(`/api/ml/inference-jobs/${latestJob.id}/results`)

.then((r) => r.json())

.then((data) => { if (!ignore) setPreviewRows(data.results || []); })

.catch(() => { if (!ignore) setPreviewRows([]); });

return () => { ignore = true; };

}, [latestJob?.id, latestJob?.status, latestJob?.progress]);

useEffect(() => {
  if (!latestJob?.id) {
    setLiveLogs([]);
    return undefined;
  }
  let ignore = false;
  const loadLogs = () => fetch(`/api/ml/inference-jobs/${latestJob.id}/logs`)
    .then((response) => response.json())
    .then((data) => { if (!ignore) setLiveLogs(data.logs || []); })
    .catch(() => {});
  loadLogs();
  const timer = window.setInterval(loadLogs, 1000);
  return () => { ignore = true; window.clearInterval(timer); };
}, [latestJob?.id]);

const selectAlgorithm = (id) => {

    const algorithm = visibleInferenceAlgorithms.find((item) => item.id === id) || algorithmAssets.find((item) => item.id === id);

const tasks = algorithm?.capabilities_json?.tasks || ["detect", "segment", "classify"];

const link = bestAssetLink(assetLinks, id);

setInferenceForm({

...inferenceForm,

templateId: id,

taskType: tasks.includes(inferenceForm.taskType) ? inferenceForm.taskType : tasks[0] || "detect",

pythonEnvId: link?.python_env_id || inferenceForm.pythonEnvId,

modelVersionId: link?.model_version_id || inferenceForm.modelVersionId,

datasetProjectId: inferenceForm.datasetProjectId || link?.dataset_project_id || "",

});

};

const familyRows = Array.from(new Set(mlModels.map((model) => modelFamilyLabel(model.name)))).map((family) => {

const familyModels = mlModels.filter((model) => modelFamilyLabel(model.name) === family);

const versions = modelVersions.filter((version) => familyModels.some((model) => model.id === version.model_id));

return { family, count: versions.length, modelId: familyModels[0]?.id || "", versions };

});

const selectedFamily = selectedVersion?.model_name ? modelFamilyLabel(selectedVersion.model_name) : (mlModels.find((model) => model.id === inferenceForm.modelId)?.name ? modelFamilyLabel(mlModels.find((model) => model.id === inferenceForm.modelId)?.name) : "");

const selectFamily = (family) => {

const modelIds = mlModels.filter((model) => modelFamilyLabel(model.name) === family).map((model) => model.id);

const firstVersion = modelVersions.find((version) => modelIds.includes(version.model_id));

setInferenceForm({ ...inferenceForm, modelId: modelIds[0] || "", modelVersionId: firstVersion?.id || "" });

};

const datasetRows = projectTreeRows(projects).slice(0, 14);

const modelTreeRows = familyRows.flatMap((family) => [

{

id: `family-${family.family}`,

name: family.family,

right: family.count,

depth: 0,

icon: Database,

active: family.family === selectedFamily,

title: `${family.family}\n版本数：${family.count}`,

onClick: () => selectFamily(family.family),

},

...family.versions.slice(0, 6).map((version) => ({

id: version.id,

name: version.version_name,

right: version.stage || "",

depth: 1,

icon: Boxes,

active: version.id === inferenceForm.modelVersionId,

badge: version.id === bestAssetLink(assetLinks, inferenceForm.templateId)?.model_version_id ? "推荐" : "",

title: versionTooltip(version),

onClick: () => setInferenceForm({ ...inferenceForm, modelId: version.model_id || "", modelVersionId: version.id }),

})),

]);

const resourceGroups = [

{

title: "数据",

icon: FolderOpen,

count: projects.length,

rows: datasetRows.map((project) => ({

id: project.id,

name: project.name,

right: project.image_count || 0,

depth: project.depth,

icon: project.hasChildren ? FolderOpen : Folder,

active: project.id === inferenceForm.datasetProjectId,

title: `${project.name}\n图片：${project.image_count || 0}\n视频：${project.video_count || 0}`,

onClick: () => setField("datasetProjectId", project.id),

})),

},

{

title: "算法适配",

icon: Boxes,

count: visibleInferenceAlgorithms.length,

      rows: visibleInferenceAlgorithms.map((algorithm) => ({

id: algorithm.id,

name: algorithm.name,

right: algorithm.version || "",

depth: 0,

icon: Boxes,

active: algorithm.id === inferenceForm.templateId,

badge: bestAssetLink(assetLinks, algorithm.id) ? "兼容" : "",

title: `${algorithm.name}\n${algorithm.framework || "custom"} · ${algorithm.task_type || "detect"}\n${algorithm.minio_prefix || ""}`,

onClick: () => selectAlgorithm(algorithm.id),

})),

},

{

title: "模型",

icon: Database,

count: familyRows.length,

rows: modelTreeRows,

},

{

title: "Python 环境",

icon: Cpu,

count: pythonEnvs.length,

rows: pythonEnvs.map((env) => ({

id: env.id,

name: env.name,

right: env.status,

depth: 0,

icon: Cpu,

active: env.id === inferenceForm.pythonEnvId,

badge: env.id === bestAssetLink(assetLinks, inferenceForm.templateId)?.python_env_id ? "兼容" : "",

title: envTooltip(env),

onClick: () => setField("pythonEnvId", env.id),

})),

},

].filter((group) => group.rows.length);

const displayJobs = sortedInferenceJobs;
const [selectedInferenceJobIds, setSelectedInferenceJobIds] = useState(() => new Set());

const selectedInferenceCount = selectedInferenceJobIds.size;

const allVisibleInferenceJobsSelected = displayJobs.length > 0 && displayJobs.every((job) => selectedInferenceJobIds.has(job.id));

const selectedInferenceQueueLabel = selectedInferenceCount ? `删除已选 ${selectedInferenceCount}` : "删除队列";

useEffect(() => {

setSelectedInferenceJobIds((current) => {

const validIds = new Set(sortedInferenceJobs.map((job) => job.id));

const next = new Set(Array.from(current).filter((id) => validIds.has(id)));

return next.size === current.size ? current : next;

});

}, [inferenceJobs]);

const toggleInferenceJobSelection = (jobId) => {

setSelectedInferenceJobIds((current) => {

const next = new Set(current);

if (next.has(jobId)) next.delete(jobId);

else next.add(jobId);

return next;

});

};

const toggleVisibleInferenceJobsSelection = () => {

setSelectedInferenceJobIds((current) => {

const next = new Set(current);

if (allVisibleInferenceJobsSelected) displayJobs.forEach((job) => next.delete(job.id));

else displayJobs.forEach((job) => next.add(job.id));

return next;

});

};

const deleteInferenceQueue = () => {

const ids = selectedInferenceCount ? Array.from(selectedInferenceJobIds) : sortedInferenceJobs.map((job) => job.id);

const result = deleteInferenceJobs?.(ids);

if (result?.then) result.then((deleted) => { if (deleted) setSelectedInferenceJobIds(new Set()); });

};

const previewItems = previewRows.slice(0, 12);

  const legendItems = predictionLegend(previewItems);

const latestJobParams = parseMaybeJson(latestJob?.params_json);
const executionLog = liveLogs.length
  ? liveLogs.map((entry) => `[${entry.stream}] ${entry.line}`).join("\n")
  : latestJobParams?.output?.executionLog
  || latestJobParams?.output?.stderr
  || latestJobParams?.output?.stdout
  || latestJob?.message
  || "等待执行脚本输出";

return (
  <div className="inference-workspace resizable-workspace" style={{ "--workspace-left": `${columns.left}px`, "--workspace-right": `${columns.right}px` }}>
    <aside className="inference-sidebar reference-sidebar">
      <h2>推理资源</h2>
      <div className="resource-tree">
        {resourceGroups.map((group) => {
          const GroupIcon = group.icon;
          const isOpen = expandedGroups.has(group.title);
          return (
            <section className="resource-group" key={group.title}>
              <button className="resource-group-head" type="button" onClick={() => toggleGroup(group.title)}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <GroupIcon size={14} />
                <b>{group.title}</b>
                <em>{group.count}</em>
              </button>
              {isOpen && group.rows.map((row) => {
                const RowIcon = row.icon;
                return (
                  <button
                    className={`${row.active ? "active" : ""} depth-${row.depth || 0}`}
                    key={`${group.title}-${row.id}`}
                    title={row.title}
                    onClick={row.onClick}
                    style={{ "--depth": row.depth || 0 }}
                    type="button"
                  >
                    <RowIcon size={14} />
                    <span>{row.name}</span>
                    {row.badge && <i>{row.badge}</i>}
                    <em>{row.right}</em>
                  </button>
                );
              })}
              {isOpen && !group.rows.length && <p className="resource-empty">暂无资源</p>}
            </section>
          );
        })}
      </div>
      <div className="resource-usage">
        <div><span>资源使用</span><b>68%</b></div>
        <progress value="68" max="100" />
        <em>20 / 29</em>
      </div>
    </aside>

    <WorkspaceResizeHandle side="left" onPointerDown={beginResize} />

    <main className="inference-main">
      <div className="inference-toolbar">
        <div className="workspace-path-row">
          <FolderOpen size={16} />
          <button type="button">推理</button>
          <ChevronRight size={14} />
          <button type="button">新建任务</button>
        </div>
        <div className="workspace-commandbar inference-commandbar">
          <button className="primary" type="button" onClick={submitInferenceJob}><Play size={15} />开始推理</button>
          <button type="button"><Copy size={16} />批量运行</button>
          <button className="danger-outline" type="button" disabled={!sortedInferenceJobs.length} onClick={deleteInferenceQueue} title={selectedInferenceCount ? "删除选中的推理任务" : "删除全部推理任务队列"}><Trash2 size={16} />{selectedInferenceQueueLabel}</button>
          <button type="button"><RefreshCw size={16} />刷新</button>
        </div>
      </div>

      <section className="reference-builder">
        <div className="reference-section">
          <h2>数据来源</h2>
          <div className="config-row inference-task-name-row">
            <span className="row-label">任务名称</span>
            <input
              value={inferenceForm.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="请输入推理任务名称，留空则自动生成"
            />
          </div>
          <div className="config-row dataset-source-row">
            <span className="row-label">数据来源</span>
            <div className="segmented">
              <button type="button" className="active"><Database size={14} />数据集</button>
              <button type="button"><Folder size={14} />文件目录</button>
              <button type="button">文件列表</button>
            </div>
            <div className="inference-dataset-picker">
              <label className="path-select dataset-root-select">
                <FolderOpen size={15} />
                <select value={selectedRootProjectId} onChange={(e) => selectDatasetRoot(e.target.value)}>
                  <option value="">选择一级项目</option>
                  {topLevelDatasetProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
              <label className="path-select dataset-child-select">
                <Folder size={15} />
                <select value={inferenceForm.datasetProjectId} onChange={(e) => setField("datasetProjectId", e.target.value)} disabled={!selectedRootProjectId}>
                  <option value="">{selectedRootProjectId ? "选择二级数据集" : "先选择一级项目"}</option>
                  {secondLevelDatasetOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.datasetOptionLabel || project.name} · {formatCount(project.image_count || 0)} 图像
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="config-row filter-row">
            <span className="row-label">筛选条件</span>
            <select value={inferenceForm.inputViews} onChange={(e) => setField("inputViews", e.target.value)}><option value="">视角：全部</option>{inferenceFilterOptions.views.map((value) => <option key={value} value={value}>{metadataLabel(value, "view")}</option>)}</select>
            <select value={inferenceForm.inputScenes} onChange={(e) => setField("inputScenes", e.target.value)}><option value="">场景：全部</option>{inferenceFilterOptions.scenes.map((value) => <option key={value} value={value}>{metadataLabel(value, "scene")}</option>)}</select>
            <select value={inferenceForm.inputModalities} onChange={(e) => setField("inputModalities", e.target.value)}><option value="">模态：全部</option>{inferenceFilterOptions.modalities.map((value) => <option key={value} value={value}>{metadataLabel(value, "modality")}</option>)}</select>
            <select value={inferenceForm.inputLabels} onChange={(e) => setField("inputLabels", e.target.value)}><option value="">标签：全部</option>{inferenceFilterOptions.labels.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <input value={inferenceForm.inputQuery} onChange={(e) => setField("inputQuery", e.target.value)} placeholder="其他标签/关键词" />
            <button type="button" onClick={() => setInferenceForm({ ...inferenceForm, inputViews: "", inputScenes: "", inputModalities: "", inputLabels: "", inputQuery: "" })}>清空</button>
          </div>
        </div>

        <div className="reference-section">
          <h2>模型与算法</h2>
          <div className="config-row model-row">
            <span className="row-label">算法适配器</span>
            <select value={inferenceForm.templateId} onChange={(e) => selectAlgorithm(e.target.value)}>
              <option value="">请选择算法适配器</option>
              {visibleInferenceAlgorithms.map((algorithm) => <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>)}
            </select>
            <span className="row-label">模型簇</span>
            <select value={selectedFamily} onChange={(e) => selectFamily(e.target.value)}>
              <option value="">请选择模型簇</option>
              {familyRows.map((family) => <option key={family.family} value={family.family}>{family.family}</option>)}
            </select>
            <span className="row-label">模型版本</span>
            <select value={inferenceForm.modelVersionId} onChange={(e) => setField("modelVersionId", e.target.value)} title={versionTooltip(selectedVersion)}>
              <option value="">请选择模型版本</option>
              {inferenceVersions.map((version) => <option key={version.id} value={version.id} title={versionTooltip(version)}>{version.model_name} / {version.version_name}</option>)}
            </select>
            <span className="row-label">Python 环境</span>
            <select value={inferenceForm.pythonEnvId} onChange={(e) => setField("pythonEnvId", e.target.value)}>
              <option value="">请选择 Python 环境</option>
              {pythonEnvs.map((env) => <option key={env.id} value={env.id}>{env.name} · {env.status}</option>)}
            </select>
            <label className="switch-option fake-reference-switch" title="Fake GT" aria-label="Fake GT">
              <span className="switch-control">
                <input type="checkbox" checked={Boolean(inferenceForm.fakeReferenceMode)} onChange={() => setField("fakeReferenceMode", !inferenceForm.fakeReferenceMode)} />
                <i />
              </span>
            </label>
          </div>
        </div>

        <div className="reference-section">
          <h2>推理参数</h2>
          <div className="config-row param-row">
            <span className="row-label">置信度阈值</span><input type="number" step="0.01" value={inferenceForm.conf} onChange={(e) => setField("conf", e.target.value)} />
            <span className="row-label">IoU 阈值</span><input type="number" step="0.01" value={inferenceForm.iou} onChange={(e) => setField("iou", e.target.value)} />
            <span className="row-label">图像尺寸</span><input type="number" value={inferenceForm.imgsz} onChange={(e) => setField("imgsz", e.target.value)} />
            <span className="row-label">批大小</span><input type="number" value={inferenceForm.batch} onChange={(e) => setField("batch", e.target.value)} />
            <span className="row-label">设备</span><select value={inferenceForm.device} onChange={(e) => setField("device", e.target.value)}><option value="cpu">CPU</option><option value="0">0</option></select>
          </div>
        </div>

        <div className="reference-section">
          <h2>输出选项</h2>
          <div className="config-row output-row">
            <label className="switch-option">保存预测结果 JSON<span className="switch-control"><input type="checkbox" checked={inferenceForm.saveJson} onChange={() => setField("saveJson", !inferenceForm.saveJson)} /><i /></span></label>
            <label className="switch-option">保存可视化结果<span className="switch-control"><input type="checkbox" checked={inferenceForm.saveVisualization} onChange={() => setField("saveVisualization", !inferenceForm.saveVisualization)} /><i /></span></label>
            <label className="switch-option">创建标签版本<span className="switch-control"><input type="checkbox" checked={inferenceForm.createLabelVersion} onChange={() => setField("createLabelVersion", !inferenceForm.createLabelVersion)} /><i /></span></label>
            <span className="row-label">输出目录</span><label className="path-select"><input value="/inference/outputs" readOnly /><FolderOpen size={14} /></label>
          </div>
        </div>
      </section>

      <section className="reference-queue">
        <div className="section-title-row compact-title">
          <h2>推理任务队列</h2>
          <span className="muted">共 {inferenceJobs.length} 条</span>
        </div>
        <div className="inference-table">
          <div className="inference-table-head">
            <span className="inference-task-name"><input type="checkbox" checked={allVisibleInferenceJobsSelected} onChange={toggleVisibleInferenceJobsSelection} disabled={!displayJobs.length} />任务名称</span>
            <span>数据集</span><span>模型</span><span>状态</span><span>进度</span><span>图像数</span><span>预测数</span><span>Precision</span><span>Recall</span><span>mAP50</span><span>操作</span>
          </div>
          {displayJobs.map((job) => {
            const metrics = parseMaybeJson(job.metrics_json);
            const done = completedEvaluationStatuses.has(String(job.status || "").toLowerCase());
            const progress = Math.max(0, Math.min(100, Number(job.progress ?? (done ? 100 : 0)) || 0));
            return (
              <div className="inference-table-row" key={job.id}>
                <b className="inference-task-name"><input type="checkbox" checked={selectedInferenceJobIds.has(job.id)} onChange={() => toggleInferenceJobSelection(job.id)} /><span>{job.name || `推理任务 ${job.id.slice(0, 8)}`}</span></b>
                <span>{job.dataset_project_name || "未绑定"}</span>
                <span title={versionTooltip(modelVersions.find((version) => version.id === job.model_version_id) || {})}>{job.model_name || selectedVersion?.model_name || "未绑定模型"}</span>
                <em className={`status-badge status-${job.status}`}>{runStatusLabel(job.status)}</em>
                <span className="inference-progress" title={`进度 ${progress}%`}><progress value={progress} max="100" /><small>{progress}%</small></span>
                <span>{metrics.images ?? job.image_count ?? 0}</span>
                <span>{metrics.predictions ?? job.prediction_count ?? 0}</span>
                <span>{formatMetric(metrics.precision)}</span>
                <span>{formatMetric(metrics.recall)}</span>
                <span>{formatMetric(metrics.map50)}</span>
                <div className="queue-actions">
                  <span className="queue-action-row">
                    <button type="button" disabled={!done} onClick={() => viewInferenceResults(job)}><Eye size={14} /></button>
                    <button className="restart-action" type="button" title="重新开始" onClick={() => requeueInferenceJob?.(job.id)}><RotateCcw size={15} strokeWidth={2.2} /></button>
                    <button className="danger-icon" type="button" title="删除任务" onClick={() => deleteInferenceJob(job.id)}><Trash2 size={14} /></button>
                  </span>
                  <span className="queue-priority">
                    <button type="button" title="优先级上移" onClick={(event) => { event.stopPropagation(); moveRuntimeQueueJob?.("inference", job.id, "up"); }}><ArrowUp size={13} /></button>
                    <button type="button" title="优先级下移" onClick={(event) => { event.stopPropagation(); moveRuntimeQueueJob?.("inference", job.id, "down"); }}><ArrowDown size={13} /></button>
                  </span>
                </div>
              </div>
            );
          })}
          {!sortedInferenceJobs.length && <div className="empty-state">推理队列为空</div>}
        </div>
      </section>
    </main>

    <WorkspaceResizeHandle side="right" onPointerDown={beginResize} />

    <aside className="inference-inspector reference-inspector">
      <div className="inspector-title">
        <h2>推理结果</h2>
        <button type="button"><RefreshCw size={14} /></button>
      </div>
      <div className="reference-result-stats">
        <div><span>任务状态</span><b className={latestDone ? "" : "running-text"}>{latestJob ? runStatusLabel(latestJob.status) : "--"}</b></div>
        <div><span>图像结果</span><b>{latestMetrics.images ?? latestJob?.image_count ?? "--"}</b></div>
        <div><span>预测数量</span><b>{latestMetrics.predictions ?? latestJob?.prediction_count ?? "--"}</b></div>
        <div><span>Precision</span><b>{formatMetric(latestMetrics.precision)}</b></div>
        <div><span>Recall</span><b>{formatMetric(latestMetrics.recall)}</b></div>
        <div><span>mAP50</span><b>{formatMetric(latestMetrics.map50)}</b></div>
        <div><span>mAP50-95</span><b>{formatMetric(latestMetrics.map)}</b></div>
      </div>
      <div className="result-preview-strip reference-preview">
        <h3>结果预览 <span>（最近 12 张）</span><button type="button">查看全部</button></h3>
        <div className="reference-preview-grid">
          {(previewItems.length ? previewItems : Array.from({ length: 8 }, (_, index) => ({ id: `empty-${index}`, display_name: "等待结果" }))).map((item, index) => (
            <div className={`result-thumb thumb-${index}`} key={item.id || item.display_name || index}>
              <div className="result-thumb-media">
                {item.thumb_url && <img src={item.thumb_url} alt={item.display_name || "推理结果"} loading="lazy" />}
                {predictionItems(item.predictions_json).map((prediction, predictionIndex) => {
                  const boxStyle = predictionBoxStyle(prediction, item);
                  if (!boxStyle) return null;
                  const color = predictionColor(prediction.label);
                  return (
                    <i
                      className="prediction-box"
                      key={prediction.id || predictionIndex}
                      style={{ ...boxStyle, borderColor: color, "--box-color": color }}
                    >
                      {prediction.score != null && <small>{(Number(prediction.score) * 100).toFixed(0)}%</small>}
                    </i>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="bbox-legend-row">
          {legendItems.map((label, index) => (
            <span key={`${label}-${index}`}><i style={{ background: predictionColor(label) }} />{label}</span>
          ))}
        </div>
      </div>
      <div className="inference-log reference-log">
        <h3>运行日志 <button type="button">清空</button></h3>
        <pre>{executionLog}</pre>
      </div>
    </aside>
  </div>
);
}
