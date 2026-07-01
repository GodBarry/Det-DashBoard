import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  Boxes,
  Brain,
  Cpu,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Import,
  Play,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import "./styles.css";

const colors = ["#31d0aa", "#72a7ff", "#ffcc66", "#ff7c7c", "#b48cff", "#6ee7ff", "#f59bd3", "#a3e635"];

function App() {
  const [view, setView] = useState("home");
  const [projects, setProjects] = useState([]);
  const [trashProjects, setTrashProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [imports, setImports] = useState([]);
  const [trashImports, setTrashImports] = useState([]);
  const [latestImport, setLatestImport] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ q: "", scenes: [], views: [], modalities: [], labels: [], importBatchIds: [] });
  const [page, setPage] = useState(1);
  const pageSize = 48;
  const [error, setError] = useState(null);
  const [appConfig, setAppConfig] = useState({ dataRoot: "/home/barry/图片", dataRootDisplay: "/home/barry/图片", browseRootDisplay: "/", hostDialogUrl: "", nativeDialogMode: "server" });
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showBaselineDialog, setShowBaselineDialog] = useState(false);
  const [baselineName, setBaselineName] = useState("");
  const [baselineSources, setBaselineSources] = useState([]);
  const [baselineParams, setBaselineParams] = useState({ iouSame: 0.9, iouLight: 0.75 });
  const [baselinePreview, setBaselinePreview] = useState(null);
  const [baselineConflicts, setBaselineConflicts] = useState([]);
  const [selectedConflictIds, setSelectedConflictIds] = useState([]);
  const [activeConflictId, setActiveConflictId] = useState(null);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [browseBusy, setBrowseBusy] = useState(false);
  const [dirPicker, setDirPicker] = useState(null);
  const [dirPickerBusy, setDirPickerBusy] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [checkedIds, setCheckedIds] = useState([]);
  const [lastCheckedId, setLastCheckedId] = useState(null);
  const [mlModels, setMlModels] = useState([]);
  const [modelVersions, setModelVersions] = useState([]);
  const [trainingJobs, setTrainingJobs] = useState([]);
  const [inferenceJobs, setInferenceJobs] = useState([]);
  const [trainingTemplates, setTrainingTemplates] = useState([]);
  const [pythonEnvs, setPythonEnvs] = useState([]);
  const [modelForm, setModelForm] = useState({ name: "", taskType: "detect", framework: "ultralytics", description: "" });
  const [trainingForm, setTrainingForm] = useState({ name: "", datasetProjectId: "", modelId: "", initialModelVersionId: "", templateId: "", taskType: "detect", pythonEnvId: "", python: "D:\\ProgramData\\miniforge3\\python.exe", epochs: 100, imgsz: 640, batch: 16, device: "0" });
  const [inferenceForm, setInferenceForm] = useState({ name: "", datasetProjectId: "", modelVersionId: "", conf: 0.25, iou: 0.7, imgsz: 640 });
  const [versionForm, setVersionForm] = useState({ modelId: "", versionName: "", sourcePath: "", stage: "pretrained" });
  const [templateForm, setTemplateForm] = useState({ name: "", templateKey: "ultralytics_yolo", framework: "ultralytics", tasks: ["detect", "segment", "classify"], description: "" });
  const [envForm, setEnvForm] = useState({ name: "", pythonPath: "", envType: "miniforge", osType: "windows", arch: "x86_64", accelerator: "cpu" });
  const [activeTrainingJobId, setActiveTrainingJobId] = useState(null);
  const [trainingLogs, setTrainingLogs] = useState([]);

  useEffect(() => {
    refreshHome();
    fetch("/api/config").then((r) => r.json()).then((d) => setAppConfig(d)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeProject) return;
    loadWorkspace(activeProject.id);
  }, [activeProject, page, filters]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetch("/api/jobs").then((r) => r.json()).then((d) => setJobs(d.jobs || [])).catch(() => {});
      if (activeProject) {
        loadImports(activeProject.id);
        loadSummary(activeProject.id);
      } else {
        setLatestImport(null);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeProject]);

  useEffect(() => {
    if (!["training", "inference", "models"].includes(view)) return;
    const timer = window.setInterval(() => loadMlPlatform(), 2500);
    return () => window.clearInterval(timer);
  }, [view]);

  useEffect(() => {
    if (!activeTrainingJobId) {
      setTrainingLogs([]);
      return;
    }
    fetch(`/api/ml/training-jobs/${activeTrainingJobId}/logs`)
      .then((r) => r.json())
      .then((d) => setTrainingLogs(d.logs || []))
      .catch(() => {});
  }, [activeTrainingJobId, trainingJobs]);

  function refreshHome() {
    fetch("/api/projects").then((r) => r.json()).then((d) => setProjects(d.projects || [])).catch(() => {});
    fetch("/api/projects/trash").then((r) => r.json()).then((d) => setTrashProjects(d.projects || [])).catch(() => {});
  }

  function loadMlPlatform() {
    fetch("/api/ml/models").then((r) => r.json()).then((d) => setMlModels(d.models || [])).catch(() => {});
    fetch("/api/ml/model-versions").then((r) => r.json()).then((d) => setModelVersions(d.versions || [])).catch(() => {});
    fetch("/api/ml/training-jobs").then((r) => r.json()).then((d) => setTrainingJobs(d.jobs || [])).catch(() => {});
    fetch("/api/ml/inference-jobs").then((r) => r.json()).then((d) => setInferenceJobs(d.jobs || [])).catch(() => {});
    fetch("/api/ml/training-templates").then((r) => r.json()).then((d) => setTrainingTemplates(d.templates || [])).catch(() => {});
    fetch("/api/ml/python-envs").then((r) => r.json()).then((d) => setPythonEnvs(d.envs || [])).catch(() => {});
    refreshHome();
  }

  function openPlatform(nextView) {
    setView(nextView);
    setActiveProject(null);
    setError(null);
    loadMlPlatform();
  }

  function createModel() {
    fetch("/api/ml/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(modelForm),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "创建模型失败");
        setModelForm({ name: "", taskType: "detect", framework: "ultralytics", description: "" });
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function submitTrainingJob() {
    fetch("/api/ml/training-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: trainingForm.name,
        datasetProjectId: trainingForm.datasetProjectId,
        modelId: trainingForm.modelId || null,
        templateId: trainingForm.templateId || null,
        taskType: trainingForm.taskType,
        pythonEnvId: trainingForm.pythonEnvId || null,
        initialModelVersionId: trainingForm.initialModelVersionId || null,
        params: { python: trainingForm.python, epochs: Number(trainingForm.epochs), imgsz: Number(trainingForm.imgsz), batch: Number(trainingForm.batch), device: trainingForm.device },
      }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "提交训练失败");
        setTrainingForm({ ...trainingForm, name: "" });
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function requeueTrainingJob(jobId) {
    fetch(`/api/ml/training-jobs/${jobId}/requeue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: { python: trainingForm.python, initialModelVersionId: trainingForm.initialModelVersionId || undefined } }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "重新入队失败");
        setActiveTrainingJobId(jobId);
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function createModelVersion() {
    fetch("/api/ml/model-versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(versionForm),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "登记模型版本失败");
        setVersionForm({ modelId: versionForm.modelId, versionName: "", sourcePath: "", stage: "pretrained" });
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function createTrainingTemplate() {
    fetch("/api/ml/training-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...templateForm, capabilities: { tasks: templateForm.tasks } }),
    }).then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "创建模板失败");
        setTemplateForm({ name: "", templateKey: "ultralytics_yolo", framework: "ultralytics", tasks: ["detect", "segment", "classify"], description: "" });
        loadMlPlatform();
      }).catch((err) => setError(err.message));
  }

  function createPythonEnv() {
    fetch("/api/ml/python-envs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envForm),
    }).then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "登记环境失败");
        setEnvForm({ name: "", pythonPath: "", envType: "miniforge", osType: "windows", arch: "x86_64", accelerator: "cpu" });
        loadMlPlatform();
      }).catch((err) => setError(err.message));
  }

  function renameModelVersion(version) {
    const next = window.prompt("请输入新的模型版本名", version.version_name);
    if (!next || next === version.version_name) return;
    fetch(`/api/ml/model-versions/${version.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versionName: next }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "重命名失败");
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function submitInferenceJob() {
    fetch("/api/ml/inference-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: inferenceForm.name,
        datasetProjectId: inferenceForm.datasetProjectId,
        modelVersionId: inferenceForm.modelVersionId || null,
        params: { conf: Number(inferenceForm.conf), iou: Number(inferenceForm.iou), imgsz: Number(inferenceForm.imgsz) },
      }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "提交推理失败");
        setInferenceForm({ ...inferenceForm, name: "" });
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function loadWorkspace(projectId) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), q: filters.q || "" });
    for (const key of ["scenes", "views", "modalities", "labels", "importBatchIds"]) {
      if (filters[key]?.length) params.set(key, filters[key].join(","));
    }
    fetch(`/api/projects/${projectId}/images?${params}`).then((r) => r.json()).then((d) => {
      setItems(d.items || []);
      if (!selected && d.items?.[0]) setSelected(d.items[0]);
      if (selected && !d.items?.some((item) => item.id === selected.id)) setSelected(d.items?.[0] || null);
      setCheckedIds((ids) => ids.filter((id) => d.items?.some((item) => item.id === id)));
    }).catch(() => {});
    loadSummary(projectId);
    loadImports(projectId);
  }

  function loadSummary(projectId) {
    fetch(`/api/projects/${projectId}/summary`).then((r) => r.json()).then((d) => setSummary(d.summary || null)).catch(() => {});
  }

  function loadImports(projectId) {
    fetch(`/api/projects/${projectId}/imports`).then((r) => r.json()).then((d) => {
      const rows = d.imports || [];
      setImports(rows);
      const running = rows.find((row) => ["scanning", "running", "cancel_requested"].includes(row.status));
      setLatestImport(running || null);
    }).catch(() => {});
    fetch(`/api/projects/${projectId}/imports?trash=1`).then((r) => r.json()).then((d) => setTrashImports(d.imports || [])).catch(() => {});
  }

  function createProject() {
    const name = window.prompt("请输入项目名称", "新建项目");
    if (!name) return;
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
      .then((r) => r.json())
      .then(() => refreshHome());
  }

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
      setError("请选择至少一个来源项目");
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
        if (status >= 400) throw new Error(data.error || "基准预分析失败");
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
      .catch((err) => setError("读取冲突列表失败: " + err.message));
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
      .catch((err) => setError("保存冲突决策失败: " + err.message));
  }

  function applyBaseline() {
    if (!baselinePreview?.runId) return;
    if (!window.confirm("确定按当前预分析结果生成基准数据集项目吗？")) return;
    setBaselineBusy(true);
    fetch(`/api/baselines/${baselinePreview.runId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: baselineName }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "应用基准失败");
        setShowBaselineDialog(false);
        setBaselinePreview(null);
        refreshHome();
        window.alert(`基准项目已生成：${data.project?.name || baselineName}，图片 ${data.imageCount}，标注 ${data.annotationCount}`);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBaselineBusy(false));
  }

  function deleteProject(projectId) {
    if (!window.confirm("删除后会进入回收站，是否继续？")) return;
    fetch(`/api/projects/${projectId}`, { method: "DELETE" }).then(() => refreshHome());
  }

  function restoreProject(projectId) {
    fetch(`/api/projects/${projectId}/restore`, { method: "POST" }).then(() => refreshHome());
  }

  function emptyProjectTrash() {
    if (!trashProjects.length) return;
    if (!window.confirm(`确定清空项目回收站吗？将永久删除 ${trashProjects.length} 个项目及其不再被引用的数据。`)) return;
    fetch("/api/projects/trash/empty", { method: "DELETE" })
      .then(() => refreshHome())
      .catch((err) => setError("清空项目回收站失败: " + err.message));
  }

  function openProject(project) {
    setActiveProject(project);
    setView("workspace");
    setPage(1);
    setSelected(null);
    setError(null);
  }

  function importData() {
    if (!activeProject) return;
    setImportPath("");
    setError(null);
    setShowImportDialog(true);
  }

  async function browseFolder() {
    setError(null);
    if (appConfig.nativeDialogMode === "disabled") {
      openDataRootPicker(importPath || appConfig.browseRootDisplay || "/");
      return;
    }
    setBrowseBusy(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 120000);
    const dialogBase = String(appConfig.hostDialogUrl || "").replace(/\/$/, "");
    const dialogUrl = dialogBase ? `${dialogBase}/api/dialog/folder` : "/api/dialog/folder?purpose=import";
    try {
      const response = await fetch(dialogUrl, { signal: controller.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "系统文件夹选择器不可用");
      if (result.status === "selected" && result.selectedPath) {
        setImportPath(result.selectedPath);
      } else if (result.status !== "cancelled") {
        throw new Error(result.error || "系统文件夹选择器不可用");
      }
    } catch (err) {
      const reason = err.name === "AbortError" ? "打开超时" : err.message;
      openDataRootPicker(importPath || appConfig.browseRootDisplay || "/");
      setError(`系统文件夹选择器失败，已切换到网页选择器：${reason}`);
    } finally {
      window.clearTimeout(timer);
      setBrowseBusy(false);
    }
  }

  function openDataRootPicker(pathValue) {
    setError(null);
    setDirPickerBusy(true);
    fetch(`/api/fs/dirs?path=${encodeURIComponent(pathValue || appConfig.browseRootDisplay || appConfig.dataRootDisplay || appConfig.dataRoot)}`)
      .then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || "读取目录失败");
        setDirPicker(d);
      }))
      .catch((err) => setError(`读取数据根目录失败: ${err.message}`))
      .finally(() => setDirPickerBusy(false));
  }

  function chooseDir(pathValue) {
    setImportPath(pathValue);
    setDirPicker(null);
    setError(null);
  }

  function confirmImport() {
    const p = importPath.trim();
    if (!p) {
      setError("请输入或选择数据文件夹路径");
      return;
    }
    setError(null);
    setShowImportDialog(false);
    setLatestImport({ status: "running", message: "正在提交导入任务...", progress: 1, processed_files: 0, total_files: 1 });
    fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: activeProject.id, sourcePath: p, rename: true }),
    })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, d]) => {
        if (status >= 400) throw new Error(d.error || "导入失败，请检查路径是否正确");
        setLatestImport(d.batch || null);
        loadWorkspace(activeProject.id);
      })
      .catch((err) => {
        setError(err.message);
        setLatestImport(null);
      });
  }

  function cancelLatestImport() {
    if (!latestImport?.id) return;
    if (!window.confirm("确定取消当前导入任务吗？已经导入的文件会保留在本次导入记录中，可稍后删除本次导入。")) return;
    fetch(`/api/imports/${latestImport.id}/cancel`, { method: "POST" })
      .then((r) => r.json())
      .then(() => setLatestImport({ ...latestImport, status: "cancel_requested", message: "正在取消导入" }))
      .catch((err) => setError("取消导入失败: " + err.message));
  }

  function deleteImport(importId) {
    if (!window.confirm("删除本次导入后会进入导入回收站，是否继续？")) return;
    fetch(`/api/imports/${importId}`, { method: "DELETE" }).then(() => activeProject && loadWorkspace(activeProject.id));
  }

  function restoreImport(importId) {
    fetch(`/api/imports/${importId}/restore`, { method: "POST" }).then(() => activeProject && loadWorkspace(activeProject.id));
  }

  function emptyImportTrash() {
    if (!activeProject || !trashImports.length) return;
    if (!window.confirm(`确定清空导入回收站吗？将永久删除 ${trashImports.length} 条导入记录及其不再被引用的数据。`)) return;
    fetch(`/api/projects/${activeProject.id}/imports/trash/empty`, { method: "DELETE" })
      .then(() => loadWorkspace(activeProject.id))
      .catch((err) => setError("清空导入回收站失败: " + err.message));
  }

  function exportProject() {
    if (!activeProject) return;
    setError(null);
    fetch(`/api/projects/${activeProject.id}/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then((r) => r.json().then((data) => {
        if (!r.ok) throw new Error(data.error || "导出失败");
        return data;
      }))
      .catch((err) => setError("导出失败: " + err.message));
  }

  function deleteCheckedImages() {
    if (!activeProject || !checkedIds.length) return;
    if (!window.confirm(`确定删除选中的 ${checkedIds.length} 张图片吗？删除后不会物理删除对象存储中的原图，只会从当前项目预览中移除。`)) return;
    fetch(`/api/projects/${activeProject.id}/images/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: checkedIds }),
    })
      .then((r) => r.json())
      .then((d) => {
        setCheckedIds([]);
        setError(`已删除 ${d.deleted || 0} 张图片`);
        loadWorkspace(activeProject.id);
      })
      .catch((err) => setError("删除图片失败: " + err.message));
  }

  const goHome = () => {
    setView("home");
    setActiveProject(null);
    setError(null);
    refreshHome();
  };

  if (view === "home") {
    return (
      <div className="app-shell">
        <MainNav view={view} goHome={goHome} openPlatform={openPlatform} />
        <header className="app-header">
          <div>
            <h1>数据集管理</h1>
            <p>项目文件夹、回收站、PostgreSQL + MinIO 资产管理</p>
          </div>
          <button className="primary" onClick={createProject}><FolderOpen size={16} />新建项目</button>
          <button className="warning" onClick={openBaselineDialog}><Boxes size={16} />生成基准数据集</button>
        </header>
        <main className="home-page">
          <section className="home-section">
            <h2>历史项目</h2>
            <div className="project-grid">
              {projects.map((project) => (
                <article className="project-folder" key={project.id} onDoubleClick={() => openProject(project)}>
                  <Folder size={34} />
                  <div>
                    <h3>{project.name}</h3>
                    <p>{project.image_count || 0} 图片 · {project.video_count || 0} 视频</p>
                    <span>{project.last_import_at ? new Date(project.last_import_at).toLocaleString() : "暂无导入"}</span>
                  </div>
                  <button title="删除项目" onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>
                </article>
              ))}
              {!projects.length && <div className="empty-state">还没有项目，点击右上角新建项目。</div>}
            </div>
          </section>
          <section className="home-section">
            <div className="section-title-row">
              <h2>项目回收站</h2>
              <button disabled={!trashProjects.length} onClick={emptyProjectTrash}>清空回收站</button>
            </div>
            <div className="trash-list">
              {trashProjects.map((project) => (
                <div className="trash-row" key={project.id}>
                  <span>{project.name}</span>
                  <button onClick={() => restoreProject(project.id)}><RotateCcw size={14} />恢复</button>
                </div>
              ))}
              {!trashProjects.length && <div className="muted">回收站为空</div>}
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (view === "training" || view === "inference" || view === "models") {
    return (
      <PlatformPage
        view={view}
        setView={setView}
        projects={projects}
        mlModels={mlModels}
        modelVersions={modelVersions}
        trainingJobs={trainingJobs}
        inferenceJobs={inferenceJobs}
        trainingTemplates={trainingTemplates}
        pythonEnvs={pythonEnvs}
        activeTrainingJobId={activeTrainingJobId}
        setActiveTrainingJobId={setActiveTrainingJobId}
        trainingLogs={trainingLogs}
        requeueTrainingJob={requeueTrainingJob}
        modelForm={modelForm}
        setModelForm={setModelForm}
        trainingForm={trainingForm}
        setTrainingForm={setTrainingForm}
        inferenceForm={inferenceForm}
        setInferenceForm={setInferenceForm}
        versionForm={versionForm}
        setVersionForm={setVersionForm}
        templateForm={templateForm}
        setTemplateForm={setTemplateForm}
        envForm={envForm}
        setEnvForm={setEnvForm}
        createModel={createModel}
        createModelVersion={createModelVersion}
        createTrainingTemplate={createTrainingTemplate}
        createPythonEnv={createPythonEnv}
        renameModelVersion={renameModelVersion}
        submitTrainingJob={submitTrainingJob}
        submitInferenceJob={submitInferenceJob}
        error={error}
        setError={setError}
        openPlatform={openPlatform}
      />
    );
  }

  return (
    <div className="app-shell">
      <MainNav view="home" goHome={goHome} openPlatform={openPlatform} />
      <header className="app-header">
        <button className="ghost" onClick={goHome}><ArrowLeft size={16} />返回项目</button>
        <div>
          <h1>{activeProject?.name}</h1>
          <p>{summary?.image_count || 0} 图片 · {summary?.video_count || 0} 视频 · {summary?.annotation_count || 0} 标注</p>
        </div>
        <button className="primary" onClick={importData}><Import size={16} />导入数据</button>
        <button className="warning" onClick={exportProject}><Upload size={16} />导出数据集</button>
      </header>
      <div className="workspace-layout">
        <FilterPanel summary={summary} filters={filters} setFilters={(next) => { setFilters(next); setPage(1); }} imports={imports} />
        <main className="preview-area">
          <ProgressStrip latestImport={latestImport} jobs={jobs} error={error} onCloseError={() => setError(null)} onCancelImport={cancelLatestImport} />
          <ImageGrid
            items={items}
            selected={selected}
            setSelected={setSelected}
            page={page}
            setPage={setPage}
            openViewer={(item) => setViewerIndex(items.findIndex((x) => x.id === item.id))}
            checkedIds={checkedIds}
            setCheckedIds={setCheckedIds}
            lastCheckedId={lastCheckedId}
            setLastCheckedId={setLastCheckedId}
            deleteCheckedImages={deleteCheckedImages}
          />
          <ImportRecords imports={imports} trashImports={trashImports} deleteImport={deleteImport} restoreImport={restoreImport} emptyImportTrash={emptyImportTrash} />
        </main>
        <Inspector item={selected} />
      </div>
      {showImportDialog && (
        <div className="overlay" onClick={() => setShowImportDialog(false)}>
          <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>导入数据</h2>
            <p className="muted">输入或选择要导入的数据文件夹路径（浏览根目录：{appConfig.browseRootDisplay || appConfig.dataRootDisplay || appConfig.dataRoot}）</p>
            <div className="import-path-row">
              <input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="例如: /home/barry/图片/最新统计/统计用/山地" />
              <button onClick={browseFolder} disabled={browseBusy}>{browseBusy ? "正在打开..." : "浏览"}</button>
            </div>
            {error && <div className="error-msg">{error}</div>}
            <div className="dialog-actions">
              <button onClick={() => { setShowImportDialog(false); setError(null); }}>取消</button>
              <button className="primary" onClick={confirmImport}>开始导入</button>
            </div>
          </div>
        </div>
      )}
      {dirPicker && (
        <div className="overlay" onClick={() => setDirPicker(null)}>
          <div className="dir-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="section-title-row">
              <h2>选择数据文件夹</h2>
              <button onClick={() => setDirPicker(null)}><X size={14} /></button>
            </div>
            <div className="dir-current">{dirPicker.current}</div>
            <div className="dir-actions">
              <button onClick={() => openDataRootPicker(dirPicker.parent)} disabled={!dirPicker.parent || dirPickerBusy}><ArrowLeft size={14} />上一级</button>
              <button className="primary" onClick={() => chooseDir(dirPicker.current)} disabled={dirPickerBusy}><FolderOpen size={14} />选择当前文件夹</button>
            </div>
            {error && <div className="error-msg">{error}</div>}
            <div className="dir-list">
              {dirPicker.dirs.map((dir) => (
                <button key={dir.path} onClick={() => openDataRootPicker(dir.path)} disabled={dirPickerBusy}>
                  <Folder size={15} />
                  <span>{dir.name}</span>
                </button>
              ))}
              {!dirPicker.dirs.length && <div className="muted">当前目录下没有子文件夹</div>}
            </div>
          </div>
        </div>
      )}
      {showBaselineDialog && (
        <div className="overlay" onClick={() => setShowBaselineDialog(false)}>
          <div className="baseline-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="section-title-row">
              <h2>生成基准数据集</h2>
              <button onClick={() => setShowBaselineDialog(false)}><X size={14} /></button>
            </div>
            <label>基准项目名称<input value={baselineName} onChange={(e) => setBaselineName(e.target.value)} /></label>
            <div className="baseline-layout">
              <section>
                <h3>来源项目</h3>
                <div className="baseline-source-list">
                  {projects.map((project) => (
                    <label key={project.id} className="check-row">
                      <input type="checkbox" checked={baselineSources.includes(project.id)} onChange={() => toggleBaselineSource(project.id)} />
                      <span>{project.name} · {project.image_count || 0} 图</span>
                    </label>
                  ))}
                </div>
              </section>
              <section>
                <h3>批量规则参数</h3>
                <label>一致 IoU 阈值<input type="number" step="0.01" min="0" max="1" value={baselineParams.iouSame} onChange={(e) => setBaselineParams({ ...baselineParams, iouSame: Number(e.target.value) })} /></label>
                <label>轻微冲突 IoU 阈值<input type="number" step="0.01" min="0" max="1" value={baselineParams.iouLight} onChange={(e) => setBaselineParams({ ...baselineParams, iouLight: Number(e.target.value) })} /></label>
                <p className="muted">来源优先级按勾选顺序处理；当前第一版按来源优先级保留冲突标注，并打印冲突统计。</p>
              </section>
            </div>
            <div className="dialog-actions">
              <button disabled={baselineBusy} onClick={previewBaseline}>预分析</button>
              <button className="primary" disabled={baselineBusy || !baselinePreview} onClick={applyBaseline}>应用并生成基准项目</button>
            </div>
            {baselinePreview && (
              <section className="baseline-report">
                <h3>合并情况</h3>
                <div className="baseline-stats">
                  <span>来源项目 <b>{baselinePreview.summary.source_projects}</b></span>
                  <span>来源图片 <b>{baselinePreview.summary.source_images}</b></span>
                  <span>去重后图片 <b>{baselinePreview.summary.unique_images}</b></span>
                  <span>自动一致 <b>{baselinePreview.summary.auto_resolved}</b></span>
                  <span>冲突图片 <b>{baselinePreview.summary.conflicts}</b></span>
                  <span>预计保留标注 <b>{baselinePreview.summary.annotations_kept}</b></span>
                </div>
                <pre>{JSON.stringify(baselinePreview.summary.by_type || {}, null, 2)}</pre>
                <div className="merge-log">
                  {(baselinePreview.logs || []).slice(0, 80).map((line, index) => <p key={index}>{line}</p>)}
                </div>
                <ConflictReview
                  conflicts={baselineConflicts}
                  activeId={activeConflictId}
                  setActiveId={setActiveConflictId}
                  selectedIds={selectedConflictIds}
                  toggleSelected={toggleConflict}
                  resolveSelected={resolveSelectedConflicts}
                />
              </section>
            )}
            {error && <div className="error-msg">{error}</div>}
          </div>
        </div>
      )}
      {viewerIndex != null && items[viewerIndex] && (
        <ImageViewer
          items={items}
          index={viewerIndex}
          setIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onSaved={(imageId, annotations) => {
            setItems((rows) => rows.map((row) => row.id === imageId ? { ...row, annotations, annotation_count: annotations.length } : row));
            setSelected((row) => row?.id === imageId ? { ...row, annotations, annotation_count: annotations.length } : row);
          }}
        />
      )}
    </div>
  );
}

function PlatformPage({
  view,
  setView,
  projects,
  mlModels,
  modelVersions,
  trainingJobs,
  inferenceJobs,
  trainingTemplates,
  pythonEnvs,
  activeTrainingJobId,
  setActiveTrainingJobId,
  trainingLogs,
  requeueTrainingJob,
  modelForm,
  setModelForm,
  trainingForm,
  setTrainingForm,
  inferenceForm,
  setInferenceForm,
  versionForm,
  setVersionForm,
  templateForm,
  setTemplateForm,
  envForm,
  setEnvForm,
  createModel,
  createModelVersion,
  createTrainingTemplate,
  createPythonEnv,
  renameModelVersion,
  submitTrainingJob,
  submitInferenceJob,
  error,
  setError,
  openPlatform,
}) {
  const title = view === "training" ? "训练平台" : view === "inference" ? "推理平台" : "模型管理";
  const selectedTemplate = trainingTemplates.find((tpl) => tpl.id === trainingForm.templateId);
  const supportedTasks = selectedTemplate?.capabilities_json?.tasks || ["detect", "segment", "classify"];
  return (
    <div className="app-shell">
      <MainNav view={view} goHome={() => { setView("home"); setError(null); }} openPlatform={openPlatform} />
      <header className="app-header">
        <div>
          <h1>{title}</h1>
          <p>借鉴 Run / Artifact / Model Version / Queue 的平台化管理方式</p>
        </div>
      </header>
      <main className="platform-page">
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>&times;</button></div>}
        {view === "training" && (
          <div className="platform-grid">
            <section className="platform-card">
              <h2>提交训练任务</h2>
              <label>任务名<input value={trainingForm.name} onChange={(e) => setTrainingForm({ ...trainingForm, name: e.target.value })} placeholder="留空则自动命名" /></label>
              <label>数据集项目<select value={trainingForm.datasetProjectId} onChange={(e) => setTrainingForm({ ...trainingForm, datasetProjectId: e.target.value })}>
                <option value="">请选择</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select></label>
              <label>模型族<select value={trainingForm.modelId} onChange={(e) => setTrainingForm({ ...trainingForm, modelId: e.target.value })}>
                <option value="">暂不绑定模型族</option>
                {mlModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select></label>
              <label>初始化模型版本<select value={trainingForm.initialModelVersionId} onChange={(e) => setTrainingForm({ ...trainingForm, initialModelVersionId: e.target.value })}>
                <option value="">使用 YOLO 默认权重</option>
                {modelVersions.map((version) => <option key={version.id} value={version.id}>{version.model_name} / {version.version_name}</option>)}
              </select></label>
              <label>训练模板<select value={trainingForm.templateId} onChange={(e) => {
                const tpl = trainingTemplates.find((item) => item.id === e.target.value);
                const tasks = tpl?.capabilities_json?.tasks || ["detect", "segment", "classify"];
                setTrainingForm({ ...trainingForm, templateId: e.target.value, taskType: tasks.includes(trainingForm.taskType) ? trainingForm.taskType : tasks[0] || "detect" });
              }}>
                <option value="">默认 Ultralytics YOLO Detect</option>
                {trainingTemplates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
              </select></label>
              <label>任务类型<select value={trainingForm.taskType} onChange={(e) => setTrainingForm({ ...trainingForm, taskType: e.target.value })}>
                {supportedTasks.map((task) => <option key={task} value={task}>{task === "detect" ? "目标检测" : task === "segment" ? "实例分割" : "图像分类"}</option>)}
              </select></label>
              <label>运行环境<select value={trainingForm.pythonEnvId} onChange={(e) => {
                const env = pythonEnvs.find((item) => item.id === e.target.value);
                setTrainingForm({ ...trainingForm, pythonEnvId: e.target.value, python: env?.python_path || trainingForm.python });
              }}>
                <option value="">手动指定 Python</option>
                {pythonEnvs.map((env) => <option key={env.id} value={env.id}>{env.name} · {env.os_type}/{env.arch} · {env.accelerator?.toUpperCase()} · {env.status}</option>)}
              </select></label>
              {!trainingForm.pythonEnvId && <label>Python 解释器<input value={trainingForm.python} onChange={(e) => setTrainingForm({ ...trainingForm, python: e.target.value })} placeholder="python 或 D:\ProgramData\miniforge3\python.exe" /></label>}
              <div className="form-row">
                <label>Epochs<input type="number" value={trainingForm.epochs} onChange={(e) => setTrainingForm({ ...trainingForm, epochs: e.target.value })} /></label>
                <label>ImgSz<input type="number" value={trainingForm.imgsz} onChange={(e) => setTrainingForm({ ...trainingForm, imgsz: e.target.value })} /></label>
              </div>
              <div className="form-row">
                <label>Batch<input type="number" value={trainingForm.batch} onChange={(e) => setTrainingForm({ ...trainingForm, batch: e.target.value })} /></label>
                <label>Device<input value={trainingForm.device} onChange={(e) => setTrainingForm({ ...trainingForm, device: e.target.value })} /></label>
              </div>
              <button className="primary" onClick={submitTrainingJob}>提交到训练队列</button>
            </section>
            <section className="platform-card wide">
              <JobList title="训练队列" jobs={trainingJobs} kind="training" activeId={activeTrainingJobId} setActiveId={setActiveTrainingJobId} onRequeue={requeueTrainingJob} bare />
              <TrainingLogPanel logs={trainingLogs} />
            </section>
          </div>
        )}
        {view === "inference" && (
          <div className="platform-grid">
            <section className="platform-card">
              <h2>提交推理任务</h2>
              <label>任务名<input value={inferenceForm.name} onChange={(e) => setInferenceForm({ ...inferenceForm, name: e.target.value })} placeholder="留空则自动命名" /></label>
              <label>数据集项目<select value={inferenceForm.datasetProjectId} onChange={(e) => setInferenceForm({ ...inferenceForm, datasetProjectId: e.target.value })}>
                <option value="">请选择</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select></label>
              <label>模型版本<select value={inferenceForm.modelVersionId} onChange={(e) => setInferenceForm({ ...inferenceForm, modelVersionId: e.target.value })}>
                <option value="">暂不指定版本</option>
                {modelVersions.map((version) => <option key={version.id} value={version.id}>{version.model_name} / {version.version_name}</option>)}
              </select></label>
              <div className="form-row">
                <label>Conf<input type="number" step="0.01" value={inferenceForm.conf} onChange={(e) => setInferenceForm({ ...inferenceForm, conf: e.target.value })} /></label>
                <label>IoU<input type="number" step="0.01" value={inferenceForm.iou} onChange={(e) => setInferenceForm({ ...inferenceForm, iou: e.target.value })} /></label>
              </div>
              <label>ImgSz<input type="number" value={inferenceForm.imgsz} onChange={(e) => setInferenceForm({ ...inferenceForm, imgsz: e.target.value })} /></label>
              <button className="primary" onClick={submitInferenceJob}>提交到推理队列</button>
            </section>
            <JobList title="推理队列" jobs={inferenceJobs} kind="inference" />
          </div>
        )}
        {view === "models" && (
          <div className="platform-grid">
            <section className="platform-card">
              <h2>登记模型族</h2>
              <label>模型名<input value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} placeholder="例如 yolo_vehicle_detect" /></label>
              <label>任务类型<select value={modelForm.taskType} onChange={(e) => setModelForm({ ...modelForm, taskType: e.target.value })}>
                <option value="detect">目标检测</option>
                <option value="segment">实例分割</option>
                <option value="classify">分类</option>
              </select></label>
              <label>框架<select value={modelForm.framework} onChange={(e) => setModelForm({ ...modelForm, framework: e.target.value })}>
                <option value="ultralytics">Ultralytics</option>
                <option value="pytorch">PyTorch</option>
                <option value="custom">Custom</option>
              </select></label>
              <label>说明<textarea value={modelForm.description} onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })} /></label>
              <button className="primary" onClick={createModel}>创建模型族</button>
              <h2>登记初始化权重</h2>
              <label>模型族<select value={versionForm.modelId} onChange={(e) => setVersionForm({ ...versionForm, modelId: e.target.value })}>
                <option value="">请选择</option>
                {mlModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select></label>
              <label>版本名<input value={versionForm.versionName} onChange={(e) => setVersionForm({ ...versionForm, versionName: e.target.value })} placeholder="留空自动命名，例如 pretrain_模型名_日期_001" /></label>
              <label>权重文件路径<input value={versionForm.sourcePath} onChange={(e) => setVersionForm({ ...versionForm, sourcePath: e.target.value })} placeholder="例如 F:\models\best.pt" /></label>
              <button className="primary" onClick={createModelVersion}>登记权重版本</button>
              <h2>训练模板</h2>
              <label>模板名<input value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} placeholder="例如 YOLOv8 检测训练" /></label>
              <label>模板类型<select value={templateForm.templateKey} onChange={(e) => setTemplateForm({ ...templateForm, templateKey: e.target.value })}>
                <option value="ultralytics_yolo">Ultralytics YOLO</option>
                <option value="custom_command">自定义命令</option>
              </select></label>
              <div className="check-list compact">
                {["detect", "segment", "classify"].map((task) => (
                  <label className="check-row" key={task}>
                    <input type="checkbox" checked={templateForm.tasks.includes(task)} onChange={() => {
                      const tasks = templateForm.tasks.includes(task) ? templateForm.tasks.filter((item) => item !== task) : [...templateForm.tasks, task];
                      setTemplateForm({ ...templateForm, tasks });
                    }} />
                    <span>{task === "detect" ? "目标检测" : task === "segment" ? "实例分割" : "图像分类"}</span>
                  </label>
                ))}
              </div>
              <label>说明<textarea value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} /></label>
              <button onClick={createTrainingTemplate}>创建训练模板</button>
              <h2>运行环境</h2>
              <label>环境名<input value={envForm.name} onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })} placeholder="例如 miniforge-ultralytics" /></label>
              <label>运行方式<select value={envForm.envType} onChange={(e) => setEnvForm({ ...envForm, envType: e.target.value })}>
                <option value="miniforge">Miniforge</option>
                <option value="conda">Conda</option>
              </select></label>
              <label>平台分类<select value={`${envForm.osType}:${envForm.arch}`} onChange={(e) => {
                const [osType, arch] = e.target.value.split(":");
                setEnvForm({ ...envForm, osType, arch });
              }}>
                <option value="windows:x86_64">Windows x86_64</option>
                <option value="linux:x86_64">Linux x86_64</option>
                <option value="linux:arm64">Linux ARM64</option>
              </select></label>
              <label>加速能力<select value={envForm.accelerator} onChange={(e) => setEnvForm({ ...envForm, accelerator: e.target.value })}>
                <option value="cpu">CPU</option>
                <option value="cuda">CUDA</option>
              </select></label>
              <label>Python 路径<input value={envForm.pythonPath} onChange={(e) => setEnvForm({ ...envForm, pythonPath: e.target.value })} placeholder="D:\ProgramData\miniforge3\python.exe" /></label>
              <button onClick={createPythonEnv}>登记运行环境</button>
            </section>
            <section className="platform-card wide">
              <h2>模型列表</h2>
              <div className="model-list">
                {mlModels.map((model) => (
                  <article className="model-row" key={model.id}>
                    <div><b>{model.name}</b><span>{model.framework} · {model.task_type}</span></div>
                    <em>{model.version_count || 0} 个版本</em>
                  </article>
                ))}
                {!mlModels.length && <div className="empty-state">还没有模型族。</div>}
              </div>
              <h2>模型版本</h2>
              <div className="model-list">
                {modelVersions.map((version) => (
                  <article className="model-row" key={version.id}>
                    <div>
                      <b>{version.model_name} / {version.version_name}</b>
                      <span>{version.stage} · {version.dataset_project_name || "未绑定数据集"} · {new Date(version.created_at).toLocaleString()}</span>
                    </div>
                    <div className="model-actions">
                      <button onClick={() => renameModelVersion(version)}>重命名</button>
                      <a className="download-link" href={`/api/ml/model-versions/${version.id}/download`}>下载 best.pt</a>
                    </div>
                  </article>
                ))}
                {!modelVersions.length && <div className="empty-state">还没有模型版本。</div>}
              </div>
              <h2>训练模板</h2>
              <div className="model-list">
                {trainingTemplates.map((tpl) => (
                  <article className="model-row" key={tpl.id}>
                    <div><b>{tpl.name}</b><span>{tpl.framework} · {(tpl.capabilities_json?.tasks || [tpl.task_type]).join(" / ")} · {tpl.template_key}</span></div>
                  </article>
                ))}
                {!trainingTemplates.length && <div className="empty-state">还没有训练模板。</div>}
              </div>
              <h2>运行环境</h2>
              <div className="model-list">
                {pythonEnvs.map((env) => (
                  <article className="model-row" key={env.id}>
                    <div>
                      <b>{env.name}</b>
                      <span>{env.os_type} {env.arch} · {env.env_type} · {env.accelerator?.toUpperCase()} · {env.status}</span>
                      <span>{env.python_version || "未知 Python"} · Torch {env.torch_version || "未检测"} · {env.cuda_available ? `CUDA ${env.cuda_version || ""}` : "CPU only"}</span>
                      <span>{env.python_path}</span>
                    </div>
                  </article>
                ))}
                {!pythonEnvs.length && <div className="empty-state">还没有运行环境。</div>}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function MainNav({ view, goHome, openPlatform }) {
  return (
    <nav className="main-nav">
      <div className="brand-mark">
        <Boxes size={18} />
        <span>209所AI集成化平台</span>
      </div>
      <button className={view === "home" ? "active" : ""} onClick={goHome}><FolderOpen size={16} />数据集管理</button>
      <button className={view === "training" ? "active" : ""} onClick={() => openPlatform("training")}><Play size={16} />训练平台</button>
      <button className={view === "inference" ? "active" : ""} onClick={() => openPlatform("inference")}><Cpu size={16} />推理平台</button>
      <button className={view === "models" ? "active" : ""} onClick={() => openPlatform("models")}><Brain size={16} />模型管理</button>
    </nav>
  );
}

function JobList({ title, jobs, kind, activeId, setActiveId, onRequeue, bare = false }) {
  const Tag = bare ? "div" : "section";
  return (
    <Tag className={bare ? "job-panel" : "platform-card wide job-panel"}>
      <h2>{title}</h2>
      <div className="job-list">
        {jobs.map((job) => (
          <article className={`job-row ${activeId === job.id ? "active" : ""}`} key={job.id} onClick={() => setActiveId?.(job.id)}>
            <div>
              <b>{job.name}</b>
              <span>{job.dataset_project_name || "未绑定数据集"} · {kind === "training" ? (job.model_name || "未绑定模型") : (job.model_name ? `${job.model_name}/${job.version_name || "版本"}` : "未指定模型版本")}</span>
              <small>{job.message || job.status}</small>
            </div>
            <div className="job-status">
              <strong>{job.status}</strong>
              <progress value={job.progress || 0} max="100" />
              <em>{new Date(job.created_at).toLocaleString()}</em>
              {onRequeue && !["pending", "preparing", "running"].includes(job.status) && (
                <button onClick={(event) => { event.stopPropagation(); onRequeue(job.id); }}>重新入队</button>
              )}
            </div>
          </article>
        ))}
        {!jobs.length && <div className="empty-state">队列为空。</div>}
      </div>
    </Tag>
  );
}

function TrainingLogPanel({ logs }) {
  return (
    <section className="log-panel">
      <h2>训练日志</h2>
      <div className="log-box">
        {logs.map((log) => <p key={log.id}><span>{log.stream}</span>{log.line}</p>)}
        {!logs.length && <div className="muted">选择一个训练任务后查看日志。</div>}
      </div>
    </section>
  );
}

function optionList(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function FilterPanel({ summary, filters, setFilters, imports }) {
  const set = (key, value) => setFilters({ ...filters, [key]: value });
  const toggle = (key, value) => {
    const current = filters[key] || [];
    set(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };
  const clear = () => setFilters({ q: "", scenes: [], views: [], modalities: [], labels: [], importBatchIds: [] });
  return (
    <aside className="filter-panel">
      <h2>筛选条件</h2>
      <label>搜索<input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="文件名 / 场景 / 类别" /></label>
      <MultiFilter title="场景" values={optionList(summary?.scenes)} selected={filters.scenes} onToggle={(value) => toggle("scenes", value)} />
      <MultiFilter title="视角" values={optionList(summary?.views)} selected={filters.views} onToggle={(value) => toggle("views", value)} />
      <MultiFilter title="模态" values={[["infrared", "IR"], ["visible", "RGB"]]} selected={filters.modalities} onToggle={(value) => toggle("modalities", value)} />
      <MultiFilter title="类别" values={optionList(summary?.labels)} selected={filters.labels} onToggle={(value) => toggle("labels", value)} />
      <MultiFilter title="导入批次" values={imports.map((x) => [x.id, new Date(x.created_at).toLocaleString()])} selected={filters.importBatchIds} onToggle={(value) => toggle("importBatchIds", value)} />
      <button className="clear-filters" onClick={clear}>清空筛选</button>
    </aside>
  );
}

function MultiFilter({ title, values, selected = [], onToggle }) {
  const normalized = values.map((item) => Array.isArray(item) ? item : [item, item]);
  return (
    <section className="filter-group">
      <div className="filter-title"><span>{title}</span><em>{selected.length ? `${selected.length} 已选` : "全部"}</em></div>
      <div className="check-list">
        {normalized.map(([value, label]) => (
          <label className="check-row" key={value}>
            <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
            <span>{label}</span>
          </label>
        ))}
        {!normalized.length && <div className="muted">暂无选项</div>}
      </div>
    </section>
  );
}

function ProgressStrip({ latestImport, jobs, error, onCloseError, onCancelImport }) {
  const latestExport = jobs.find((job) => job.type === "export");
  const canCancelImport = latestImport && ["scanning", "running", "cancel_requested"].includes(latestImport.status);
  return (
    <div className="progress-stack">
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={onCloseError}>&times;</button>
        </div>
      )}
      {latestImport && <ProgressBar title="导入进度" message={latestImport.message || latestImport.status} progress={latestImport.progress || 0} onCancel={canCancelImport ? onCancelImport : null} />}
      {latestExport && <ProgressBar title="导出进度" message={latestExport.message || latestExport.status} progress={latestExport.progress || 0} />}
    </div>
  );
}

function ProgressBar({ title, message, progress, onCancel }) {
  return (
    <div className="progress-card">
      <div><span>{title}</span><b>{message}</b></div>
      <progress value={progress} max="100" />
      <em>{progress}%</em>
      {onCancel && <button className="cancel-progress" onClick={onCancel}>取消</button>}
    </div>
  );
}

function labelColor(label = "") {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}

function AnnotationOverlay({ item, compact = false }) {
  const width = Number(item?.image_width || 1);
  const height = Number(item?.image_height || 1);
  const annotations = item?.annotations || [];
  return (
    <svg className={`ann-layer ${compact ? "compact" : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {annotations.map((ann) => (
        <g key={ann.id}>
          <rect
            x={Number(ann.bbox_x || 0)}
            y={Number(ann.bbox_y || 0)}
            width={Math.max(1, Number(ann.bbox_w || 0))}
            height={Math.max(1, Number(ann.bbox_h || 0))}
            fill="none"
            stroke={labelColor(ann.label)}
            strokeWidth={compact ? Math.max(4, width / 600) : Math.max(3, width / 900)}
          />
          {!compact && (
            <text x={Number(ann.bbox_x || 0)} y={Math.max(14, Number(ann.bbox_y || 0) - 5)} fill={labelColor(ann.label)} fontSize={Math.max(20, width / 90)}>{ann.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function ImageGrid({ items, selected, setSelected, page, setPage, openViewer, checkedIds, setCheckedIds, lastCheckedId, setLastCheckedId, deleteCheckedImages }) {
  const allChecked = items.length > 0 && items.every((item) => checkedIds.includes(item.id));
  const toggleItem = (event, id) => {
    event.stopPropagation();
    const pageIds = items.map((item) => item.id);
    const currentIndex = pageIds.indexOf(id);
    const previousIndex = pageIds.indexOf(lastCheckedId);
    const shouldCheck = !checkedIds.includes(id);
    setCheckedIds((ids) => {
      if (event.shiftKey && previousIndex >= 0 && currentIndex >= 0) {
        const [start, end] = previousIndex < currentIndex ? [previousIndex, currentIndex] : [currentIndex, previousIndex];
        const range = pageIds.slice(start, end + 1);
        return shouldCheck ? Array.from(new Set([...ids, ...range])) : ids.filter((item) => !range.includes(item));
      }
      return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
    });
    setLastCheckedId(id);
  };
  const togglePage = () => setCheckedIds((ids) => {
    const pageIds = items.map((item) => item.id);
    if (pageIds.every((id) => ids.includes(id))) return ids.filter((id) => !pageIds.includes(id));
    return Array.from(new Set([...ids, ...pageIds]));
  });
  return (
    <section className="preview-panel">
      <div className="preview-head">
        <div><h2>预览结果</h2><p>直接显示当前筛选后的缩略图</p></div>
        <div className="bulk-actions">
          <label><input type="checkbox" checked={allChecked} onChange={togglePage} />本页全选</label>
          <span>{checkedIds.length} 已选</span>
          <button disabled={!checkedIds.length} onClick={deleteCheckedImages}>删除选中</button>
        </div>
      </div>
      <div className="asset-grid">
        {items.map((item) => (
          <button className={`asset-card ${selected?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => setSelected(item)} onDoubleClick={() => openViewer(item)}>
            <span className="select-box">
              <input type="checkbox" checked={checkedIds.includes(item.id)} onClick={(event) => toggleItem(event, item.id)} onChange={() => {}} />
            </span>
            <div className="thumb-wrap" style={{ aspectRatio: `${Number(item.image_width || 16)} / ${Number(item.image_height || 9)}` }}>
              <img src={`/api/project-images/${item.id}/thumb`} loading="lazy" />
              <AnnotationOverlay item={item} compact />
            </div>
            <b>{item.display_name}</b>
            <span>{item.view} · {item.scene} · {item.modality === "infrared" ? "IR" : "RGB"}</span>
            <em>{item.annotation_count || 0} 标注</em>
          </button>
        ))}
        {!items.length && <div className="empty-state">当前筛选条件下没有数据。</div>}
      </div>
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {page} 页</span>
        <button onClick={() => setPage(page + 1)}>下一页</button>
      </div>
    </section>
  );
}

function ImportRecords({ imports, trashImports, deleteImport, restoreImport, emptyImportTrash }) {
  return (
    <section className="records-panel">
      <h2>导入记录</h2>
      {imports.map((item) => (
        <div className="record-row" key={item.id}>
          <div><b>{pathName(item.source_path)}</b><span>{item.message} · {new Date(item.created_at).toLocaleString()}</span></div>
          <button onClick={() => deleteImport(item.id)}><Trash2 size={14} />删除本次导入</button>
        </div>
      ))}
      {!imports.length && <div className="muted">暂无导入记录</div>}
      <div className="section-title-row">
        <h3>导入回收站</h3>
        <button disabled={!trashImports.length} onClick={emptyImportTrash}>清空回收站</button>
      </div>
      {trashImports.map((item) => (
        <div className="record-row deleted" key={item.id}>
          <div><b>{pathName(item.source_path)}</b><span>{item.message}</span></div>
          <button onClick={() => restoreImport(item.id)}><RotateCcw size={14} />恢复</button>
        </div>
      ))}
      {!trashImports.length && <div className="muted">导入回收站为空</div>}
    </section>
  );
}

function pathName(value = "") {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function ConflictReview({ conflicts, activeId, setActiveId, selectedIds, toggleSelected, resolveSelected }) {
  if (!conflicts.length) {
    return <div className="conflict-empty">当前预分析没有发现标注冲突。</div>;
  }
  const active = conflicts.find((item) => item.id === activeId) || conflicts[0];
  const preview = active?.preview_json || {};
  const sources = preview.sources || [];
  return (
    <div className="conflict-review">
      <aside className="conflict-list">
        <div className="section-title-row">
          <h3>冲突图片</h3>
          <span>{selectedIds.length} 已选</span>
        </div>
        {conflicts.map((item, index) => (
          <button key={item.id} className={`conflict-item ${active?.id === item.id ? "active" : ""}`} onClick={() => setActiveId(item.id)}>
            <input type="checkbox" checked={selectedIds.includes(item.id)} onClick={(event) => { event.stopPropagation(); toggleSelected(item.id); }} onChange={() => {}} />
            <b>冲突 {index + 1}</b>
            <span>{item.conflict_type} · {item.severity} · {item.status}</span>
          </button>
        ))}
      </aside>
      <main className="conflict-stage">
        {sources[0]?.image_id ? (
          <img src={`/api/project-images/${sources[0].image_id}/full`} />
        ) : (
          <div className="empty-state">没有可预览图片</div>
        )}
        <div className="merge-log compact">
          {(preview.log || []).map((line, index) => <p key={index}>{line}</p>)}
        </div>
      </main>
      <aside className="conflict-side">
        <h3>来源对比</h3>
        {sources.map((source) => (
          <div className="source-row" key={source.project_id}>
            <div>
              <b>{source.project_name}</b>
              <span>{source.annotations} 标注</span>
            </div>
            <button onClick={() => resolveSelected(`source_project:${source.project_id}`)}>保留该来源</button>
          </div>
        ))}
        <button onClick={() => resolveSelected("pending")}>标记待复核</button>
      </aside>
    </div>
  );
}

function Inspector({ item }) {
  if (!item) {
    return <aside className="inspector-panel"><h2>详情</h2><p className="muted">选择一张图片查看详情。</p></aside>;
  }
  const annotations = item.annotations || [];
  return (
    <aside className="inspector-panel">
      <h2>详情</h2>
      <img className="detail-image" src={`/api/project-images/${item.id}/full`} />
      <div className="kv"><span>文件名</span><b>{item.display_name}</b></div>
      <div className="kv"><span>场景</span><b>{item.scene}</b></div>
      <div className="kv"><span>视角</span><b>{item.view}</b></div>
      <div className="kv"><span>模态</span><b>{item.modality === "infrared" ? "IR" : "RGB"}</b></div>
      <div className="kv"><span>标注数</span><b>{item.annotation_count || 0}</b></div>
      <section className="annotation-list">
        <h3>标注信息</h3>
        {annotations.map((ann) => (
          <div className="annotation-row" key={ann.id}>
            <i style={{ background: labelColor(ann.label) }} />
            <div>
              <b>{ann.label}</b>
              <span>x {Number(ann.bbox_x).toFixed(1)} · y {Number(ann.bbox_y).toFixed(1)} · w {Number(ann.bbox_w).toFixed(1)} · h {Number(ann.bbox_h).toFixed(1)}</span>
            </div>
          </div>
        ))}
        {!annotations.length && <p className="muted">当前筛选下没有标注框。</p>}
      </section>
    </aside>
  );
}

function ImageViewer({ items, index, setIndex, onClose, onSaved }) {
  const item = items[index];
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [tool, setTool] = useState("select");
  const [draft, setDraft] = useState([]);
  const [selectedAnnId, setSelectedAnnId] = useState(null);
  const [editDrag, setEditDrag] = useState(null);
  const [defaultLabel, setDefaultLabel] = useState("");

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setEditMode(false);
    setTool("select");
    setDraft((item?.annotations || []).map((ann) => ({ ...ann })));
    setSelectedAnnId(null);
    setDefaultLabel((item?.annotations || [])[0]?.label || "");
  }, [item?.id]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        if (editMode) setSelectedAnnId(null);
        else onClose();
      }
      if (!editMode && event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (!editMode && event.key === "ArrowRight") setIndex((value) => Math.min(items.length - 1, value + 1));
      if (editMode && (event.key === "Delete" || event.key === "Backspace") && selectedAnnId) {
        setDraft((rows) => rows.filter((ann) => ann.id !== selectedAnnId));
        setSelectedAnnId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode, items.length, onClose, selectedAnnId, setIndex]);

  const zoom = (delta) => setScale((value) => Math.min(6, Math.max(0.25, Number((value + delta).toFixed(2)))));
  const prev = () => setIndex(Math.max(0, index - 1));
  const next = () => setIndex(Math.min(items.length - 1, index + 1));
  const width = Number(item.image_width || 1);
  const height = Number(item.image_height || 1);
  const shownAnnotations = editMode ? draft : item.annotations || [];
  const selectedAnn = draft.find((ann) => ann.id === selectedAnnId);

  const pointFromEvent = (event) => {
    const svg = event.currentTarget.closest(".viewer-image-wrap")?.querySelector("svg");
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width)),
      y: Math.max(0, Math.min(height, ((event.clientY - rect.top) / rect.height) * height)),
    };
  };

  const updateAnn = (id, patch) => setDraft((rows) => rows.map((ann) => ann.id === id ? { ...ann, ...patch } : ann));
  const normalizeBox = (box) => {
    const x1 = Math.max(0, Math.min(width, Math.min(box.x1, box.x2)));
    const y1 = Math.max(0, Math.min(height, Math.min(box.y1, box.y2)));
    const x2 = Math.max(0, Math.min(width, Math.max(box.x1, box.x2)));
    const y2 = Math.max(0, Math.min(height, Math.max(box.y1, box.y2)));
    return { bbox_x: x1, bbox_y: y1, bbox_w: Math.max(1, x2 - x1), bbox_h: Math.max(1, y2 - y1) };
  };

  const save = () => {
    fetch(`/api/project-images/${item.id}/annotations/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotations: draft }),
    })
      .then((r) => r.json())
      .then((data) => {
        const annotations = data.annotations || [];
        setDraft(annotations.map((ann) => ({ ...ann })));
        onSaved?.(item.id, annotations);
        setEditMode(false);
      })
      .catch((error) => window.alert("保存失败: " + error.message));
  };

  return (
    <div className="viewer-overlay" onMouseUp={() => { setDrag(null); setEditDrag(null); }} onMouseLeave={() => { setDrag(null); setEditDrag(null); }}>
      <div className="viewer-topbar">
        <button className={editMode ? "active-tool edit-toggle" : "edit-toggle"} onClick={() => setEditMode((value) => !value)}>{editMode ? "退出编辑" : "编辑"}</button>
        <b>{item.display_name}</b>
        <span>{index + 1} / {items.length}</span>
        {editMode && (
          <>
            <button className={tool === "select" ? "active-tool" : ""} onClick={() => setTool("select")}>选择</button>
            <button className={tool === "draw" ? "active-tool" : ""} onClick={() => setTool("draw")}>画框</button>
            <input className="label-input" value={defaultLabel} onChange={(event) => setDefaultLabel(event.target.value)} placeholder="标签" />
            <button disabled={!selectedAnnId} onClick={() => { setDraft((rows) => rows.filter((ann) => ann.id !== selectedAnnId)); setSelectedAnnId(null); }}>删除框</button>
            <button className="save-ann" onClick={save}>保存</button>
          </>
        )}
        <button onClick={() => zoom(-0.25)}>-</button>
        <button onClick={() => zoom(0.25)}>+</button>
        <button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>重置</button>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <button className="viewer-nav prev" disabled={index <= 0} onClick={prev}>‹</button>
      <button className="viewer-nav next" disabled={index >= items.length - 1} onClick={next}>›</button>
      <div
        className="viewer-stage"
        onWheel={(event) => {
          event.preventDefault();
          zoom(event.deltaY < 0 ? 0.2 : -0.2);
        }}
        onMouseDown={(event) => {
          if (!editMode) setDrag({ x: event.clientX, y: event.clientY, pan });
        }}
        onMouseMove={(event) => {
          if (!drag) return;
          setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });
        }}
      >
        <div className="viewer-image-wrap" style={{ aspectRatio: `${Number(item.image_width || 16)} / ${Number(item.image_height || 9)}`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
          <img src={`/api/project-images/${item.id}/full`} draggable="false" />
          {editMode ? (
            <EditableAnnotationLayer
              width={width}
              height={height}
              annotations={shownAnnotations}
              selectedId={selectedAnnId}
              setSelectedId={setSelectedAnnId}
              tool={tool}
              defaultLabel={defaultLabel}
              setDefaultLabel={setDefaultLabel}
              setDraft={setDraft}
              editDrag={editDrag}
              setEditDrag={setEditDrag}
              updateAnn={updateAnn}
              normalizeBox={normalizeBox}
              pointFromEvent={pointFromEvent}
            />
          ) : (
            <AnnotationOverlay item={{ ...item, annotations: shownAnnotations }} />
          )}
        </div>
      </div>
      {editMode && selectedAnn && (
        <div className="edit-sidecar">
          <label>标签<input value={selectedAnn.label || ""} onChange={(event) => { updateAnn(selectedAnn.id, { label: event.target.value }); setDefaultLabel(event.target.value); }} /></label>
          <span>x {Number(selectedAnn.bbox_x).toFixed(1)} · y {Number(selectedAnn.bbox_y).toFixed(1)}</span>
          <span>w {Number(selectedAnn.bbox_w).toFixed(1)} · h {Number(selectedAnn.bbox_h).toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

function EditableAnnotationLayer({ width, height, annotations, selectedId, setSelectedId, tool, defaultLabel, setDefaultLabel, setDraft, editDrag, setEditDrag, updateAnn, normalizeBox, pointFromEvent }) {
  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const handlePoint = (ann, handle) => {
    const x = Number(ann.bbox_x || 0);
    const y = Number(ann.bbox_y || 0);
    const w = Number(ann.bbox_w || 1);
    const h = Number(ann.bbox_h || 1);
    const xs = { w: x, n: x + w / 2, s: x + w / 2, e: x + w, nw: x, sw: x, ne: x + w, se: x + w };
    const ys = { n: y, w: y + h / 2, e: y + h / 2, s: y + h, nw: y, ne: y, sw: y + h, se: y + h };
    return { x: xs[handle], y: ys[handle] };
  };

  const beginDraw = (event) => {
    if (tool !== "draw") return;
    event.stopPropagation();
    const p = pointFromEvent(event);
    const id = `tmp_${Date.now()}`;
    const label = defaultLabel.trim() || "unknown";
    setDefaultLabel(label);
    setDraft((rows) => [...rows, { id, label, bbox_x: p.x, bbox_y: p.y, bbox_w: 1, bbox_h: 1, shape_type: "rectangle" }]);
    setSelectedId(id);
    setEditDrag({ type: "draw", id, start: p });
  };

  const moveDrag = (event) => {
    if (!editDrag) return;
    event.stopPropagation();
    const p = pointFromEvent(event);
    const ann = annotations.find((item) => item.id === editDrag.id);
    if (!ann) return;
    if (editDrag.type === "draw") {
      updateAnn(editDrag.id, normalizeBox({ x1: editDrag.start.x, y1: editDrag.start.y, x2: p.x, y2: p.y }));
    }
    if (editDrag.type === "move") {
      const dx = p.x - editDrag.start.x;
      const dy = p.y - editDrag.start.y;
      updateAnn(editDrag.id, {
        bbox_x: Math.max(0, Math.min(width - Number(ann.bbox_w), editDrag.origin.x + dx)),
        bbox_y: Math.max(0, Math.min(height - Number(ann.bbox_h), editDrag.origin.y + dy)),
      });
    }
    if (editDrag.type === "resize") {
      const o = editDrag.origin;
      const left = editDrag.handle.includes("w") ? p.x : o.x;
      const right = editDrag.handle.includes("e") ? p.x : o.x + o.w;
      const top = editDrag.handle.includes("n") ? p.y : o.y;
      const bottom = editDrag.handle.includes("s") ? p.y : o.y + o.h;
      updateAnn(editDrag.id, normalizeBox({ x1: left, y1: top, x2: right, y2: bottom }));
    }
  };

  return (
    <svg className="ann-layer editable" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onMouseDown={beginDraw} onMouseMove={moveDrag} onMouseUp={() => setEditDrag(null)}>
      {annotations.map((ann) => {
        const selected = ann.id === selectedId;
        const color = labelColor(ann.label);
        return (
          <g key={ann.id}>
            <rect
              className={selected ? "edit-box selected" : "edit-box"}
              x={Number(ann.bbox_x || 0)}
              y={Number(ann.bbox_y || 0)}
              width={Math.max(1, Number(ann.bbox_w || 0))}
              height={Math.max(1, Number(ann.bbox_h || 0))}
              fill="rgba(0,0,0,0.01)"
              stroke={color}
              strokeWidth={selected ? Math.max(5, width / 550) : Math.max(3, width / 900)}
              onMouseDown={(event) => {
                if (tool !== "select") return;
                event.stopPropagation();
                const p = pointFromEvent(event);
                setSelectedId(ann.id);
                setEditDrag({ type: "move", id: ann.id, start: p, origin: { x: Number(ann.bbox_x), y: Number(ann.bbox_y) } });
              }}
            />
            <text x={Number(ann.bbox_x || 0)} y={Math.max(18, Number(ann.bbox_y || 0) - 6)} fill={color} fontSize={Math.max(22, width / 85)}>{ann.label}</text>
            {selected && handles.map((handle) => {
              const p = handlePoint(ann, handle);
              return (
                <rect
                  key={handle}
                  className={`resize-handle ${handle}`}
                  x={p.x - width / 160}
                  y={p.y - width / 160}
                  width={width / 80}
                  height={width / 80}
                  fill="#fff"
                  stroke={color}
                  strokeWidth={Math.max(2, width / 1200)}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    const start = pointFromEvent(event);
                    setEditDrag({ type: "resize", id: ann.id, handle, start, origin: { x: Number(ann.bbox_x), y: Number(ann.bbox_y), w: Number(ann.bbox_w), h: Number(ann.bbox_h) } });
                  }}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

createRoot(document.getElementById("root")).render(<App />);
