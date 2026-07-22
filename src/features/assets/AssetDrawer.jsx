import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { getAssetDrawerSubtitle, getAssetDrawerTitle } from "./assetDrawerPresentation.js";
import { DrawerField } from "./DrawerField.jsx";
import { DrawerInputWithIcon } from "./DrawerInputWithIcon.jsx";

export function AssetDrawer({
  mode,
  setMode,
  onClose,
  projects = [],
  mlModels,
  modelForm,
  setModelForm,
  versionForm,
  setVersionForm,
  envForm,
  setEnvForm,
  createModel,
  createModelVersion,
  inspectModelWeight,
  createPythonEnv,
}) {
  const drawerTitle = getAssetDrawerTitle(mode);
  const drawerSubtitle = getAssetDrawerSubtitle(mode);

  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const previousAutoName = useRef("");
  const selectedModel = mlModels.find((model) => model.id === versionForm.modelId);
  const selectedProject = projects.find((project) => project.id === versionForm.datasetProjectId);
  const automaticVersionName = useMemo(() => {
    const clean = (value) => String(value || "").trim().replace(/[\\/:*?"<>|\s]+/g, "_").replace(/_+/g, "_");
    const epoch = String(versionForm.sourcePath || "").match(/epoch[_-]?(\d+)/i)?.[1];
    return [clean(selectedModel?.name || "model"), clean(selectedProject?.name || "unknown"), epoch ? `epoch${epoch}` : null].filter(Boolean).join("_");
  }, [selectedModel?.name, selectedProject?.name, versionForm.sourcePath]);

  useEffect(() => {
    if (mode !== "version" && mode !== "pretrained") return;
    if (!versionForm.versionName || versionForm.versionName === previousAutoName.current) {
      previousAutoName.current = automaticVersionName;
      setVersionForm((current) => ({ ...current, versionName: automaticVersionName }));
    }
  }, [automaticVersionName, mode, setVersionForm, versionForm.versionName]);

  useEffect(() => {
    if ((mode !== "version" && mode !== "pretrained") || !versionForm.modelId || !versionForm.sourcePath.trim()) {
      setAnalysis(null);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        setAnalysis({ loading: true });
        setAnalysis(await inspectModelWeight({ modelId: versionForm.modelId, sourcePath: versionForm.sourcePath }));
      } catch (error) {
        setAnalysis({ error: error.message });
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [inspectModelWeight, mode, versionForm.modelId, versionForm.sourcePath]);

  const submit = async () => {
    setSubmitMessage("");
    if (mode === "cluster") createModel();
    if (mode === "version" || mode === "pretrained") {
      if (analysis?.error) {
        setSubmitMessage(analysis.error);
        return;
      }
      setSubmitting(true);
      try {
        await createModelVersion();
        onClose();
      } catch (error) {
        setSubmitMessage(error.message);
      } finally {
        setSubmitting(false);
      }
    }
    if (mode === "env") createPythonEnv();
    if (mode === "algorithm") window.alert("算法适配器导入接口待接入，当前已完成界面布局");
  };

  return (
    <aside className="asset-drawer" role="dialog" aria-modal="true" aria-label={drawerTitle}>
      <div className="drawer-head">
        <div>
          <h2>{drawerTitle}</h2>
          <p>{drawerSubtitle}</p>
        </div>
        <button className="drawer-close" onClick={onClose} aria-label="关闭"><X size={17} /></button>
      </div>
      <div className="drawer-tabs">
        <button type="button" className={mode === "cluster" ? "active" : ""} onClick={() => setMode("cluster")}>模型簇</button>
        <button type="button" className={mode === "version" ? "active" : ""} onClick={() => { setVersionForm({ ...versionForm, stage: "candidate" }); setMode("version"); }}>模型库模型</button>
        <button type="button" className={mode === "pretrained" ? "active" : ""} onClick={() => { setVersionForm({ ...versionForm, stage: "pretrained" }); setMode("pretrained"); }}>预训练模型</button>
        <button type="button" className={mode === "algorithm" ? "active" : ""} onClick={() => setMode("algorithm")}>算法适配</button>
        <button type="button" className={mode === "env" ? "active" : ""} onClick={() => setMode("env")}>Python 环境</button>
      </div>
      <div className="drawer-body">
        {mode === "cluster" && (
          <>
            <DrawerField label="模型簇名"><input value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} placeholder="YOLOv8" /></DrawerField>
            <DrawerField label="任务类型"><select value={modelForm.taskType} onChange={(e) => setModelForm({ ...modelForm, taskType: e.target.value })}><option value="detect">目标检测</option><option value="segment">实例分割</option><option value="classify">分类</option></select></DrawerField>
            <DrawerField label="算法名称"><input value={modelForm.framework} onChange={(e) => setModelForm({ ...modelForm, framework: e.target.value })} placeholder="ultralytics" /></DrawerField>
            <DrawerField label="说明" tall><textarea value={modelForm.description} onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })} placeholder="模型簇用途、适用场景、版本策" /></DrawerField>
          </>
        )}
        {(mode === "version" || mode === "pretrained") && (
          <>
            <DrawerField label="所属模型簇"><select value={versionForm.modelId} onChange={(e) => setVersionForm({ ...versionForm, modelId: e.target.value })}><option value="">请选择模型</option>{mlModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></DrawerField>
            <DrawerField label="版本名称"><input value={versionForm.versionName} onChange={(e) => setVersionForm({ ...versionForm, versionName: e.target.value })} placeholder="yolov8n_ultralytics_8.4.80_cpu" /></DrawerField>
            <DrawerField label="权重来源"><div className="drawer-segment"><button className="active" type="button">本地路径</button><button type="button">MinIO路径</button><button type="button">训练产物</button></div></DrawerField>
            <DrawerField label="权重文件路径"><DrawerInputWithIcon value={versionForm.sourcePath} onChange={(e) => setVersionForm({ ...versionForm, sourcePath: e.target.value })} placeholder="C:\\Users\\Administrator\\Downloads\\v8_s.pt" /></DrawerField>
            <DrawerField label="训练数据"><select value={versionForm.datasetProjectId || "unknown"} onChange={(e) => setVersionForm({ ...versionForm, datasetProjectId: e.target.value })}><option value="unknown">未知</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></DrawerField>
            <DrawerField label="阶段"><select value={versionForm.stage} onChange={(e) => setVersionForm({ ...versionForm, stage: e.target.value })} disabled={mode === "pretrained"}><option value="pretrained">预训练</option><option value="candidate">模型库</option><option value="published">已发布</option></select></DrawerField>
            <DrawerField label="说明" tall><textarea value={versionForm.description || ""} onChange={(e) => setVersionForm({ ...versionForm, description: e.target.value })} placeholder="请输入说明（可选）" maxLength={500} /></DrawerField>
            <div className={`auto-parse-card ${analysis?.error ? "has-error" : ""}`}><h3>自动解析</h3><p><span>文件大小</span><b>{analysis?.loading ? "解析中..." : analysis?.sizeLabel || "--"}</b></p><p><span>SHA256</span><b title={analysis?.sha256}>{analysis?.sha256 ? `${analysis.sha256.slice(0, 16)}...` : analysis?.sha256Pending ? "登记时计算" : "--"}</b></p><p><span>框架</span><b>{analysis?.framework || selectedModel?.framework || "待解析"}</b></p><p><span>任务</span><b>{analysis?.taskType || selectedModel?.task_type || "detect"}</b></p>{analysis?.error && <p className="drawer-inline-error">{analysis.error}</p>}</div>
          </>
        )}
        {mode === "algorithm" && (
          <>
            <DrawerField label="适配器名"><input placeholder="Ultralytics YOLO" /></DrawerField>
            <DrawerField label="算法 key"><input placeholder="ultralytics_yolo" /></DrawerField>
            <DrawerField label="框架"><select><option>Ultralytics</option><option>PyTorch</option><option>Custom</option></select></DrawerField>
            <DrawerField label="代码来源"><DrawerInputWithIcon placeholder="本地文件夹 / zip 包 / Git 地址" /></DrawerField>
            <DrawerField label="入口文件"><input placeholder="adapter.py" /></DrawerField>
            <DrawerField label="默认参数" tall><textarea placeholder='{"conf":0.25,"iou":0.7}' /></DrawerField>
            <div className="auto-parse-card"><h3>适配器检</h3><p><span>接口</span><b>统一 Adapter</b></p><p><span>数据加载</span><b>DatasetLoader</b></p><p><span>任务</span><b>detect</b></p></div>
          </>
        )}
        {mode === "env" && (
          <>
            <DrawerField label="来源类型"><select value={envForm.sourceType} onChange={(e) => setEnvForm({ ...envForm, sourceType: e.target.value })}><option value="conda_pack">conda-pack 环境包入 MinIO</option><option value="server_managed">服务器托管 Python</option></select></DrawerField>
            <DrawerField label="环境"><input value={envForm.name} onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })} placeholder="留空自动生成 py3.12-torch2.12-cpu" /></DrawerField>
            {envForm.sourceType === "server_managed" || envForm.sourceType === "server_python" ? (
              <DrawerField label="Python 路径"><DrawerInputWithIcon value={envForm.pythonPath} onChange={(e) => setEnvForm({ ...envForm, pythonPath: e.target.value })} placeholder="D:\\Program Files\\miniforge3\\envs\\yolo\\python.exe" /></DrawerField>
            ) : (
              <DrawerField label="环境包路"><DrawerInputWithIcon value={envForm.condaPackPath} onChange={(e) => setEnvForm({ ...envForm, condaPackPath: e.target.value })} placeholder="E:\\projects\\DD-runtime\\minio\\zbh-datasets\\envs\\yolo.tar.gz" /></DrawerField>
            )}
            {envForm.sourceType === "conda_pack" && (<DrawerField label="解包后路径"><input value={envForm.unpackPath} onChange={(e) => setEnvForm({ ...envForm, unpackPath: e.target.value })} placeholder="可留空；默认解包到 MinIO envs/python 目录" /></DrawerField>)}
            <div className="auto-parse-card"><h3>检测结</h3><p><span>Python</span><b>提交后检</b></p><p><span>Torch</span><b>提交后检</b></p><p><span>CUDA</span><b>提交后检</b></p></div>
          </>
        )}
      </div>
      <div className="drawer-actions">
        {submitMessage && <span className="drawer-submit-message">{submitMessage}</span>}
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit} disabled={submitting || analysis?.loading}>{submitting ? "登记中..." : drawerTitle}</button>
      </div>
    </aside>
  );
}
