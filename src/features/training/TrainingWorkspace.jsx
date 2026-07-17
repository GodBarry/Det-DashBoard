import { useMemo, useState } from "react";

import {
  ArrowDown,
  ArrowUp,
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Download,
  Eye,
  Folder,
  FolderOpen,
  Grid,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { useWorkspaceColumns, WorkspaceResizeHandle } from "../../shared/useWorkspaceColumns.jsx";
import { metadataLabel } from "../../shared/datasetMetadata.js";
export function TrainingWorkspace({

  projects,

  mlModels,

  modelVersions,

  trainingTemplates,

  algorithmAssets,

  pythonEnvs,

  assetLinks,

  trainingJobs,

  activeTrainingJobId,

  setActiveTrainingJobId,

  trainingLogs,

  requeueTrainingJob,

  trainingForm,

  setTrainingForm,

  submitTrainingJob,

  updateTrainingJobState,

  deleteTrainingJob,

  moveRuntimeQueueJob,

  helpers,

}) {

  const { bestAssetLink, formatCount, formatMetric, parseMaybeJson, runStatusLabel } = helpers;

  const { columns, beginResize } = useWorkspaceColumns("det-dashboard.training-columns", { left: 292, right: 410 });

  const algorithms = algorithmAssets.length ? algorithmAssets : trainingTemplates;

  const trainProjectIds = trainingForm.trainProjectIds?.length ? trainingForm.trainProjectIds : [trainingForm.trainProjectId || trainingForm.datasetProjectId].filter(Boolean);
  const valProjectIds = trainingForm.valProjectIds?.length ? trainingForm.valProjectIds : [trainingForm.valProjectId].filter(Boolean);
  const testProjectIds = trainingForm.testProjectIds?.length ? trainingForm.testProjectIds : [trainingForm.testProjectId].filter(Boolean);
  const splitIds = { trainProjectId: trainProjectIds, valProjectId: valProjectIds, testProjectId: testProjectIds };
  const splitArrayKey = { trainProjectId: 'trainProjectIds', valProjectId: 'valProjectIds', testProjectId: 'testProjectIds' };
  const splitName = { trainProjectId: 'train', valProjectId: 'val', testProjectId: 'test' };
  const selectedProject = projects.find((project) => project.id === trainProjectIds[0]) || {};

  const selectedEnv = pythonEnvs.find((env) => env.id === trainingForm.pythonEnvId) || pythonEnvs.find((env) => String(env.name || '').includes('ultralytics')) || pythonEnvs[0] || {};

  const selectedVersion = modelVersions.find((version) => version.id === trainingForm.initialModelVersionId) || modelVersions.find((version) => String(version.version_name || '').includes('yolov8l')) || modelVersions[0] || {};

  const selectedModel = mlModels.find((model) => model.id === trainingForm.modelId) || mlModels.find((model) => String(model.name || '').includes('YOLOv8l')) || mlModels[0] || {};

  const selectedAlgorithm = algorithms.find((item) => (item.id || item.template_key) === trainingForm.templateId) || {};

  const [expandedGroups, setExpandedGroups] = useState(() => new Set(["数据集项目", "算法适配器", "模型簇", "Python 环境"]));
  const [activeDatasetSplit, setActiveDatasetSplit] = useState("trainProjectId");
  const toggleGroup = (title) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(title)) next.delete(title); else next.add(title);
    return next;
  });
  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const project of projects) {
      const key = project.parent_id || "root";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(project);
    }
    return map;
  }, [projects]);
  const datasetRows = [];
  const appendDatasetRows = (parentId = "root", depth = 0) => {
    for (const project of childrenByParent.get(parentId) || []) {
      datasetRows.push({
        id: project.id,
        name: project.name,
        right: project.image_count || 0,
        depth,
        active: splitIds[activeDatasetSplit].includes(project.id),
        onClick: () => {
          const currentIds = splitIds[activeDatasetSplit];
          const nextIds = currentIds.includes(project.id) ? currentIds.filter((id) => id !== project.id) : [...currentIds, project.id];
          const next = { ...trainingForm, [splitArrayKey[activeDatasetSplit]]: nextIds, [activeDatasetSplit]: nextIds[0] || "" };
          if (activeDatasetSplit === 'trainProjectId') next.datasetProjectId = nextIds[0] || '';
          setTrainingForm(next);
        },
      });
      appendDatasetRows(project.id, depth + 1);
    }
  };
  appendDatasetRows();

  const activeJob = trainingJobs.find((job) => job.id === activeTrainingJobId) || trainingJobs[0];

  const runningJob = activeJob || null;
  const progress = runningJob ? Math.max(0, Math.min(100, Number(runningJob.progress || 0))) : 0;
  const epoch = runningJob ? Number(runningJob.current_epoch || Math.round(progress)) : 0;
  const totalEpochs = runningJob ? Number(runningJob.total_epochs || trainingForm.epochs || 0) : 0;

  const trainMetrics = [

    ['当前 Epoch', runningJob && totalEpochs ? epoch + ' / ' + totalEpochs : '--'],

    ['mAP50', runningJob?.map50 != null ? `${(Number(runningJob.map50) * 100).toFixed(2)}%` : '--'],

    ['box_loss', runningJob?.box_loss != null ? Number(runningJob.box_loss).toFixed(3) : '--'],

    ['cls_loss', runningJob?.cls_loss != null ? Number(runningJob.cls_loss).toFixed(3) : '--'],

    ['学习率', runningJob?.learning_rate != null ? String(runningJob.learning_rate) : '--'],

    ['ETA', runningJob?.eta || '--'],

  ];

  const resourceGroups = [
    { title: '数据集项目', icon: FolderOpen, rows: datasetRows },
    { title: '算法适配器', icon: Boxes, rows: algorithms.map((algorithm) => ({ id: algorithm.id || algorithm.template_key, name: algorithm.name, right: algorithm.version || algorithm.algorithm_key || '', active: (algorithm.id || algorithm.template_key) === trainingForm.templateId, onClick: () => selectTrainingAlgorithm(algorithm.id || algorithm.template_key) })) },
    { title: '模型簇', icon: Database, rows: mlModels.map((model) => ({ id: model.id, name: model.name, right: modelVersions.filter((version) => version.model_id === model.id).length, active: model.id === selectedModel.id, onClick: () => setTrainingForm({ ...trainingForm, modelId: model.id }) })) },
    { title: 'Python 环境', icon: Cpu, rows: pythonEnvs.map((env) => ({ id: env.id, name: env.name, right: env.status, active: env.id === selectedEnv.id, onClick: () => setTrainingForm({ ...trainingForm, pythonEnvId: env.id, python: env.python_path || trainingForm.python }) })) },
  ].filter((group) => group.rows.length).map((group) => ({ ...group, count: group.rows.length }));

  const queueRows = trainingJobs;

  const logRows = trainingLogs.length ? trainingLogs.map((log) => log.message || log.text || String(log)).slice(-7) : [];

  const setField = (key, value) => setTrainingForm({ ...trainingForm, [key]: value });
  const metadataValues = (key) => Array.from(new Set(projects.flatMap((project) => {
    const value = project[key];
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : [parsed]; } catch { return String(value).split(','); }
  }).map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const trainingFilterOptions = { scenes: metadataValues('scenes'), views: metadataValues('views'), modalities: metadataValues('modalities'), labels: metadataValues('labels') };
  const activeFilterSplit = splitName[activeDatasetSplit];
  const activeDatasetFilter = trainingForm.datasetFilters?.[activeFilterSplit] || { scenes: [], views: [], modalities: [], labels: [], keywords: [] };
  const setDatasetFilter = (key, values) => setTrainingForm({
    ...trainingForm,
    datasetFilters: {
      ...(trainingForm.datasetFilters || {}),
      [activeFilterSplit]: { ...activeDatasetFilter, [key]: values },
    },
  });
  const normalizeParameterSchema = (schema) => {
    const conflictingKeys = new Set(["model", "model_id", "model_path", "data", "dataset", "dataset_id", "dataset_project_id", "project", "project_id", "name", "task_name"]);
    const cleanFields = (fields = []) => fields.filter((field) => field?.key && !conflictingKeys.has(String(field.key).toLowerCase()));
    if (!schema) return [];
    if (Array.isArray(schema)) return [{ key: "parameters", label: "参数", fields: cleanFields(schema) }];
    if (Array.isArray(schema.groups)) return schema.groups.map((group, index) => ({ ...group, key: group.key || `group-${index}`, label: group.label || group.title || "参数", fields: cleanFields(group.fields) }));
    if (Array.isArray(schema.fields)) return [{ key: "parameters", label: schema.label || schema.title || "参数", fields: cleanFields(schema.fields) }];
    if (schema.properties && typeof schema.properties === "object") {
      return [{ key: "parameters", label: schema.title || "参数", fields: cleanFields(Object.entries(schema.properties).map(([key, value]) => ({ key, label: value.title || value.label || key, type: value.enum ? "select" : value.type, options: value.enum, default: value.default, min: value.minimum, max: value.maximum, step: value.multipleOf, description: value.description, required: schema.required?.includes(key) }))) }];
    }
    return [];
  };
  const parameterGroups = trainingForm.templateId ? normalizeParameterSchema(selectedAlgorithm.capabilities_json?.parameterSchema) : [];
  const parameterAliases = {
    yolo_version: "yoloVersion",
    taskType: "taskType",
    imgsz: "imgsz",
    batch: "batch",
    batch_size: "batch",
    epochs: "epochs",
    optimizer: "optimizer",
    lr0: "learningRate",
    learning_rate: "learningRate",
    save_period: "savePeriod",
    device: "device",
    amp: "amp",
  };
  const algorithmFieldValue = (field) => {
    if (Object.prototype.hasOwnProperty.call(trainingForm.algorithmParams || {}, field.key)) return trainingForm.algorithmParams[field.key];
    const alias = parameterAliases[field.key];
    if (alias && trainingForm[alias] !== undefined) {
      if (field.key === "yolo_version") return trainingForm.yoloVersion === "v11" ? "yolo11" : `yolov${String(trainingForm.yoloVersion || "v8").replace(/^v/i, "")}`;
      return trainingForm[alias];
    }
    return field.default ?? "";
  };
  const setAlgorithmField = (field, value) => {
    const alias = parameterAliases[field.key];
    const normalizedValue = field.type === "number" ? Number(value) : value;
    const next = { ...trainingForm, algorithmParams: { ...(trainingForm.algorithmParams || {}), [field.key]: normalizedValue } };
    if (alias) next[alias] = field.key === "yolo_version" ? (value === "yolo11" ? "v11" : String(value).replace(/^yolov/i, "v")) : normalizedValue;
    setTrainingForm(next);
  };
  const selectTrainingAlgorithm = (algorithmId) => {
    const algorithm = algorithms.find((item) => (item.id || item.template_key) === algorithmId);
    const defaults = { ...(algorithm?.default_params_json || {}) };
    for (const group of normalizeParameterSchema(algorithm?.capabilities_json?.parameterSchema)) {
      for (const field of group.fields || []) if (defaults[field.key] === undefined && field.default !== undefined) defaults[field.key] = field.default;
    }
    const linked = bestAssetLink(assetLinks, algorithmId);
    const nextForm = {
      ...trainingForm,
      templateId: algorithmId,
      taskType: algorithm?.capabilities_json?.tasks?.[0] || algorithm?.task_type || trainingForm.taskType,
      pythonEnvId: linked?.python_env_id || trainingForm.pythonEnvId,
      modelId: linked?.model_id || trainingForm.modelId,
      algorithmParams: defaults,
    };
    for (const [key, value] of Object.entries(defaults)) {
      const alias = parameterAliases[key];
      if (!alias) continue;
      nextForm[alias] = key === "yolo_version" ? (value === "yolo11" ? "v11" : String(value).replace(/^yolov/i, "v")) : value;
    }
    setTrainingForm(nextForm);
  };

  return (

    <div className="training-workspace resizable-workspace" style={{ "--workspace-left": `${columns.left}px`, "--workspace-right": `${columns.right}px` }}>

      <aside className="training-sidebar reference-sidebar">

        <h2>训练资源</h2>

        <div className="split-target-control" aria-label="选择左侧数据集要写入的划分">
          {[['trainProjectId', '训练'], ['valProjectId', '验证'], ['testProjectId', '测试']].map(([key, label]) => <button type="button" className={activeDatasetSplit === key ? 'active' : ''} key={key} onClick={() => setActiveDatasetSplit(key)}>{label}</button>)}
        </div>

        <div className="resource-tree">

          {resourceGroups.map((group) => (

            <section className="resource-group" key={group.title}>

              <button className="resource-group-head" type="button" onClick={() => toggleGroup(group.title)}>

                {expandedGroups.has(group.title) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

                <group.icon size={14} />

                <b>{group.title}</b>

                <em>{group.count}</em>

              </button>

              {expandedGroups.has(group.title) && group.rows.map((row) => (

                <button className={`${row.active ? 'active' : ''} depth-${row.depth || 0}`} style={{ "--depth": row.depth || 0 }} onClick={row.onClick} key={group.title + '-' + row.id} type="button">

                  <group.icon size={14} />

                  <span>{row.name}</span>

                  {row.badge && <strong>{row.badge}</strong>}

                  <em>{row.right}</em>

                </button>

              ))}

            </section>

          ))}

        </div>

        <div className="training-resource-meter"><span>资源使用</span><b>68%</b><i><em style={{ width: '68%' }} /></i><small>20 / 29 TB</small></div>

      </aside>

      <WorkspaceResizeHandle side="left" onPointerDown={beginResize} />

      <main className="training-main">

        <div className="training-toolbar inference-toolbar">

          <div className="platform-breadcrumb"><Folder size={16} /><b>训练</b><ChevronRight size={14} /><b>新建训练任务</b></div>

          <div className="inference-commandbar">

            <button onClick={submitTrainingJob}><span>+</span> 新建训练任务</button>

            <button><Copy size={15} /> 批量训练</button>

            <button className="danger-outline"><Pause size={15} /> 停止训练</button>

            <button><RefreshCw size={15} /> 刷新</button>

          </div>

        </div>

        <div className="training-builder reference-builder">

          <section className="reference-section dataset-split-section">
            <h2>数据与标签</h2>
            <div className="dataset-split-grid">
              {[["trainProjectId", "训练集", "train", trainProjectIds], ["valProjectId", "验证集", "val", valProjectIds], ["testProjectId", "测试集", "test", testProjectIds]].map(([key, label, hint, selectedIds]) => (
                <label className="training-multiselect" key={key}><span>{label}<small>{hint} · 可多选</small></span><select multiple value={selectedIds} size={Math.min(5, Math.max(3, projects.length))} onFocus={() => setActiveDatasetSplit(key)} onChange={(event) => { const nextIds = Array.from(event.target.selectedOptions, (option) => option.value); const next = { ...trainingForm, [splitArrayKey[key]]: nextIds, [key]: nextIds[0] || "" }; if (key === "trainProjectId") next.datasetProjectId = nextIds[0] || ""; setTrainingForm(next); }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {formatCount(project.image_count || 0)} 图像</option>)}</select><small className="selection-summary">已选择 {selectedIds.length} 个{label}</small></label>
              ))}
            </div>
            <div className="dataset-filter-panel">
              <b>{activeFilterSplit === "train" ? "训练集" : activeFilterSplit === "val" ? "验证集" : "测试集"}筛选</b>
              {[["views", "视角"], ["scenes", "场景"], ["modalities", "模态"], ["labels", "目标标签"]].map(([key, label]) => <label key={key}><span>{label}</span><select multiple value={activeDatasetFilter[key] || []} onChange={(event) => setDatasetFilter(key, Array.from(event.target.selectedOptions, (option) => option.value))}>{trainingFilterOptions[key].map((value) => <option key={value} value={value}>{metadataLabel(value, key)}</option>)}</select></label>)}
              <label><span>其他标签/关键词</span><input value={(activeDatasetFilter.keywords || []).join(", ")} onChange={(event) => setDatasetFilter("keywords", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder="逗号分隔" /></label>
            </div>
            <div className="dataset-meta-row"><span>活动标签：{String(selectedProject.active_label_version_id || 'active').slice(0, 8)}</span><span>训练图像：{formatCount(selectedProject.image_count || 0)}</span><span>划分由导入结果确定，不再使用固定比例</span></div>
          </section>

          <section className="reference-section model-init-section">
            <h2>算法与初始化</h2>
            <div className="config-row model-init-row"><span className="row-label">算法适配器</span><select value={trainingForm.templateId} onChange={(e) => selectTrainingAlgorithm(e.target.value)}><option value="">选择算法适配器</option>{algorithms.map((algorithm) => <option key={algorithm.id || algorithm.template_key} value={algorithm.id || algorithm.template_key}>{algorithm.name}</option>)}</select><span className="row-label">初始化方式</span><select value={trainingForm.initializationMode} onChange={(e) => setTrainingForm({ ...trainingForm, initializationMode: e.target.value, initialModelVersionId: '', resume: false })}><option value="random">随机初始化（不加载权重）</option><option value="zero">零初始化（不加载权重）</option><option value="pretrained">预训练权重</option><option value="training">训练任务产物</option></select>{['pretrained', 'training'].includes(trainingForm.initializationMode) ? <><span className="row-label">初始化权重</span><select value={trainingForm.initialModelVersionId} onChange={(e) => setField('initialModelVersionId', e.target.value)}><option value="">选择权重</option>{modelVersions.filter((version) => trainingForm.initializationMode === 'training' ? Boolean(version.training_job_id) : !version.training_job_id || version.stage === 'pretrained').map((version) => <option key={version.id} value={version.id}>{version.model_name} / {version.version_name}</option>)}</select>{trainingForm.initializationMode === 'training' && trainingForm.initialModelVersionId && <button className={`icon-toggle ${trainingForm.resume ? 'active' : ''}`} type="button" title={trainingForm.resume ? '从检查点继续训练' : '仅加载权重并从头训练'} onClick={() => setField('resume', !trainingForm.resume)}><RotateCcw size={15} /></button>}</> : <span className="initialization-note">{trainingForm.initializationMode === 'zero' ? '全部可训练参数从 0 开始，不使用任何模型权重。' : '按算法默认分布随机生成参数，不使用任何模型权重。'}</span>}</div>
            <div className="config-row"><span className="row-label">Python 环境</span><select value={trainingForm.pythonEnvId} onChange={(e) => { const env = pythonEnvs.find((item) => item.id === e.target.value); setTrainingForm({ ...trainingForm, pythonEnvId: e.target.value, python: env?.python_path || trainingForm.python }); }}><option value="">选择 Python 环境</option>{pythonEnvs.map((env) => <option key={env.id} value={env.id}>{env.name} · {env.status}</option>)}</select><span>{selectedEnv.python_version || '--'} · {selectedEnv.torch_version || '--'} · {(selectedEnv.accelerator || 'CPU').toUpperCase()}</span></div>
          </section>

          <section className="reference-section algorithm-params-section"><h2>训练参数{selectedAlgorithm.name ? ` · ${selectedAlgorithm.name}` : ''}</h2>{!trainingForm.templateId ? <div className="parameter-placeholder">尚未选择算法，训练参数为空。</div> : parameterGroups.length ? <div className="parameter-groups schema-parameter-groups">{parameterGroups.map((group) => { const advanced = /advanced|高级/i.test(`${group.key || ''} ${group.label || ''}`); return <details className="parameter-group" key={group.key || group.label} open={!advanced}><summary>{group.label}{advanced ? <small>展开</small> : null}</summary><fieldset>{(group.fields || []).map((field) => <label key={field.key} title={field.description || ''}><span>{field.label || field.key}{field.required ? <b className="required-mark">*</b> : null}</span>{field.type === 'boolean' ? <span className="switch-control"><input type="checkbox" checked={Boolean(algorithmFieldValue(field))} onChange={() => setAlgorithmField(field, !Boolean(algorithmFieldValue(field)))} /><i /></span> : (field.type === 'select' || field.options) ? <select value={algorithmFieldValue(field)} onChange={(e) => setAlgorithmField(field, e.target.value)}>{(field.options || []).map((option) => { const value = typeof option === 'object' ? option.value : option; const label = typeof option === 'object' ? option.label : option; return <option key={String(value)} value={value}>{label}</option>; })}</select> : <input type={['number', 'integer'].includes(field.type) ? 'number' : 'text'} min={field.min} max={field.max} step={field.step || (field.type === 'integer' ? 1 : undefined)} value={algorithmFieldValue(field)} onChange={(e) => setAlgorithmField(field, e.target.value)} />}</label>)}</fieldset></details>; })}</div> : <div className="parameter-placeholder">该算法未在 capabilities_json.parameterSchema 中声明训练参数。</div>}</section>

          <section className="reference-section"><h2>输出与版本</h2><div className="config-row output-row"><label className="switch-option">保存 best / last<span className="switch-control"><input type="checkbox" defaultChecked /><i /></span></label><label>间隔 Epoch<input className="save-period-input" type="number" min="1" value={trainingForm.savePeriod} onChange={(e) => setField('savePeriod', e.target.value)} /></label><label className="switch-option">创建模型版本<span className="switch-control"><input type="checkbox" defaultChecked /><i /></span></label><div className="path-select"><Folder size={14} /><input value="/training/outputs" readOnly /><Download size={14} /></div></div></section>

        </div>

        <section className="training-queue reference-queue">
          <h2>训练任务队列 <span>共 {queueRows.length} 条</span></h2>
          <div className="training-table-head">
            <span>任务名称</span><span>数据</span><span>模型</span><span>状态</span><span>进度</span>
            <span>Epoch</span><span>box_loss</span><span>mAP50</span><span>ETA</span><span>操作</span>
          </div>
          {queueRows.map((job, index) => {
            const persistedJob = Boolean(job.id && !String(job.id).startsWith("mock-"));
            const terminalJob = ["done", "failed", "cancelled"].includes(String(job.status || "").toLowerCase());
            return (
              <div className="training-table-row" key={job.id || index} onClick={() => setActiveTrainingJobId(job.id)}>
                <b>{job.name || "训练任务"}</b>
                <span>{job.dataset_project_name || selectedProject.name || "--"}</span>
                <span>{job.model_name || selectedModel.name || "--"}</span>
                <em className={"status-badge " + (String(job.status).includes("fail") ? "status-failed" : "")}>{runStatusLabel(job.status)}</em>
                <i className="mini-progress"><b style={{ width: (job.progress ?? progress) + "%" }} /></i>
                <span>{job.current_epoch || epoch}/{job.total_epochs || totalEpochs}</span>
                <span>{job.box_loss ?? parseMaybeJson(job.metrics_json)?.box_loss ?? "--"}</span>
                <span>{formatMetric(job.map50 ?? parseMaybeJson(job.metrics_json)?.map50)}</span>
                <span>{job.eta || job.eta_text || "--"}</span>
                <div className="training-row-actions">
                  <button title="查看任务" onClick={(event) => { event.stopPropagation(); setActiveTrainingJobId(job.id); }}><Eye size={14} /></button>
                  <button title="上移" disabled={!persistedJob} onClick={(event) => { event.stopPropagation(); moveRuntimeQueueJob?.("training", job.id, "up"); }}><ArrowUp size={14} /></button>
                  <button title="下移" disabled={!persistedJob} onClick={(event) => { event.stopPropagation(); moveRuntimeQueueJob?.("training", job.id, "down"); }}><ArrowDown size={14} /></button>
                  <button title={job.status === "paused" ? "继续任务" : "暂停任务"} disabled={!persistedJob || terminalJob} onClick={(event) => { event.stopPropagation(); updateTrainingJobState?.(job.id, job.status === "paused" ? "resume" : "pause"); }}>{job.status === "paused" ? <Play size={14} /> : <Pause size={14} />}</button>
                  <button className="restart-action" title="重新开始" disabled={!persistedJob} onClick={(event) => { event.stopPropagation(); requeueTrainingJob?.(job.id); }}><RotateCcw size={15} strokeWidth={2.2} /></button>
                  <button className="danger-icon" title="删除任务" disabled={!persistedJob} onClick={(event) => { event.stopPropagation(); deleteTrainingJob?.(job.id); }}><Trash2 size={14} /></button>
                  <button title="打开 TensorBoard" onClick={(event) => { event.stopPropagation(); window.open("http://127.0.0.1:6006", "_blank"); }}><Grid size={14} /></button>
                </div>
              </div>
            );
          })}
          {!queueRows.length && <div className="queue-empty">暂无训练任务，配置完成后点击“新建训练任务”。</div>}
        </section>

      </main>

      <WorkspaceResizeHandle side="right" onPointerDown={beginResize} />

      <aside className="training-inspector reference-inspector">

        <div className="inspector-title"><h2>训练监控</h2><button><RefreshCw size={14} /></button></div>

        <div className="training-kpis">{trainMetrics.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>

        <section className="training-chart-panel"><h3>实时曲线</h3>{runningJob ? <><svg viewBox="0 0 360 190" preserveAspectRatio="none"><path className="loss-line" d="M0 35 C55 58 86 72 130 92 S220 124 360 148"/><path className="val-line" d="M0 52 C70 74 120 88 178 108 S270 138 360 156"/><path className="map-line" d="M0 166 C60 144 98 134 145 108 S250 70 360 42"/><path className="precision-line" d="M0 150 C66 126 120 112 180 86 S280 55 360 34"/></svg><div className="training-chart-legend"><span><i />train loss</span><span><i />val loss</span><span><i />mAP50</span><span><i />precision</span></div></> : <div className="parameter-placeholder">暂无训练曲线</div>}</section>

        <section className="training-log-panel"><h3>运行日志</h3>{logRows.length ? logRows.map((line, index) => <p key={index}>{line}</p>) : <p>暂无运行日志</p>}</section>

        <section className="artifact-preview"><h3>产物预览</h3>{runningJob ? ['best.pt', 'last.pt', 'results.csv', 'confusion_matrix.png'].map((name) => <p key={name}><Database size={14} /><span>{name}</span><em>已写入 MinIO</em></p>) : <p><span>暂无训练产物</span></p>}</section>

      </aside>

    </div>

  );

}
