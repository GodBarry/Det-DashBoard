import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  Bell,
  Boxes,
  Brain,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Download,
  Edit3,
  Eye,
  Folder,
  FolderPlus,
  FolderOpen,
  Grid,
  HelpCircle,
  Image as ImageIcon,
  Import,
  List,
  MoreVertical,
  Move,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  Tags,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import "./styles.css";

const colors = ["#31d0aa", "#72a7ff", "#ffcc66", "#ff7c7c", "#b48cff", "#6ee7ff", "#f59bd3", "#a3e635"];

const evaluationClusterLabels = { detect: "目标检测", segment: "实例分割", classify: "图像分类" };
const evaluationTypeLabels = { training: "训练模型", inference: "推理模型" };
const completedEvaluationStatuses = new Set(["done", "completed", "succeeded", "success"]);

function taskLabel(task) {
  if (task === "detect") return "目标检测";
  if (task === "segment") return "实例分割";
  if (task === "classify") return "图像分类";
  return task || "未知任务";
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "--";
}

function formatDuration(start, end) {
  if (!start || !end) return "--";
  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return "--";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function runStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (completedEvaluationStatuses.has(normalized)) return "运行完成";
  if (["pending", "preparing"].includes(normalized)) return "运行待处理";
  if (normalized === "running") return "运行中";
  if (normalized === "failed") return "运行失败";
  if (normalized === "cancelled") return "已取消";
  return status || "未知状态";
}

function App() {
  const [view, setView] = useState("home");
  const [theme, setTheme] = useState("light");
  const [projects, setProjects] = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(null);
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
  const [exportFormat, setExportFormat] = useState("labelme");
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
  const [algorithmAssets, setAlgorithmAssets] = useState([]);
  const [pythonEnvs, setPythonEnvs] = useState([]);
  const [modelForm, setModelForm] = useState({ name: "", taskType: "detect", framework: "ultralytics", description: "" });
  const [trainingForm, setTrainingForm] = useState({ name: "", datasetProjectId: "", modelId: "", initialModelVersionId: "", templateId: "", taskType: "detect", pythonEnvId: "", python: "D:\\ProgramData\\miniforge3\\python.exe", epochs: 100, imgsz: 640, batch: 16, device: "0" });
  const [inferenceForm, setInferenceForm] = useState({
    name: "",
    datasetProjectId: "",
    modelId: "",
    modelVersionId: "",
    templateId: "",
    taskType: "detect",
    pythonEnvId: "",
    conf: 0.25,
    iou: 0.7,
    imgsz: 640,
    batch: 16,
    device: "0",
    inputScope: "project",
    inputScenes: "",
    inputViews: "",
    inputModalities: "",
    inputImportBatchIds: "",
    inputLabels: "",
    inputQuery: "",
    inputLimit: 0,
    cachePolicy: "reuse_asset_cache",
    saveJson: true,
    saveVisualization: true,
    createLabelVersion: false,
  });
  const [versionForm, setVersionForm] = useState({ modelId: "", versionName: "", sourcePath: "", stage: "pretrained" });
  const [envForm, setEnvForm] = useState({ name: "", sourceType: "conda_pack", pythonPath: "", condaPackPath: "", unpackPath: "" });
  const [activeTrainingJobId, setActiveTrainingJobId] = useState(null);
  const [trainingLogs, setTrainingLogs] = useState([]);
  const importRefreshKeyRef = useRef("");
  const [activeInferenceResult, setActiveInferenceResult] = useState(null);

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
    if (!activeProject) return;
    const terminalImport = imports.find((row) => ["done", "failed", "cancelled"].includes(row.status));
    const refreshKey = terminalImport ? `${activeProject.id}:${terminalImport.id}:${terminalImport.status}:${terminalImport.finished_at || ""}` : "";
    if (!refreshKey || importRefreshKeyRef.current === refreshKey) return;
    importRefreshKeyRef.current = refreshKey;
    loadWorkspace(activeProject.id);
  }, [activeProject, imports]);

  useEffect(() => {
    if (!["training", "inference", "models", "evaluation"].includes(view)) return;
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

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const currentFolder = currentFolderId ? projectById.get(currentFolderId) : null;
  const visibleProjects = useMemo(
    () => projects.filter((project) => (project.parent_id || null) === (currentFolderId || null)),
    [projects, currentFolderId],
  );
  const breadcrumbs = useMemo(() => {
    const rows = [];
    let cursor = currentFolder;
    const seen = new Set();
    while (cursor && !seen.has(cursor.id) && rows.length < 3) {
      rows.unshift(cursor);
      seen.add(cursor.id);
      cursor = cursor.parent_id ? projectById.get(cursor.parent_id) : null;
    }
    return rows;
  }, [currentFolder, projectById]);
  const activeChildProjects = useMemo(
    () => activeProject ? projects.filter((project) => (project.parent_id || null) === activeProject.id) : [],
    [projects, activeProject],
  );
  const activeBreadcrumbs = useMemo(() => {
    const rows = [];
    let cursor = activeProject;
    const seen = new Set();
    while (cursor && !seen.has(cursor.id) && rows.length < 4) {
      rows.unshift(cursor);
      seen.add(cursor.id);
      cursor = cursor.parent_id ? projectById.get(cursor.parent_id) : null;
    }
    return rows;
  }, [activeProject, projectById]);
  const workspaceRoot = activeBreadcrumbs[0] || activeProject;
  const hasCurrentImages = Boolean((summary?.image_count || 0) > 0 || items.length);

  function refreshHome() {
    fetch("/api/projects").then((r) => r.json()).then((d) => {
      const rows = d.projects || [];
      setProjects(rows);
      setActiveProject((current) => current ? rows.find((project) => project.id === current.id) || current : null);
    }).catch(() => {});
    fetch("/api/projects/trash").then((r) => r.json()).then((d) => setTrashProjects(d.projects || [])).catch(() => {});
  }

  function loadMlPlatform() {
    fetch("/api/ml/models").then((r) => r.json()).then((d) => setMlModels(d.models || [])).catch(() => {});
    fetch("/api/ml/model-versions").then((r) => r.json()).then((d) => setModelVersions(d.versions || [])).catch(() => {});
    fetch("/api/ml/training-jobs").then((r) => r.json()).then((d) => setTrainingJobs(d.jobs || [])).catch(() => {});
    fetch("/api/ml/inference-jobs").then((r) => r.json()).then((d) => setInferenceJobs(d.jobs || [])).catch(() => {});
    fetch("/api/ml/algorithm-assets").then((r) => r.json()).then((d) => {
      const algorithms = d.algorithms || [];
      setAlgorithmAssets(algorithms);
      setTrainingTemplates(algorithms.map((item) => ({
        ...item,
        template_key: item.algorithm_key,
        capabilities_json: item.capabilities_json || { tasks: [item.task_type || "detect"] },
      })));
    }).catch(() => {
      fetch("/api/ml/training-templates").then((r) => r.json()).then((d) => setTrainingTemplates(d.templates || [])).catch(() => {});
    });
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
        if (status >= 400) throw new Error(data.error || "创建模型簇失败");
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
        templateId: null,
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

  function createPythonEnv() {
    const payload = envForm.sourceType === "server_python" ? { ...envForm, preferCondaPack: true } : envForm;
    fetch("/api/ml/python-envs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "登记环境失败");
        setEnvForm({ name: "", sourceType: "conda_pack", pythonPath: "", condaPackPath: "", unpackPath: "" });
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
        params: {
          modelId: null,
        algorithmAssetId: inferenceForm.templateId || null,
        templateId: inferenceForm.templateId || null,
          taskType: inferenceForm.taskType,
          pythonEnvId: inferenceForm.pythonEnvId || null,
          conf: Number(inferenceForm.conf),
          iou: Number(inferenceForm.iou),
          imgsz: Number(inferenceForm.imgsz),
          batch: Number(inferenceForm.batch),
          device: inferenceForm.device,
          input: {
            sourceType: "project_images",
            scope: inferenceForm.inputScope,
            filters: inferenceForm.inputScope === "project" ? {} : {
              scenes: inferenceForm.inputScenes.split(",").map((item) => item.trim()).filter(Boolean),
              views: inferenceForm.inputViews.split(",").map((item) => item.trim()).filter(Boolean),
              modalities: inferenceForm.inputModalities.split(",").map((item) => item.trim()).filter(Boolean),
              importBatchIds: inferenceForm.inputImportBatchIds.split(",").map((item) => item.trim()).filter(Boolean),
              labels: inferenceForm.inputLabels.split(",").map((item) => item.trim()).filter(Boolean),
              q: inferenceForm.inputQuery,
            },
            limit: 0,
            cachePolicy: "reuse_asset_cache",
          },
          output: {
            saveJson: Boolean(inferenceForm.saveJson),
            saveVisualization: Boolean(inferenceForm.saveVisualization),
            createLabelVersion: Boolean(inferenceForm.createLabelVersion),
          },
        },
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

  function deleteInferenceJob(jobId) {
    if (!window.confirm("确认删除这个推理任务？")) return;
    fetch(`/api/ml/inference-jobs/${jobId}`, { method: "DELETE" })
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "删除推理任务失败");
        loadMlPlatform();
      })
      .catch((err) => setError(err.message));
  }

  function viewInferenceResults(job) {
    setError(null);
    setActiveInferenceResult({ job, results: [], loading: true });
    fetch(`/api/ml/inference-jobs/${job.id}/results`)
      .then((r) => Promise.all([r.status, r.json()]))
      .then(([status, data]) => {
        if (status >= 400) throw new Error(data.error || "读取推理结果失败");
        setActiveInferenceResult({ job, results: data.results || [], loading: false });
      })
      .catch((err) => {
        setActiveInferenceResult(null);
        setError(err.message);
      });
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
    const isWorkspace = view === "workspace" && activeProject;
    const depth = isWorkspace ? activeBreadcrumbs.length : breadcrumbs.length;
    if (depth >= 3) {
      setError("项目计入第 1 级，最多只能创建到第 3 级文件夹");
      return;
    }
    const name = window.prompt(isWorkspace ? "请输入新建文件夹名称" : "请输入项目名称或路径（最多 3 级，例如：任务A/批次1/样本集）", isWorkspace ? "新建文件夹" : "新建项目");
    if (!name) return;
    if (/[\\/]/.test(name)) {
      setError("请一次只创建一个项目或文件夹，名称不能包含路径分隔符");
      return;
    }
    fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, parentId: isWorkspace ? activeProject.id : currentFolderId, createDefaultSplits: false }),
    })
      .then((r) => r.json().then((data) => {
        if (!r.ok) throw new Error(data.error || "新建项目失败");
        return data;
      }))
      .then((data) => {
        if (!isWorkspace && data.project?.parent_id) setCurrentFolderId(data.project.parent_id);
        refreshHome();
      })
      .catch((err) => setError(err.message));
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
    if (!window.confirm("确定删除该项目或文件夹吗？其下级文件夹会一并进入回收站；可在回收站恢复，清空回收站后将永久删除。")) return;
    fetch(`/api/projects/${projectId}`, { method: "DELETE" }).then(() => refreshHome());
  }

  function renameProject(project) {
    const name = window.prompt("请输入新的文件夹名称", project.name);
    if (!name || name.trim() === project.name) return;
    fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    })
      .then((r) => r.json().then((data) => {
        if (!r.ok) throw new Error(data.error || "重命名失败");
        return data;
      }))
      .then((data) => {
        refreshHome();
        if (activeProject?.id === project.id && data.project) setActiveProject(data.project);
      })
      .catch((err) => setError(err.message));
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
    setCurrentFolderId(project.id);
    setView("workspace");
    setPage(1);
    setSelected(null);
    setItems([]);
    setSummary(null);
    setCheckedIds([]);
    setError(null);
  }

  function goUpFolder() {
    if (!activeProject?.parent_id) {
      goHome();
      return;
    }
    const parent = projectById.get(activeProject.parent_id);
    if (parent) openProject(parent);
    else goHome();
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
      body: JSON.stringify({ format: exportFormat }),
    })
      .then((r) => r.json().then((data) => {
        if (!r.ok) throw new Error(data.error || "导出失败");
        return data;
      }))
      .catch((err) => setError("导出失败: " + err.message));
  }

  function openWorkspaceTrash() {
    const records = document.querySelector(".records-panel");
    if (records) {
      records.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setError("当前目录暂无导入回收站；项目回收站可在首页管理。");
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
    setCurrentFolderId(null);
    setError(null);
    refreshHome();
  };

  if (view === "home") {
    return (
      <div className={`app-shell ${theme}`}>
        <MainNav view={view} goHome={goHome} openPlatform={openPlatform} theme={theme} setTheme={setTheme} />
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
            <div className="section-title-row">
              <div>
                <h2>{currentFolder ? currentFolder.name : "历史项目"}</h2>
                <div className="breadcrumbs">
                  <button onClick={() => setCurrentFolderId(null)}>根目录</button>
                  {breadcrumbs.map((project) => (
                    <button key={project.id} onClick={() => setCurrentFolderId(project.id)}>{project.name}</button>
                  ))}
                </div>
              </div>
              {currentFolder && <button onClick={() => setCurrentFolderId(currentFolder.parent_id || null)}><ArrowLeft size={14} />上一级</button>}
            </div>
            <div className="project-grid">
              {visibleProjects.map((project) => (
                <article className="project-folder" key={project.id} tabIndex={0} aria-label={`文件夹 ${project.name}，双击进入`} onDoubleClick={() => openProject(project)} onKeyDown={(event) => { if (event.key === "Enter") openProject(project); }}>
                  <Folder size={34} />
                  <div>
                    <h3>{project.name}</h3>
                    <p>{project.image_count || 0} 图片 · {project.video_count || 0} 视频 · {project.child_count || 0} 下级</p>
                    <span>{project.last_import_at ? new Date(project.last_import_at).toLocaleString() : "暂无导入"}</span>
                  </div>
                  <div className="project-actions">
                    <button title="删除项目" aria-label={`删除 ${project.name}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>
                  </div>
                </article>
              ))}
              {!visibleProjects.length && <div className="empty-state">当前文件夹为空，点击右上角新建项目。</div>}
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

  if (view === "training" || view === "inference" || view === "models" || view === "evaluation") {
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
        algorithmAssets={algorithmAssets}
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
        envForm={envForm}
        setEnvForm={setEnvForm}
        createModel={createModel}
        createModelVersion={createModelVersion}
        createPythonEnv={createPythonEnv}
        renameModelVersion={renameModelVersion}
        submitTrainingJob={submitTrainingJob}
        submitInferenceJob={submitInferenceJob}
        deleteInferenceJob={deleteInferenceJob}
        activeInferenceResult={activeInferenceResult}
        setActiveInferenceResult={setActiveInferenceResult}
        viewInferenceResults={viewInferenceResults}
        error={error}
        setError={setError}
        openPlatform={openPlatform}
        theme={theme}
        setTheme={setTheme}
      />
    );
  }

  return (
    <div className={`app-shell ${theme}`}>
      <MainNav view="home" goHome={goHome} openPlatform={openPlatform} theme={theme} setTheme={setTheme} />
      <header className="app-header workspace-header">
        <div className="workspace-path-row">
          <button className="icon-only ghost" title="返回项目" onClick={goHome}><ArrowLeft size={16} /></button>
          <FolderOpen size={16} />
          <button onClick={goHome}>根目录</button>
          {activeBreadcrumbs.map((project) => (
            <React.Fragment key={project.id}>
              <ChevronRight size={14} />
              <button onClick={() => openProject(project)}>{project.name}</button>
            </React.Fragment>
          ))}
        </div>
        <div className="workspace-commandbar">
          <button onClick={goUpFolder}><ArrowLeft size={16} />返回上一级</button>
          <button onClick={createProject} disabled={activeBreadcrumbs.length >= 3} title={activeBreadcrumbs.length >= 3 ? "第 3 级 / 最多 3 级" : undefined}><FolderPlus size={16} />新建文件夹</button>
          <span className="folder-depth-indicator">第 {Math.min(3, activeBreadcrumbs.length)} 级 / 最多 3 级</span>
          <button onClick={importData}><Import size={16} />导入数据</button>
          <button onClick={exportProject}><Upload size={16} />导出数据集</button>
          <button onClick={openWorkspaceTrash}><Trash2 size={16} />回收站</button>
          <label className="export-format">导出格式：
            <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>
              <option value="labelme">LabelMe</option>
              <option value="coco">COCO</option>
              <option value="yolo">YOLO</option>
            </select>
          </label>
        </div>
      </header>
      <div className={hasCurrentImages ? "workspace-layout" : "workspace-folder-layout"}>
        <WorkspaceSidebar
          root={workspaceRoot}
          activeProject={activeProject}
          projects={projects}
          openProject={openProject}
          summary={summary}
        />
        <main className="preview-area">
          <h1 className="workspace-folder-title">{activeProject?.name}</h1>
          {hasCurrentImages && <FilterPanel summary={summary} filters={filters} setFilters={(next) => { setFilters(next); setPage(1); }} imports={imports} />}
          <ProgressStrip latestImport={latestImport} jobs={jobs} error={error} onCloseError={() => setError(null)} onCancelImport={cancelLatestImport} />
          <WorkspaceFolders projects={activeChildProjects} openProject={openProject} deleteProject={deleteProject} />
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
          {hasCurrentImages && <ImportRecords imports={imports} trashImports={trashImports} deleteImport={deleteImport} restoreImport={restoreImport} emptyImportTrash={emptyImportTrash} />}
        </main>
        <Inspector item={hasCurrentImages ? selected : null} summary={summary} />
      </div>
      {showImportDialog && (
        <div className="overlay" onClick={() => setShowImportDialog(false)}>
          <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>导入数据</h2>
            <p className="muted">输入或选择要导入的数据文件夹路径（浏览根目录：{appConfig.browseRootDisplay || appConfig.dataRootDisplay || appConfig.dataRoot}）</p>
            <div className="import-path-row">
              <input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="例如：/home/barry/图片/项目数据" />
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
  algorithmAssets,
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
  envForm,
  setEnvForm,
  createModel,
  createModelVersion,
  createPythonEnv,
  renameModelVersion,
  submitTrainingJob,
  submitInferenceJob,
  deleteInferenceJob,
  activeInferenceResult,
  setActiveInferenceResult,
  viewInferenceResults,
  error,
  setError,
  openPlatform,
  theme,
  setTheme,
}) {
  const title = view === "training" ? "训练平台" : view === "inference" ? "推理平台" : view === "evaluation" ? "测试评估平台" : "资产管理";
  const supportedTasks = ["detect", "segment", "classify"];
  const [evaluationCluster, setEvaluationCluster] = useState("all");
  const [evaluationType, setEvaluationType] = useState("all");
  const [hiddenEvaluationJobIds, setHiddenEvaluationJobIds] = useState([]);
  const [activeEvaluationTask, setActiveEvaluationTask] = useState(null);
  const [activeEvaluationReportTask, setActiveEvaluationReportTask] = useState(null);
  const evaluationTasks = inferenceJobs
    .filter((job) => completedEvaluationStatuses.has(String(job.status || "").toLowerCase()))
    .filter((job) => !hiddenEvaluationJobIds.includes(job.id))
    .map((job) => {
      const cluster = job.task_type || job.taskType || "detect";
      const modelText = job.model_name ? `${job.model_name}/${job.version_name || "版本"}` : "未指定模型版本";
      return {
        id: job.id,
        name: job.name || `推理任务 ${job.id}`,
        cluster,
        type: "inference",
        description: job.message || `${job.dataset_project_name || "未绑定数据集"} · ${modelText} · 已完成推理任务，可进入评估`,
        creator: job.created_by || job.creator || "admin",
        createdAt: formatDateTime(job.created_at),
        sourceJob: job,
      };
    });
  const filteredEvaluationTasks = evaluationTasks.filter((task) => {
    const clusterMatch = evaluationCluster === "all" || task.cluster === evaluationCluster;
    const typeMatch = evaluationType === "all" || task.type === evaluationType;
    return clusterMatch && typeMatch;
  });
  const inferenceVersions = modelVersions.filter((version) => {
    const model = mlModels.find((item) => item.id === version.model_id);
    return !model?.task_type || model.task_type === inferenceForm.taskType;
  });
  const selectedInferenceEnv = pythonEnvs.find((env) => env.id === inferenceForm.pythonEnvId);
  return (
    <div className={`app-shell ${theme}`}>
      <MainNav view={view} goHome={() => { setView("home"); setError(null); }} openPlatform={openPlatform} theme={theme} setTheme={setTheme} />
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
              <label>模型簇<select value={trainingForm.modelId} onChange={(e) => setTrainingForm({ ...trainingForm, modelId: e.target.value })}>
                <option value="">暂不绑定模型簇</option>
                {mlModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select></label>
              <label>初始化模型版本<select value={trainingForm.initialModelVersionId} onChange={(e) => setTrainingForm({ ...trainingForm, initialModelVersionId: e.target.value })}>
                <option value="">使用 YOLO 默认权重</option>
                {modelVersions.map((version) => <option key={version.id} value={version.id}>{version.model_name} / {version.version_name}</option>)}
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
              <label>模型簇<select value={inferenceForm.taskType} onChange={(e) => {
                const taskType = e.target.value;
                const currentVersion = modelVersions.find((version) => version.id === inferenceForm.modelVersionId);
                const currentModel = mlModels.find((model) => model.id === currentVersion?.model_id);
                setInferenceForm({ ...inferenceForm, taskType, modelVersionId: !currentModel?.task_type || currentModel.task_type === taskType ? inferenceForm.modelVersionId : "" });
              }}>
                {["detect", "segment", "classify"].map((task) => <option key={task} value={task}>{taskLabel(task)}</option>)}
              </select></label>
              <label>加载权重<select value={inferenceForm.modelVersionId} onChange={(e) => setInferenceForm({ ...inferenceForm, modelVersionId: e.target.value })}>
                <option value="">暂不指定版本</option>
                {inferenceVersions.map((version) => <option key={version.id} value={version.id}>{version.model_name} / {version.version_name}</option>)}
              </select></label>
              <label>算法名称<select value={inferenceForm.templateId} onChange={(e) => {
                const tpl = trainingTemplates.find((item) => item.id === e.target.value);
                const tasks = tpl?.capabilities_json?.tasks || ["detect", "segment", "classify"];
                setInferenceForm({ ...inferenceForm, templateId: e.target.value, taskType: tasks.includes(inferenceForm.taskType) ? inferenceForm.taskType : tasks[0] || "detect" });
              }}>
                <option value="">默认 Ultralytics YOLO 推理</option>
                {trainingTemplates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name} · {tpl.version || "builtin"}</option>)}
              </select></label>
              <label>运行环境资产<select value={inferenceForm.pythonEnvId} onChange={(e) => setInferenceForm({ ...inferenceForm, pythonEnvId: e.target.value })}>
                <option value="">由推理 worker 默认选择</option>
                {pythonEnvs.map((env) => <option key={env.id} value={env.id}>{env.name} · {env.source_type === "conda_pack" ? "conda-pack" : env.env_type} · {env.os_type}/{env.arch} · {env.accelerator?.toUpperCase()} · {env.status}</option>)}
              </select></label>
              {selectedInferenceEnv && (
                <div className="hint-box">
                  <b>{selectedInferenceEnv.source_type === "conda_pack" ? "云端环境包" : "服务器 Python"}</b>
                  <span>{selectedInferenceEnv.artifact_key || selectedInferenceEnv.python_path}</span>
                </div>
              )}
              <h2>输入范围</h2>
              <label>数据选择<select value={inferenceForm.inputScope} onChange={(e) => setInferenceForm({ ...inferenceForm, inputScope: e.target.value })}>
                <option value="project">全项目</option>
                <option value="filters">按筛选条件</option>
              </select></label>
              {inferenceForm.inputScope === "filters" && (
                <>
                  <label>场景<input value={inferenceForm.inputScenes} onChange={(e) => setInferenceForm({ ...inferenceForm, inputScenes: e.target.value })} placeholder="逗号分隔，例如 Grassland,Urban" /></label>
                  <label>视角<input value={inferenceForm.inputViews} onChange={(e) => setInferenceForm({ ...inferenceForm, inputViews: e.target.value })} placeholder="逗号分隔，例如 Aerial View" /></label>
                  <label>模态<input value={inferenceForm.inputModalities} onChange={(e) => setInferenceForm({ ...inferenceForm, inputModalities: e.target.value })} placeholder="visible,infrared" /></label>
                  <label>导入批次 ID<input value={inferenceForm.inputImportBatchIds} onChange={(e) => setInferenceForm({ ...inferenceForm, inputImportBatchIds: e.target.value })} placeholder="逗号分隔，可留空" /></label>
                  <label>类别<input value={inferenceForm.inputLabels} onChange={(e) => setInferenceForm({ ...inferenceForm, inputLabels: e.target.value })} placeholder="逗号分隔，可留空" /></label>
                  <label>关键词<input value={inferenceForm.inputQuery} onChange={(e) => setInferenceForm({ ...inferenceForm, inputQuery: e.target.value })} placeholder="文件名 / 场景 / 视角 / 关键字" /></label>
                </>
              )}
              <div className="form-row">
                <label>Conf<input type="number" step="0.01" value={inferenceForm.conf} onChange={(e) => setInferenceForm({ ...inferenceForm, conf: e.target.value })} /></label>
                <label>IoU<input type="number" step="0.01" value={inferenceForm.iou} onChange={(e) => setInferenceForm({ ...inferenceForm, iou: e.target.value })} /></label>
              </div>
              <div className="form-row">
                <label>ImgSz<input type="number" value={inferenceForm.imgsz} onChange={(e) => setInferenceForm({ ...inferenceForm, imgsz: e.target.value })} /></label>
                <label>Batch<input type="number" value={inferenceForm.batch} onChange={(e) => setInferenceForm({ ...inferenceForm, batch: e.target.value })} /></label>
              </div>
              <label>Device<input value={inferenceForm.device} onChange={(e) => setInferenceForm({ ...inferenceForm, device: e.target.value })} placeholder="0 / cpu / 0,1" /></label>
              <h2>输入策略</h2>
              <div className="check-list compact">
                <label className="check-row"><input type="checkbox" checked={inferenceForm.saveJson} onChange={() => setInferenceForm({ ...inferenceForm, saveJson: !inferenceForm.saveJson })} /><span>保存预测 JSON</span></label>
                <label className="check-row"><input type="checkbox" checked={inferenceForm.saveVisualization} onChange={() => setInferenceForm({ ...inferenceForm, saveVisualization: !inferenceForm.saveVisualization })} /><span>保存可视化结果</span></label>
                <label className="check-row"><input type="checkbox" checked={inferenceForm.createLabelVersion} onChange={() => setInferenceForm({ ...inferenceForm, createLabelVersion: !inferenceForm.createLabelVersion })} /><span>生成候选标注版本</span></label>
              </div>
              <button className="primary" onClick={submitInferenceJob}>提交到推理队列</button>
            </section>
            <section className="platform-card wide">
              <div className="metric-grid">
                <div><b>{mlModels.length}</b><span>模型簇</span></div>
                <div><b>{modelVersions.length}</b><span>模型版本</span></div>
                <div><b>{algorithmAssets.length || trainingTemplates.length}</b><span>算法资产</span></div>
                <div><b>{pythonEnvs.length}</b><span>环境资产</span></div>
              </div>
              <JobList title="推理队列" jobs={inferenceJobs} kind="inference" bare resultReserved onViewResults={viewInferenceResults} onDelete={deleteInferenceJob} />
            </section>
          </div>
        )}
        {view === "evaluation" && (activeEvaluationReportTask ? (
          <EvaluationReportPage
            task={activeEvaluationReportTask}
            onBack={() => setActiveEvaluationReportTask(null)}
          />
        ) : activeEvaluationTask ? (
          <EvaluationDetailPage
            task={activeEvaluationTask}
            onBack={() => setActiveEvaluationTask(null)}
            onRunDetail={(task) => viewInferenceResults(task.sourceJob)}
            onReport={setActiveEvaluationReportTask}
          />
        ) : (
          <EvaluationPage
            cluster={evaluationCluster}
            setCluster={setEvaluationCluster}
            type={evaluationType}
            setType={setEvaluationType}
            tasks={filteredEvaluationTasks}
            onDetail={setActiveEvaluationTask}
            onDelete={(taskId) => setHiddenEvaluationJobIds((ids) => Array.from(new Set([...ids, taskId])))}
          />
        ))}
        {view === "models" && (
          <div className="platform-grid">
            <section className="platform-card">
              <h2>登记模型簇</h2>
              <label>模型名<input value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} placeholder="例如 yolo_vehicle_detect" /></label>
              <label>任务类型<select value={modelForm.taskType} onChange={(e) => setModelForm({ ...modelForm, taskType: e.target.value })}>
                <option value="detect">目标检测</option>
                <option value="segment">实例分割</option>
                <option value="classify">分类</option>
              </select></label>
              <label>算法名称<input list="algorithm-options" value={modelForm.framework} onChange={(e) => setModelForm({ ...modelForm, framework: e.target.value })} placeholder="可选择已登记方法，也可输入自定义算法名" /></label>
              <datalist id="algorithm-options">
                {(algorithmAssets.length ? algorithmAssets : trainingTemplates).map((tpl) => <option key={tpl.id} value={tpl.name || tpl.algorithm_key || tpl.template_key} />)}
                <option value="自定义算法" />
              </datalist>
              <label>说明<textarea value={modelForm.description} onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })} /></label>
              <button className="primary" onClick={createModel}>创建模型簇</button>
              <h2>登记初始化权重</h2>
              <label>模型簇<select value={versionForm.modelId} onChange={(e) => setVersionForm({ ...versionForm, modelId: e.target.value })}>
                <option value="">请选择</option>
                {mlModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select></label>
              <label>版本名<input value={versionForm.versionName} onChange={(e) => setVersionForm({ ...versionForm, versionName: e.target.value })} placeholder="留空自动命名，例如 pretrain_模型名_日期_001" /></label>
              <label>权重文件路径<input value={versionForm.sourcePath} onChange={(e) => setVersionForm({ ...versionForm, sourcePath: e.target.value })} placeholder="例如 F:\models\best.pt" /></label>
              <button className="primary" onClick={createModelVersion}>登记权重版本</button>
              <h2>运行环境资产</h2>
              <label>环境名<input value={envForm.name} onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })} placeholder="例如 linux-yolo-cuda" /></label>
              <label>来源类型<select value={envForm.sourceType} onChange={(e) => setEnvForm({ ...envForm, sourceType: e.target.value })}>
                <option value="conda_pack">conda-pack 环境包入 MinIO（推荐）</option>
                <option value="server_python">服务器 Python 路径快速登记</option>
              </select></label>
              {envForm.sourceType === "server_python" && (
                <label>服务器 Python 路径<input value={envForm.pythonPath} onChange={(e) => setEnvForm({ ...envForm, pythonPath: e.target.value })} placeholder="建议先用 conda-pack 打包入 MinIO；这里用于快速检测登记" /></label>
              )}
              {envForm.sourceType === "conda_pack" && (
                <>
                  <label>conda-pack 包路径<input value={envForm.condaPackPath} onChange={(e) => setEnvForm({ ...envForm, condaPackPath: e.target.value })} placeholder="/home/administrator/Projects/det-dashboard/runtime/datasets/envs/yolo.tar.gz" /></label>
                  <label>云端解包路径<input value={envForm.unpackPath} onChange={(e) => setEnvForm({ ...envForm, unpackPath: e.target.value })} placeholder="留空则自动生成 runtime/python-envs/..." /></label>
                  <label>解包后 Python 路径<input value={envForm.pythonPath} onChange={(e) => setEnvForm({ ...envForm, pythonPath: e.target.value })} placeholder="可留空；已解包时用于自动检测 Python/Torch/CUDA" /></label>
                </>
              )}
              <button onClick={createPythonEnv}>{envForm.sourceType === "conda_pack" ? "导入环境包到 MinIO" : "登记运行环境"}</button>
            </section>
            <section className="platform-card wide">
              <h2>算法方法资产</h2>
              <div className="model-list">
                {(algorithmAssets.length ? algorithmAssets : trainingTemplates).map((algorithm) => (
                  <article className="model-row" key={algorithm.id}>
                    <div>
                      <b>{algorithm.name}</b>
                      <span>{algorithm.framework || "custom"} · {algorithm.task_type || "detect"} · {algorithm.version || "builtin"} · {algorithm.status || "ready"}</span>
                      <span>{algorithm.minio_prefix || algorithm.manifest_key || "内置方法，等待同步到 MinIO"}</span>
                    </div>
                  </article>
                ))}
                {!(algorithmAssets.length || trainingTemplates.length) && <div className="empty-state">还没有算法方法资产。</div>}
              </div>
              <h2>模型列表</h2>
              <div className="model-list">
                {mlModels.map((model) => (
                  <article className="model-row" key={model.id}>
                    <div><b>{model.name}</b><span>算法：{model.framework} · {model.task_type}</span></div>
                    <em>{model.version_count || 0} 个版本</em>
                  </article>
                ))}
                {!mlModels.length && <div className="empty-state">还没有模型簇。</div>}
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
              <h2>运行环境资产</h2>
              <div className="model-list">
                {pythonEnvs.map((env) => (
                  <article className="model-row" key={env.id}>
                    <div>
                      <b>{env.name}</b>
                      <span>{env.os_type} {env.arch} · {env.source_type === "conda_pack" ? "conda-pack 云端包" : env.env_type} · {env.accelerator?.toUpperCase()} · {env.status}</span>
                      <span>{env.python_version || "未知 Python"} · Torch {env.torch_version || "未检测"} · {env.cuda_available ? `CUDA ${env.cuda_version || ""}` : "CPU only"}</span>
                      <span>{env.artifact_key || env.python_path}</span>
                      {env.unpack_path && <span>解包路径：{env.unpack_path}</span>}
                    </div>
                  </article>
                ))}
                {!pythonEnvs.length && <div className="empty-state">还没有运行环境。</div>}
              </div>
            </section>
          </div>
        )}
        {activeInferenceResult && (
          <InferenceResultDialog
            resultState={activeInferenceResult}
            onClose={() => setActiveInferenceResult(null)}
          />
        )}
      </main>
    </div>
  );
}

function EvaluationPage({ cluster, setCluster, type, setType, tasks, onDetail, onDelete }) {
  const flowSteps = [
    { title: "数据准备", description: "在“数据集管理”模块上传或标注原始数据（图像/文本/结构化数据）。" },
    { title: "模型训练", description: "选择预训练基座模型，配置SFT（全量/LoRA/Prompt Tuning）或全参训练参数，提交训练任务。" },
    { title: "模型推理", description: "从“资产管理”选择已登记的模型版本，部署为在线服务或离线批量推理任务。" },
    { title: "效果评估", description: "进入“测试评估入口”，加载推理结果，执行人工标注或基线模型比对。" },
  ];

  return (
    <div className="evaluation-page">
      <section className="evaluation-flow">
        <div className="evaluation-flow-grid">
          {flowSteps.map((step, index) => (
            <article className="evaluation-flow-card" key={step.title}>
              <div className="flow-step-head">
                <span>{index + 1}</span>
                <b>{step.title}</b>
              </div>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="evaluation-tasks platform-card">
        <div className="evaluation-filters">
          <label>模型簇
            <select value={cluster} onChange={(event) => setCluster(event.target.value)}>
              <option value="all">全部</option>
              <option value="detect">目标检测</option>
              <option value="segment">实例分割</option>
              <option value="classify">图像分类</option>
            </select>
          </label>
          <label>评估类型
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">全部</option>
              <option value="training">训练模型</option>
              <option value="inference">推理模型</option>
            </select>
          </label>
        </div>
        <div className="evaluation-table-wrap">
          <table className="evaluation-table">
            <thead>
              <tr>
                <th>任务名称</th>
                <th>任务ID</th>
                <th>模型簇</th>
                <th>任务描述</th>
                <th>创建人</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td><b>{task.name}</b></td>
                  <td>{task.id}</td>
                  <td>{evaluationClusterLabels[task.cluster]}</td>
                  <td>{task.description}</td>
                  <td>{task.creator}</td>
                  <td>{task.createdAt}</td>
                  <td>
                    <div className="evaluation-actions">
                      <button type="button" onClick={() => onDetail(task)}>详情</button>
                      <button
                        type="button"
                        className="danger-action"
                        onClick={() => {
                          if (window.confirm(`确认删除评估任务“${task.name}”？`)) onDelete(task.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tasks.length && (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">当前筛选条件下没有评估任务。</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EvaluationDetailPage({ task, onBack, onRunDetail, onReport }) {
  const job = task.sourceJob || {};
  const params = parseMaybeJson(job.params_json);
  const modelText = job.model_name ? `${job.model_name}/${job.version_name || "版本"}` : "未指定模型版本";
  const algorithmText = job.template_name || params.templateName || params.template_id || job.template_id || "默认推理算法";
  const runRows = [
    {
      name: job.name || task.name,
      status: runStatusLabel(job.status),
      duration: formatDuration(job.created_at, job.finished_at || params.completedAt),
      createdAt: formatDateTime(job.created_at),
    },
  ];

  const detailItems = [
    ["任务名称", task.name],
    ["任务ID", task.id],
    ["创建人", task.creator],
    ["创建时间", task.createdAt],
    ["任务描述", task.description],
    ["模型簇", evaluationClusterLabels[task.cluster] || task.cluster],
    ["算法名称", algorithmText],
    ["加载权重", modelText],
  ];

  return (
    <div className="evaluation-detail-page">
      <div className="evaluation-detail-toolbar">
        <button type="button" onClick={onBack}><ArrowLeft size={14} />返回测试评估</button>
      </div>
      <section className="evaluation-detail-card platform-card">
        <div className="section-title-row">
          <h2>任务详情</h2>
        </div>
        <div className="evaluation-detail-grid">
          {detailItems.map(([label, value]) => (
            <div className="evaluation-detail-item" key={label}>
              <span>{label}</span>
              <b>{value || "--"}</b>
            </div>
          ))}
        </div>
      </section>
      <section className="evaluation-run-card platform-card">
        <div className="evaluation-table-wrap">
          <table className="evaluation-table evaluation-run-table">
            <thead>
              <tr>
                <th>运行名称</th>
                <th>运行状态</th>
                <th>运行时长</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {runRows.map((run) => (
                <tr key={run.name}>
                  <td><b>{run.name}</b></td>
                  <td>{run.status}</td>
                  <td>{run.duration}</td>
                  <td>{run.createdAt}</td>
                  <td>
                    <div className="evaluation-run-actions">
                      <button type="button" onClick={() => onRunDetail(task)}>详情</button>
                      <button type="button">发布</button>
                      <button type="button" onClick={() => onReport(task)}>评估报告</button>
                      <button type="button">训练测试</button>
                      <button type="button">测试追踪</button>
                      <button type="button">启动测试</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EvaluationReportPage({ task, onBack }) {
  const [expandedAp, setExpandedAp] = useState("类别");
  const classes = ["车辆", "人员", "设备", "背景"];
  const matrix = [
    [96, 4, 2, 1],
    [5, 88, 6, 3],
    [1, 7, 91, 4],
    [2, 3, 5, 84],
  ];
  const maxValue = Math.max(...matrix.flat());
  const metrics = [
    ["mAP@0.5", "92.6%"],
    ["mAP@0.5:0.95", "76.4%"],
    ["Precision", "90.8%"],
    ["Recall", "88.7%"],
  ];
  const apGroups = [
    { name: "类别", items: [["车辆", 0.94], ["人员", 0.89], ["设备", 0.86], ["背景", 0.81]] },
    { name: "场景", items: [["城区", 0.91], ["道路", 0.88], ["园区", 0.85], ["夜间", 0.79]] },
    { name: "视角", items: [["俯视", 0.9], ["平视", 0.87], ["侧视", 0.84], ["远景", 0.78]] },
    { name: "模态", items: [["RGB", 0.9], ["IR", 0.83], ["融合", 0.92], ["低照度", 0.77]] },
  ];
  const activeGroup = apGroups.find((group) => group.name === expandedAp) || apGroups[0];
  const reportTitle = `${task.name} 评估报告`;

  return (
    <div className="evaluation-report-page">
      <div className="evaluation-detail-toolbar">
        <button type="button" onClick={onBack}><ArrowLeft size={14} />返回任务详情</button>
      </div>
      <div className="report-top-grid">
        <section className="platform-card report-metrics-card">
          <h2>概览指标</h2>
          <p>{reportTitle}</p>
          <div className="report-metric-grid">
            {metrics.map(([label, value]) => (
              <div className="report-metric" key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="platform-card confusion-card">
          <h2>混淆矩阵热力图</h2>
          <div className="confusion-axis-label predicted">预测类别（Predicted）</div>
          <div className="confusion-layout">
            <div className="confusion-axis-label ground">真实类别（Ground Truth）</div>
            <div className="confusion-grid" style={{ gridTemplateColumns: `72px repeat(${classes.length}, minmax(58px, 1fr))` }}>
              <div />
              {classes.map((label) => <b className="confusion-label" key={label}>{label}</b>)}
              {classes.map((truth, rowIndex) => (
                <React.Fragment key={truth}>
                  <b className="confusion-label">{truth}</b>
                  {classes.map((predicted, colIndex) => {
                    const value = matrix[rowIndex][colIndex];
                    const ratio = value / maxValue;
                    const background = rowIndex === colIndex
                      ? `rgba(255, ${Math.round(245 - ratio * 80)}, ${Math.round(155 - ratio * 80)}, .96)`
                      : `rgba(${Math.round(95 + ratio * 155)}, ${Math.round(180 - ratio * 120)}, ${Math.round(220 - ratio * 170)}, .9)`;
                    return (
                      <div
                        className="confusion-cell"
                        key={`${truth}-${predicted}`}
                        style={{ background }}
                        title={`真实类别：${truth}；预测类别：${predicted}；数量：${value}`}
                      >
                        {value}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>
      </div>
      <section className="platform-card report-ap-card">
        <h2>AP 值</h2>
        <div className="ap-card-strip">
          {apGroups.map((group) => (
            <button
              type="button"
              className={expandedAp === group.name ? "ap-dimension-card active" : "ap-dimension-card"}
              key={group.name}
              onClick={() => setExpandedAp(group.name)}
            >
              <span>{group.name}统计</span>
              <b>{(group.items.reduce((sum, item) => sum + item[1], 0) / group.items.length * 100).toFixed(1)}%</b>
            </button>
          ))}
        </div>
        <div className="pr-curve-panel">
          <div>
            <h3>{activeGroup.name}维度 PR 曲线</h3>
            <p>点击上方维度卡片可切换展开内容。</p>
          </div>
          <div className="pr-bars">
            {activeGroup.items.map(([label, value]) => (
              <div className="pr-row" key={label}>
                <span>{label}</span>
                <i><em style={{ width: `${value * 100}%` }} /></i>
                <b>{(value * 100).toFixed(1)}%</b>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="platform-card bbox-compare-card">
        <h2>预测框与标注框对比</h2>
        <div className="bbox-compare-stage">
          <div className="bbox-image">
            <div className="bbox gt one"><span>GT: 车辆</span></div>
            <div className="bbox pred one"><span>Pred: 车辆 0.94</span></div>
            <div className="bbox gt two"><span>GT: 人员</span></div>
            <div className="bbox pred two"><span>Pred: 人员 0.87</span></div>
          </div>
          <div className="bbox-legend">
            <span><i className="gt-color" />标注框</span>
            <span><i className="pred-color" />预测框</span>
            <p>用于快速检查预测框与人工标注框的重合程度、漏检与误检位置。</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function MainNav({ view, goHome, openPlatform, theme, setTheme }) {
  return (
    <nav className="main-nav">
      <div className="brand-mark">
        <Boxes size={18} />
        <span>Det Dashboard</span>
      </div>
      <div className="nav-tabs">
        <button className={view === "home" ? "active" : ""} onClick={goHome}><FolderOpen size={16} />数据集</button>
        <button className={view === "models" ? "active" : ""} onClick={() => openPlatform("models")}><Brain size={16} />资产管理</button>
        <button className={view === "training" ? "active" : ""} onClick={() => openPlatform("training")}><Play size={16} />训练</button>
        <button className={view === "inference" ? "active" : ""} onClick={() => openPlatform("inference")}><Cpu size={16} />推理</button>
        <button className={view === "evaluation" ? "active" : ""} onClick={() => openPlatform("evaluation")}><Search size={16} />评估</button>
      </div>
      <div className="nav-tools">
        <button title="帮助"><HelpCircle size={16} /></button>
        <button title="通知"><Bell size={16} /></button>
        <button title="设置"><Settings size={16} /></button>
        <button className="theme-toggle" title="切换明暗模式" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><Sun size={16} />{theme === "dark" ? "亮色模式" : "深色模式"}</button>
        <span className="user-chip"><i>A</i> admin <ChevronDown size={13} /></span>
      </div>
    </nav>
  );
}

function JobList({ title, jobs, kind, activeId, setActiveId, onRequeue, onViewResults, onDelete, bare = false, resultReserved = false }) {
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
              {resultReserved && onViewResults && (
                <button
                  className={job.status === "done" ? "result-ready" : ""}
                  disabled={job.status !== "done"}
                  title={job.status === "done" ? "查看推理结果" : "任务完成后可查看结果"}
                  onClick={(event) => { event.stopPropagation(); onViewResults(job); }}
                >
                  查看结果
                </button>
              )}
              {onDelete && (
                <button className="danger-icon" title="删除任务" onClick={(event) => { event.stopPropagation(); onDelete(job.id); }}><Trash2 size={14} />删除</button>
              )}
            </div>
          </article>
        ))}
        {!jobs.length && <div className="empty-state">队列为空。</div>}
      </div>
    </Tag>
  );
}

function predictionItems(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value.predictions) ? value.predictions : [];
}

function parseMaybeJson(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

function metricValue(metrics, keys) {
  for (const key of keys) {
    const value = metrics?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function formatMetric(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number >= 0 && number <= 1) return `${(number * 100).toFixed(2)}%`;
  return number.toFixed(2);
}

function InferenceResultDialog({ resultState, onClose }) {
  const { job, results, loading } = resultState;
  const rows = results || [];
  const totalPredictions = rows.reduce((sum, row) => sum + predictionItems(row.predictions_json).length, 0);
  const params = parseMaybeJson(job.params_json);
  const output = params.output || {};
  const metrics = output.metrics || params.metrics || {};
  const outputPath = output.predictionsPath || rows.find((row) => row.artifact_path)?.artifact_path || job.output_root || "";
  const metricCards = [
    ["Precision", ["precision", "Precision", "p", "P"]],
    ["Recall", ["recall", "Recall", "r", "R"]],
    ["mAP50", ["map50", "mAP50", "map_50", "mAP_50"]],
    ["mAP50-95", ["map", "mAP", "map5095", "mAP50-95", "map_50_95"]],
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="result-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="section-title-row">
          <div>
            <h2>推理结果</h2>
            <p className="muted">{job.name} · {job.dataset_project_name || "未绑定数据集"}</p>
          </div>
          <button onClick={onClose}><X size={14} /></button>
        </div>
        <div className="result-summary">
          <div><span>任务状态</span><b>{job.status}</b></div>
          <div><span>图片结果</span><b>{loading ? "..." : rows.length}</b></div>
          <div><span>预测数量</span><b>{loading ? "..." : totalPredictions}</b></div>
        </div>
        <div className="metric-summary">
          {metricCards.map(([label, keys]) => (
            <div key={label}><span>{label}</span><b>{loading ? "..." : formatMetric(metricValue(metrics, keys))}</b></div>
          ))}
        </div>
        <div className="result-path">
          <span>输出文件路径</span>
          <b>{outputPath || "暂无输出文件路径"}</b>
        </div>
        {loading ? (
          <div className="empty-state">正在读取结果...</div>
        ) : !rows.length && (
          <div className="muted">暂无图片级结果明细。</div>
        )}
      </div>
    </div>
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
      <label className="search-control"><Search size={15} /><input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="搜索文件名" /></label>
      <MultiFilter title="视角" values={optionList(summary?.views)} selected={filters.views} onToggle={(value) => toggle("views", value)} />
      <MultiFilter title="场景" values={optionList(summary?.scenes)} selected={filters.scenes} onToggle={(value) => toggle("scenes", value)} />
      <MultiFilter title="模态" values={[["infrared", "IR"], ["visible", "RGB"]]} selected={filters.modalities} onToggle={(value) => toggle("modalities", value)} />
      <MultiFilter title="标签" values={optionList(summary?.labels)} selected={filters.labels} onToggle={(value) => toggle("labels", value)} />
      <details className="filter-dropdown more-filter">
        <summary>更多筛选 <SlidersHorizontal size={14} /></summary>
        <div className="filter-menu">
          <MultiFilter title="导入批次" values={imports.map((x) => [x.id, new Date(x.created_at).toLocaleString()])} selected={filters.importBatchIds} onToggle={(value) => toggle("importBatchIds", value)} />
          <button className="clear-filters" onClick={clear}>清空筛选</button>
        </div>
      </details>
      <div className="view-switch">
        <button className="active" title="网格视图"><Grid size={16} /></button>
        <button title="列表视图"><List size={16} /></button>
      </div>
    </aside>
  );
}

function WorkspaceSidebar({ root, activeProject, projects, openProject, summary }) {
  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const project of projects || []) {
      const key = project.parent_id || "root";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(project);
    }
    for (const rows of map.values()) rows.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    return map;
  }, [projects]);
  const rootRows = root ? [root] : childrenByParent.get("root") || [];
  return (
    <aside className="workspace-sidebar">
      <div className="sidebar-head">
        <div>
          <span>文件夹树</span>
          <b>{root?.name || activeProject?.name || "当前项目"}</b>
        </div>
      </div>
      <div className="tree-list">
        {rootRows.map((project) => (
          <TreeNode
            key={project.id}
            project={project}
            childrenByParent={childrenByParent}
            activeProject={activeProject}
            openProject={openProject}
            depth={0}
          />
        ))}
        {!rootRows.length && <p className="muted">当前目录没有下级文件夹</p>}
      </div>
      <div className="storage-meter">
        <div><span>存储使用</span><b>{formatCount(summary?.image_count || 0)} 图像</b></div>
        <progress value={Math.min(100, Number(summary?.image_count || 0) ? 12.5 : 0)} max="100" />
        <em>{Number(summary?.image_count || 0) ? "12.5%" : "0%"}</em>
      </div>
    </aside>
  );
}

function TreeNode({ project, childrenByParent, activeProject, openProject, depth }) {
  const children = childrenByParent.get(project.id) || [];
  const active = activeProject?.id === project.id;
  const open = active || children.some((child) => child.id === activeProject?.id || (childrenByParent.get(child.id) || []).some((grand) => grand.id === activeProject?.id));
  return (
    <div className="tree-node">
      <button className={active ? "active" : ""} style={{ "--depth": depth }} onClick={() => openProject(project)}>
        {children.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="tree-spacer" />}
        {active ? <FolderOpen size={16} /> : <Folder size={16} />}
        <span>{project.name}</span>
        <em>{formatCount((project.image_count || 0) + (project.child_count || 0))}</em>
      </button>
      {open && children.map((child) => (
        <TreeNode
          key={child.id}
          project={child}
          childrenByParent={childrenByParent}
          activeProject={activeProject}
          openProject={openProject}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function WorkspaceFolders({ projects, openProject, deleteProject }) {
  return (
    <section className="workspace-folders">
      <div className="section-title-row compact-title">
        <h2>下级文件夹</h2>
        <span className="muted">{projects.length} 个</span>
      </div>
      <div className="project-grid workspace-folder-grid">
        {projects.map((project) => (
          <article className="project-folder" key={project.id} onDoubleClick={() => openProject(project)}>
            <Folder size={34} />
            <div>
              <h3>{project.name}</h3>
              <p>{project.image_count || 0} 图片 · {project.video_count || 0} 视频 · {project.child_count || 0} 下级</p>
              <span>{project.last_import_at ? new Date(project.last_import_at).toLocaleString() : "暂无导入"}</span>
            </div>
            <div className="project-actions">
              <button title="删除文件夹" onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
        {!projects.length && <div className="empty-state">当前目录没有下级文件夹。</div>}
      </div>
    </section>
  );
}

function MultiFilter({ title, values, selected = [], onToggle }) {
  const normalized = values.map((item) => Array.isArray(item) ? item : [item, item]);
  const label = selected.length ? `${selected.length} 已选` : "全部";
  return (
    <details className="filter-group filter-dropdown">
      <summary><span>{title}</span><b>{label}</b><ChevronDown size={14} /></summary>
      <div className="check-list filter-menu">
        {normalized.map(([value, label]) => (
          <label className="check-row" key={value}>
            <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
            <span>{label}</span>
          </label>
        ))}
        {!normalized.length && <div className="muted">暂无选项</div>}
      </div>
    </details>
  );
}

function ProgressStrip({ latestImport, jobs, error, onCloseError, onCancelImport }) {
  const runningStatuses = new Set(["pending", "scanning", "running", "cancel_requested", "preparing"]);
  const visibleImport = latestImport && runningStatuses.has(latestImport.status) ? latestImport : null;
  const latestExport = jobs.find((job) => job.type === "export" && runningStatuses.has(job.status));
  const canCancelImport = visibleImport && ["scanning", "running", "cancel_requested"].includes(visibleImport.status);
  return (
    <div className="progress-stack">
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={onCloseError}>&times;</button>
        </div>
      )}
      {visibleImport && <ProgressBar title="导入进度" message={visibleImport.message || visibleImport.status} progress={visibleImport.progress || 0} onCancel={canCancelImport ? onCancelImport : null} />}
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
      <div className="file-path-bar" title={selected?.absolute_path || selected?.source_path || ""}>
        <span>当前文件绝对路径</span>
        <code>{selected?.absolute_path || selected?.source_path || "尚未选择文件"}</code>
      </div>
      <div className="preview-head">
        <div><h2>数据预览</h2><p>当前筛选结果 · 双击缩略图打开大图</p></div>
        <div className="bulk-actions">
          <label><input type="checkbox" checked={allChecked} onChange={togglePage} />本页全选</label>
          <span>{checkedIds.length} 已选</span>
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
              <span className="thumb-tags"><em>{item.view || "视角"}</em><em>{item.modality === "infrared" ? "IR" : "RGB"}</em></span>
              {selected?.id === item.id && <span className="selected-mark"><CheckCircle size={18} /></span>}
              <b className="thumb-name">{item.display_name}</b>
            </div>
          </button>
        ))}
        {!items.length && <div className="empty-state">该级文件夹无数据。</div>}
      </div>
      <div className="dataset-bottom-bar">
        <label><input type="checkbox" checked={allChecked} onChange={togglePage} />已选择 {checkedIds.length} 项</label>
        <button disabled={!selected} onClick={() => selected && openViewer(selected)}><Eye size={14} />查看标签</button>
        <button disabled={!checkedIds.length} onClick={() => window.alert("下载功能待接入后端批量导出接口")}><Download size={14} />下载</button>
        <button disabled={!checkedIds.length} onClick={() => window.alert("移动功能待接入项目内文件移动接口")}><Move size={14} />移动</button>
        <button disabled={!checkedIds.length} onClick={() => window.alert("复制功能待接入项目内文件复制接口")}><Copy size={14} />复制</button>
        <button disabled={!checkedIds.length} onClick={deleteCheckedImages}>删除</button>
        <div className="pager">
          <span>共 {formatCount(items.length)} 项</span>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronRight className="prev-icon" size={15} /></button>
          <b>{page}</b>
          <span>/ {Math.max(page, page + (items.length ? 1 : 0))}</span>
          <button onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
          <select defaultValue="48">
            <option value="48">48 条/页</option>
            <option value="100">100 条/页</option>
          </select>
        </div>
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

function Inspector({ item, summary }) {
  const topLabels = optionList(summary?.labels).slice(0, 6);
  if (!item) {
    return (
      <aside className="inspector-panel">
        <div className="inspector-title"><h2>数据集统计</h2><button title="刷新"><RefreshCw size={14} /></button></div>
        <InspectorStats summary={summary} labels={topLabels} />
        <p className="muted">选择一张图片查看详情。</p>
      </aside>
    );
  }
  const annotations = item.annotations || [];
  const grouped = annotations.reduce((acc, ann) => {
    acc[ann.label] = (acc[ann.label] || 0) + 1;
    return acc;
  }, {});
  return (
    <aside className="inspector-panel">
      <div className="inspector-title"><h2>数据集统计</h2><button title="刷新"><RefreshCw size={14} /></button></div>
      <InspectorStats summary={summary} labels={topLabels} />
      <section className="image-info-panel">
        <h3>图像信息 <span>({item.display_name})</span></h3>
        <div className="kv path-kv"><span>绝对路径</span><b>{item.absolute_path || item.source_path || "未记录"}</b></div>
        <div className="kv"><span>文件名</span><b>{item.display_name}</b></div>
        <div className="kv"><span>尺寸</span><b>{item.image_width || "--"} × {item.image_height || "--"}</b></div>
        <div className="kv"><span>场景</span><b>{item.scene || "--"}</b></div>
        <div className="kv"><span>视角</span><b>{item.view || "--"}</b></div>
        <div className="kv"><span>模态</span><b>{item.modality === "infrared" ? "IR" : "RGB"}</b></div>
        <div className="kv"><span>坐标系</span><b>WGS84</b></div>
      </section>
      <section className="annotation-list">
        <h3>标签（{annotations.length}）</h3>
        <div className="annotation-table-head"><span>类别</span><span>数量</span><span>操作</span></div>
        {Object.entries(grouped).map(([label, count]) => (
          <div className="annotation-table-row" key={label}>
            <span><i style={{ background: labelColor(label) }} />{label}</span>
            <b>{count}</b>
            <em><Eye size={14} /><MoreVertical size={14} /></em>
          </div>
        ))}
        {!annotations.length && <p className="muted">当前筛选下没有标注框。</p>}
      </section>
    </aside>
  );
}

function InspectorStats({ summary, labels }) {
  const imageCount = Number(summary?.image_count || 0);
  const annotationCount = Number(summary?.annotation_count || 0);
  const labelCount = optionList(summary?.labels).length;
  return (
    <>
      <section className="inspector-stats">
        <div><ImageIcon size={15} /><span>图像数量</span><b>{formatCount(imageCount)}</b></div>
        <div><CheckCircle size={15} /><span>已标注图像</span><b>{formatCount(imageCount)}</b></div>
        <div><Tags size={15} /><span>标注框总数</span><b>{formatCount(annotationCount)}</b></div>
        <div><Database size={15} /><span>类别数</span><b>{formatCount(labelCount)}</b></div>
      </section>
      <section className="class-bars">
        <h3>类别分布（标注框）</h3>
        {labels.map((label, index) => (
          <p key={label}>
            <span><i style={{ background: labelColor(label) }} />{label}</span>
            <strong><em style={{ width: `${Math.max(22, 96 - index * 10)}%`, background: labelColor(label) }} /></strong>
            <b>{formatCount(Math.max(1, annotationCount ? Math.round(annotationCount / (index + 2)) : 0))}</b>
          </p>
        ))}
        {!labels.length && <small className="muted">暂无类别统计</small>}
      </section>
    </>
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
        <div className="viewer-file-identity">
          <b>{item.display_name}</b>
          <code title={item.absolute_path || item.source_path || ""}>{item.absolute_path || item.source_path || "未记录绝对路径"}</code>
        </div>
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
