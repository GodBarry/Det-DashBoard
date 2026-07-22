import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, File, Folder, X } from "lucide-react";
import { CascadingProjectPicker } from "../../components/CascadingProjectPicker.jsx";

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
  const [filePicker, setFilePicker] = useState(null);
  const [filePickerBusy, setFilePickerBusy] = useState(false);
  const previousAutoName = useRef("");
  const analysisSequence = useRef(0);
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
    const controller = new AbortController();
    const sequence = ++analysisSequence.current;
    const timer = window.setTimeout(async () => {
      try {
        setAnalysis({ loading: true });
        const timeout = window.setTimeout(() => controller.abort(), 8000);
        const result = await inspectModelWeight({ modelId: versionForm.modelId, sourcePath: versionForm.sourcePath }, controller.signal);
        window.clearTimeout(timeout);
        if (sequence === analysisSequence.current) setAnalysis(result);
      } catch (error) {
        if (sequence === analysisSequence.current) setAnalysis({ error: error.name === "AbortError" ? "自动解析超时，可直接登记或检查服务器路径" : error.message });
      }
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [inspectModelWeight, mode, versionForm.modelId, versionForm.sourcePath]);

  const submit = async () => {
    setSubmitMessage("");
    if (mode === "cluster") createModel();
    if (mode === "version" || mode === "pretrained") {
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

  const openServerFilePicker = async (target = "__roots__") => {
    setFilePickerBusy(true);
    try {
      const response = await fetch(`/api/fs/files?path=${encodeURIComponent(target)}&extensions=.pt,.pth,.onnx`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取服务器目录失败");
      setFilePicker(data);
    } catch (error) {
      setSubmitMessage(error.message);
    } finally {
      setFilePickerBusy(false);
    }
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
            <DrawerField label="权重来源"><div className="drawer-segment">{[["local", "本地路径"], ["server", "服务器路径"], ["network", "网络路径"]].map(([value, label]) => <button className={(versionForm.sourceType || "local") === value ? "active" : ""} type="button" key={value} onClick={() => { setVersionForm({ ...versionForm, sourceType: value, sourcePath: "" }); setAnalysis(null); }}>{label}</button>)}</div></DrawerField>
            <DrawerField label={(versionForm.sourceType || "local") === "network" ? "SSH / SCP 路径" : "权重文件路径"}><DrawerInputWithIcon value={versionForm.sourcePath} onChange={(e) => setVersionForm({ ...versionForm, sourcePath: e.target.value })} onIconClick={(versionForm.sourceType || "local") === "network" ? undefined : () => openServerFilePicker("__roots__")} iconTitle="浏览服务器权重文件" placeholder={(versionForm.sourceType || "local") === "network" ? "scp://user@server/path/best.pth" : "E:\\models\\best.pth 或 /srv/models/best.pth"} /></DrawerField>
            {(versionForm.sourceType || "local") === "network" && <p className="drawer-source-hint">{"服务器将使用已配置的 SSH 密钥通过 SCP 下载；支持 scp://user@host/path 或 user@host:/path。"}</p>}
            <DrawerField label="训练数据"><div className="asset-dataset-picker"><CascadingProjectPicker projects={projects} value={versionForm.datasetProjectId === "unknown" ? "" : versionForm.datasetProjectId} onChange={(value) => setVersionForm({ ...versionForm, datasetProjectId: value || "unknown" })} storageKey="asset-version-dataset" ariaLabel="选择训练数据集" /><button type="button" className={`asset-unknown-dataset ${versionForm.datasetProjectId === "unknown" ? "active" : ""}`} onClick={() => setVersionForm({ ...versionForm, datasetProjectId: "unknown" })}>未知</button></div></DrawerField>
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
      {filePicker && <div className="asset-file-picker"><div className="asset-file-picker-head"><button type="button" disabled={!filePicker.parent || filePickerBusy} onClick={() => openServerFilePicker(filePicker.parent)}><ChevronLeft size={14} /></button><b title={filePicker.current}>{filePicker.current}</b><button type="button" onClick={() => setFilePicker(null)}><X size={14} /></button></div><div className="asset-file-picker-list">{(filePicker.dirs || []).map((dir) => <button type="button" key={dir.path} onClick={() => openServerFilePicker(dir.path)}><Folder size={15} /><span>{dir.name}</span></button>)}{(filePicker.files || []).map((file) => <button type="button" key={file.path} onClick={() => { setVersionForm({ ...versionForm, sourcePath: file.path }); setFilePicker(null); }}><File size={15} /><span>{file.name}</span><em>{file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.ceil(file.size / 1024)} KB`}</em></button>)}{filePickerBusy && <p>正在读取目录...</p>}{!filePickerBusy && !(filePicker.dirs || []).length && !(filePicker.files || []).length && <p>此目录没有可用的模型文件</p>}</div></div>}
      <div className="drawer-actions">
        {submitMessage && <span className="drawer-submit-message">{submitMessage}</span>}
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit} disabled={submitting}>{submitting ? "登记中..." : drawerTitle}</button>
      </div>
    </aside>
  );
}
