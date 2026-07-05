import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  Bell,
  Boxes,
  Brain,
  CheckCircle,
  CheckCircle2,
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
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [viewerIndex, setViewerIndex] = useState(null);
  const [checkedIds, setCheckedIds] = useState([]);
  const [lastCheckedId, setLastCheckedId] = useState(null);
  const [homeExpandedIds, setHomeExpandedIds] = useState(() => new Set());
  const [mlModels, setMlModels] = useState([]);
  const [modelVersions, setModelVersions] = useState([]);
  const [trainingJobs, setTrainingJobs] = useState([]);
  const [inferenceJobs, setInferenceJobs] = useState([]);
  const [trainingTemplates, setTrainingTemplates] = useState([]);
  const [algorithmAssets, setAlgorithmAssets] = useState([]);
  const [pythonEnvs, setPythonEnvs] = useState([]);
  const [assetLinks, setAssetLinks] = useState([]);
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
  const projectLastImportAt = useMemo(() => {
    const childrenByParent = new Map();
    for (const project of projects) {
      const key = project.parent_id || "root";
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(project);
    }
    const memo = new Map();
    const newest = (project) => {
      if (!project) return "";
      if (memo.has(project.id)) return memo.get(project.id);
      let best = project.last_import_at || "";
      for (const child of childrenByParent.get(project.id) || []) {
        const childTime = newest(child);
        if (childTime && (!best || new Date(childTime).getTime() > new Date(best).getTime())) best = childTime;
      }
      memo.set(project.id, best);
      return best;
    };
    for (const project of projects) newest(project);
    return memo;
  }, [projects]);
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
  const parsedImportPaths = useMemo(() => splitImportPaths(importPath), [importPath]);
  const hasCurrentImages = Boolean((summary?.direct_image_count || 0) > 0 || items.length);
  const homeStats = useMemo(() => ({
    title: currentFolder?.name || "历史项目",
    projects: currentFolder ? 1 : projects.filter((project) => !project.parent_id).length,
    folders: currentFolder ? Number(currentFolder.child_count || 0) : projects.length,
    images: currentFolder
      ? Number(currentFolder.image_count || 0)
      : projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.image_count || 0), 0),
    videos: currentFolder
      ? Number(currentFolder.video_count || 0)
      : projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.video_count || 0), 0),
    annotations: currentFolder
      ? Number(currentFolder.annotation_count || 0)
      : projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.annotation_count || 0), 0),
    trash: trashProjects.length,
  }), [currentFolder, projects, trashProjects]);

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
    fetch("/api/ml/asset-links").then((r) => r.json()).then((d) => setAssetLinks(d.links || [])).catch(() => setAssetLinks([]));
    refreshHome();
  }

  function openPlatform(nextView) {
    setView(nextView);
    setError(null);
    loadMlPlatform();
  }

  function openDatasetView() {
    setError(null);
    setView(activeProject ? "workspace" : "home");
    refreshHome();
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
    const selectedAlgorithm = algorithmAssets.find((item) => item.id === inferenceForm.templateId);
    if (!inferenceForm.datasetProjectId) {
      setError("请选择数据集项目");
      return;
    }
    if (!selectedAlgorithm) {
      setError("请选择算法名称");
      return;
    }
    if (selectedAlgorithm.algorithm_key !== "dummy_empty_detector") {
      if (!inferenceForm.pythonEnvId) {
        setError("真实算法推理需要先选择运行环境资产");
        return;
      }
      if (!inferenceForm.modelVersionId) {
        setError("真实算法推理需要先选择模型权重版本");
        return;
      }
    }
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
      body: JSON.stringify({ name, parentId: isWorkspace ? activeProject.id : currentFolderId, createDefaultSplits: !isWorkspace }),
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

  function startRenameProject(project) {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name || "");
  }

  function cancelRenameProject() {
    setEditingProjectId(null);
    setEditingProjectName("");
  }

  function commitRenameProject(project) {
    const name = editingProjectName.trim();
    if (!project || editingProjectId !== project.id) return;
    if (!name || name === project.name) {
      cancelRenameProject();
      return;
    }
    fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json().then((data) => {
        if (!r.ok) throw new Error(data.error || "重命名失败");
        return data;
      }))
      .then((data) => {
        cancelRenameProject();
        refreshHome();
        if (activeProject?.id === project.id && data.project) setActiveProject(data.project);
      })
      .catch((err) => {
        setError(err.message);
        cancelRenameProject();
      });
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

  function splitImportPaths(value) {
    return Array.from(new Set(String(value || "").split(";").map((item) => item.trim()).filter(Boolean)));
  }

  function appendImportPath(pathValue) {
    if (!pathValue) return;
    setImportPath((current) => {
      const paths = splitImportPaths(current);
      if (!paths.includes(pathValue)) paths.push(pathValue);
      return paths.join("; ");
    });
  }

  async function browseFolder() {
    setError(null);
    const selectedPaths = splitImportPaths(importPath);
    const initialPath = selectedPaths[selectedPaths.length - 1] || appConfig.browseRootDisplay || "/";
    if (appConfig.nativeDialogMode === "disabled") {
      openDataRootPicker(initialPath);
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
        appendImportPath(result.selectedPath);
      } else if (result.status !== "cancelled") {
        throw new Error(result.error || "系统文件夹选择器不可用");
      }
    } catch (err) {
      const reason = err.name === "AbortError" ? "打开超时" : err.message;
      openDataRootPicker(initialPath);
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
    appendImportPath(pathValue);
    setDirPicker(null);
    setError(null);
  }

  function openHomeFolder(project) {
    const hasChildren = Number(project?.child_count || 0) > 0;
    const hasAssets = Number(project?.image_count || 0) > 0 || Number(project?.video_count || 0) > 0;
    if (!hasChildren && hasAssets) {
      openProject(project);
      return;
    }
    setCurrentFolderId(project.id);
  }

  function confirmImport() {
    const paths = splitImportPaths(importPath);
    if (!paths.length) {
      setError("请输入或选择数据文件夹路径");
      return;
    }
    setError(null);
    setShowImportDialog(false);
    setLatestImport({ status: "running", message: "正在提交导入任务...", progress: 1, processed_files: 0, total_files: 1 });
    fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: activeProject.id, sourcePath: paths[0], sourcePaths: paths, rename: true }),
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
        <MainNav view={view} goHome={openDatasetView} openPlatform={openPlatform} theme={theme} setTheme={setTheme} />
        <main className="home-workspace">
          <HomeSidebar
            projects={projects}
            currentFolder={currentFolder}
            currentFolderId={currentFolderId}
            setCurrentFolderId={setCurrentFolderId}
            expandedIds={homeExpandedIds}
            setExpandedIds={setHomeExpandedIds}
            openProject={openProject}
            openHomeFolder={openHomeFolder}
            createProject={createProject}
            stats={homeStats}
          />
          <section className="home-browser">
            <div className="home-toolbar">
              <div className="workspace-path-row">
                <FolderOpen size={16} />
                <button onClick={() => setCurrentFolderId(null)}>项目</button>
                {!breadcrumbs.length && (
                  <>
                    <ChevronRight size={14} />
                    <button onClick={() => setCurrentFolderId(null)}>历史项目</button>
                  </>
                )}
                {breadcrumbs.map((project) => (
                  <React.Fragment key={project.id}>
                    <ChevronRight size={14} />
                    <button onClick={() => setCurrentFolderId(project.id)}>{project.name}</button>
                  </React.Fragment>
                ))}
              </div>
              <div className="workspace-commandbar home-commandbar">
                {currentFolder && <button onClick={() => setCurrentFolderId(currentFolder.parent_id || null)}><ArrowLeft size={16} />返回</button>}
                <button onClick={createProject}><FolderPlus size={16} />新建项目</button>
                <button onClick={createProject}><FolderPlus size={16} />新建文件夹</button>
                <button onClick={() => setError("请先进入具体项目后再导入数据集。")}><Import size={16} />导入数据集</button>
                <button onClick={() => setError("请先进入具体项目后再导出数据集。")}><Upload size={16} />导出数据集</button>
                <button onClick={() => document.querySelector(".home-trash-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}><Trash2 size={16} />回收站</button>
              </div>
            </div>
            <div className="home-filterbar">
              <label className="search-control"><Search size={15} /><input readOnly placeholder="搜索项目名称" /></label>
              <select><option>视角：全部</option></select>
              <select><option>场景：全部</option></select>
              <select><option>标签：全部</option></select>
              <button className="more-filter-button">更多筛选 <SlidersHorizontal size={14} /></button>
              <div className="view-switch">
                <button className="active" title="网格视图"><Grid size={16} /></button>
                <button title="列表视图"><List size={16} /></button>
              </div>
              <span>{visibleProjects.length} 个文件夹</span>
            </div>
            <div className="project-grid home-project-grid">
              {visibleProjects.map((project) => (
                <article
                  className="project-folder"
                  key={project.id}
                  tabIndex={0}
                  aria-label={`文件夹 ${project.name}，单击打开`}
                  onClick={() => openHomeFolder(project)}
                  onDoubleClick={() => openProject(project)}
                  onKeyDown={(event) => { if (event.key === "Enter") openProject(project); }}
                >
                  <div className="project-folder-icon" aria-hidden="true"><span className="project-folder-glyph"><span /></span><ImageIcon className="project-folder-badge" size={11} /></div>
                  <div className="project-folder-body">
                    <EditableProjectName
                      project={project}
                      editingProjectId={editingProjectId}
                      editingProjectName={editingProjectName}
                      setEditingProjectName={setEditingProjectName}
                      startRenameProject={startRenameProject}
                      commitRenameProject={commitRenameProject}
                      cancelRenameProject={cancelRenameProject}
                    />
                    <p className="project-folder-metrics">
                      <span><ImageIcon size={13} />{formatCount(project.image_count || 0)}</span>
                      <span><Video size={13} />{formatCount(project.video_count || 0)}</span>
                      <span><Folder size={13} />{formatCount(project.child_count || 0)}</span>
                    </p>
                    <span>最后导入： {projectLastImportAt.get(project.id) ? new Date(projectLastImportAt.get(project.id)).toLocaleString() : "暂无导入"}</span>
                  </div>
                  <div className="project-actions">
                    <button title="重命名" onClick={(event) => { event.stopPropagation(); startRenameProject(project); }}><Edit3 size={16} /></button>
                    <button title="删除项目" aria-label={`删除 ${project.name}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>
                  </div>
                </article>
              ))}
              {!visibleProjects.length && <div className="empty-state folder-empty">空文件夹</div>}
            </div>
          </section>
          <HomeInspector
            stats={homeStats}
            trashProjects={trashProjects}
            restoreProject={restoreProject}
            emptyProjectTrash={emptyProjectTrash}
          />
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
        assetLinks={assetLinks}
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
        openDatasetView={openDatasetView}
        theme={theme}
        setTheme={setTheme}
      />
    );
  }

  return (
    <div className={`app-shell ${theme}`}>
      <MainNav view="home" goHome={openDatasetView} openPlatform={openPlatform} theme={theme} setTheme={setTheme} />
      <div className={hasCurrentImages ? "workspace-layout" : "workspace-folder-layout"}>
        <WorkspaceSidebar
          root={workspaceRoot}
          activeProject={activeProject}
          projects={projects}
          openProject={openProject}
          createProject={createProject}
          summary={summary}
        />
        <main className="preview-area">
          <div className="home-toolbar workspace-inline-toolbar">
            <div className="workspace-path-row">
              <button className="icon-only ghost" title="返回项目" onClick={goHome}><ArrowLeft size={16} /></button>
              <FolderOpen size={16} />
              <button onClick={goHome}>项目</button>
              {activeBreadcrumbs.map((project) => (
                <React.Fragment key={project.id}>
                  <ChevronRight size={14} />
                  <button onClick={() => openProject(project)}>{project.name}</button>
                </React.Fragment>
              ))}
            </div>
            <div className="workspace-commandbar home-commandbar">
              <button onClick={goHome}><ArrowLeft size={16} />返回</button>
              <button onClick={createProject}><FolderPlus size={16} />新建文件夹</button>
              <button onClick={importData}><Import size={16} />导入数据集</button>
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
          </div>
          {hasCurrentImages && <FilterPanel summary={summary} filters={filters} setFilters={(next) => { setFilters(next); setPage(1); }} imports={imports} />}
          <ProgressStrip latestImport={latestImport} jobs={jobs} error={error} onCloseError={() => setError(null)} onCancelImport={cancelLatestImport} />
          <WorkspaceFolders
            projects={activeChildProjects}
            openProject={openProject}
            deleteProject={deleteProject}
            editingProjectId={editingProjectId}
            editingProjectName={editingProjectName}
            setEditingProjectName={setEditingProjectName}
            startRenameProject={startRenameProject}
            commitRenameProject={commitRenameProject}
            cancelRenameProject={cancelRenameProject}
          />
          {hasCurrentImages ? (
            <>
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
            </>
          ) : (
            !activeChildProjects.length && !latestImport && <div className="empty-state folder-empty">空文件夹</div>
          )}
        </main>
        <Inspector item={hasCurrentImages ? selected : null} summary={summary} />
      </div>
      {showImportDialog && (
        <div className="overlay" onClick={() => setShowImportDialog(false)}>
          <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="import-dialog-head">
              <div className="dialog-title">
                <span className="dialog-title-icon"><Import size={18} /></span>
                <div>
                  <h2>导入数据集</h2>
                  <p>{activeProject?.name || "当前项目"} · 本地文件夹导入到服务器端资产库</p>
                </div>
              </div>
              <button className="icon-button" onClick={() => { setShowImportDialog(false); setError(null); }} aria-label="关闭导入数据集">
                <X size={16} />
              </button>
            </div>
            <div className="import-dialog-body">
              <div className="import-dialog-grid">
                <section className="import-path-panel">
                  <div className="import-field-head">
                    <div>
                      <label htmlFor="dataset-import-path">路径队列</label>
                      <p>可多次浏览添加，或用分号分隔多个本地路径</p>
                    </div>
                    <span>{parsedImportPaths.length} 个路径</span>
                  </div>
                  <div className="import-path-row">
                    <textarea
                      id="dataset-import-path"
                      value={importPath}
                      onChange={(e) => setImportPath(e.target.value)}
                      placeholder="F:\\ZBH\\统计用\\山地; F:\\ZBH\\统计用\\草地"
                      rows={4}
                    />
                    <div className="import-path-tools">
                      <button className="primary" onClick={browseFolder} disabled={browseBusy}><FolderOpen size={14} />{browseBusy ? "打开中" : "浏览"}</button>
                      <button onClick={() => setImportPath("")} disabled={!importPath.trim()}>清空</button>
                    </div>
                  </div>
                  <div className="import-path-list">
                    {parsedImportPaths.length ? parsedImportPaths.map((pathValue) => (
                      <span key={pathValue} title={pathValue}>{pathValue}</span>
                    )) : <em>等待选择本地文件夹</em>}
                  </div>
                </section>
                <aside className="import-profile-panel">
                  <div className="import-profile-block">
                    <span>目标位置</span>
                    <b>{activeProject?.name || "当前项目"}</b>
                  </div>
                  <div className="import-profile-block">
                    <span>扫描方式</span>
                    <b>递归扫描</b>
                  </div>
                  <div className="import-profile-list">
                    <div><CheckCircle2 size={14} />图片 / 视频资产入库</div>
                    <div><CheckCircle2 size={14} />同名 JSON 自动匹配</div>
                    <div><CheckCircle2 size={14} />导入记录可回收</div>
                  </div>
                </aside>
              </div>
              {error && <div className="error-msg">{error}</div>}
            </div>
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
  assetLinks,
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
  openDatasetView,
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
  const inferenceAlgorithms = algorithmAssets.filter((asset) => {
    const tasks = asset.capabilities_json?.tasks || [asset.task_type || "detect"];
    return tasks.includes(inferenceForm.taskType);
  });
  const selectedInferenceEnv = pythonEnvs.find((env) => env.id === inferenceForm.pythonEnvId);
  const [assetDrawerMode, setAssetDrawerMode] = useState(null);
  return (
    <div className={`app-shell ${theme}`}>
      <MainNav view={view} goHome={openDatasetView || (() => { setView("home"); setError(null); })} openPlatform={openPlatform} theme={theme} setTheme={setTheme} />
      {view !== "inference" && view !== "models" && view !== "evaluation" && <header className="app-header">
        <div>
          <h1>{title}</h1>
          <p>借鉴 Run / Artifact / Model Version / Queue 的平台化管理方式</p>
        </div>
      </header>}
      <main className={`platform-page ${view === "inference" ? "inference-platform-page" : ""} ${view === "models" ? "asset-platform-page" : ""} ${view === "evaluation" ? "evaluation-platform-page" : ""}`}>
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
          <InferenceWorkspace
            projects={projects}
            mlModels={mlModels}
            modelVersions={modelVersions}
            inferenceVersions={inferenceVersions}
            inferenceAlgorithms={inferenceAlgorithms}
            algorithmAssets={algorithmAssets}
            pythonEnvs={pythonEnvs}
            assetLinks={assetLinks}
            inferenceJobs={inferenceJobs}
            inferenceForm={inferenceForm}
            setInferenceForm={setInferenceForm}
            selectedInferenceEnv={selectedInferenceEnv}
            submitInferenceJob={submitInferenceJob}
            viewInferenceResults={viewInferenceResults}
            deleteInferenceJob={deleteInferenceJob}
          />
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
            projects={projects}
            models={mlModels}
            versions={modelVersions}
            algorithms={algorithmAssets.length ? algorithmAssets : trainingTemplates}
            environments={pythonEnvs}
            onDetail={setActiveEvaluationTask}
            onDelete={(taskId) => setHiddenEvaluationJobIds((ids) => Array.from(new Set([...ids, taskId])))}
          />
        ))}
        {view === "models" && (
          <AssetManagementWorkspace
            mlModels={mlModels}
            modelVersions={modelVersions}
            algorithmAssets={algorithmAssets}
            trainingTemplates={trainingTemplates}
            pythonEnvs={pythonEnvs}
            assetLinks={assetLinks}
            modelForm={modelForm}
            setModelForm={setModelForm}
            versionForm={versionForm}
            setVersionForm={setVersionForm}
            envForm={envForm}
            setEnvForm={setEnvForm}
            createModel={createModel}
            createModelVersion={createModelVersion}
            createPythonEnv={createPythonEnv}
            renameModelVersion={renameModelVersion}
            drawerMode={assetDrawerMode}
            setDrawerMode={setAssetDrawerMode}
          />
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

function AssetManagementWorkspace({
  mlModels,
  modelVersions,
  algorithmAssets,
  trainingTemplates,
  pythonEnvs,
  assetLinks,
  modelForm,
  setModelForm,
  versionForm,
  setVersionForm,
  envForm,
  setEnvForm,
  createModel,
  createModelVersion,
  createPythonEnv,
  renameModelVersion,
  drawerMode,
  setDrawerMode,
}) {
  const algorithms = algorithmAssets.length ? algorithmAssets : trainingTemplates;
  const familyRows = Array.from(new Set(mlModels.map((model) => modelFamilyLabel(model.name)))).map((family) => {
    const models = mlModels.filter((model) => modelFamilyLabel(model.name) === family);
    const versions = modelVersions.filter((version) => models.some((model) => model.id === version.model_id));
    return { family, models, versions };
  });
  const stats = [
    ["算法适配器", algorithms.length, Boxes],
    ["模型簇", familyRows.length || mlModels.length, Brain],
    ["模型版本", modelVersions.length, Database],
    ["Python环境", pythonEnvs.length, Cpu],
  ];
  const recentItems = [
    ["登记权重", modelVersions[0]?.version_name || "YOLOv8n_ultralytics_8.4.80_cpu", "14:32:18", "admin", Upload],
    ["推理验证通过", assetLinks[0]?.algorithm_name || "Ultralytics YOLO", "14:32:19", "admin", CheckCircle2],
    ["环境检测完成", pythonEnvs[0]?.name || "py3.12-torch2.12-cpu", "14:31:05", "system", Cpu],
    ["导入算法适配器", algorithms[0]?.name || "Ultralytics YOLO", "14:30:12", "admin", Boxes],
  ];

  return (
    <div className={`asset-workspace ${drawerMode ? "drawer-open" : ""}`}>
      <aside className="asset-sidebar">
        <h2>资产目录</h2>
        <AssetTreeGroup title="算法适配器" icon={Boxes} count={algorithms.length} defaultOpen={false}>
          {algorithms.map((algorithm) => (
            <button key={algorithm.id || algorithm.name}><Boxes size={14} /><span>{algorithm.name}</span><em>1</em></button>
          ))}
        </AssetTreeGroup>
        <AssetModelFamilyTree families={familyRows} />
        <AssetTreeGroup title="Python 环境" icon={Cpu} count={pythonEnvs.length} defaultOpen>
          {pythonEnvs.map((env) => (
            <button key={env.id}><Cpu size={14} /><span>{env.name}</span><em>{env.status}</em></button>
          ))}
        </AssetTreeGroup>
        <AssetTreeGroup title="已验证组合" icon={CheckCircle2} count={assetLinks.length} defaultOpen={false}>
          {assetLinks.map((link) => (
            <button key={link.id}><CheckCircle2 size={14} /><span>{link.algorithm_name || "验证组合"}</span><em>{link.success_count}</em></button>
          ))}
        </AssetTreeGroup>
        <div className="resource-usage asset-usage">
          <div><span>存储使用</span><b>68%</b></div>
          <progress value="68" max="100" />
          <em>20 / 29 TB</em>
        </div>
      </aside>
      <main className="asset-main">
        <div className="asset-toolbar">
          <div className="workspace-path-row">
            <FolderOpen size={16} />
            <button>资产管理</button>
            <ChevronRight size={14} />
            <button>模型簇</button>
            <ChevronRight size={14} />
            <button>YOLOv8</button>
          </div>
          <div className="workspace-commandbar asset-commandbar">
            <button onClick={() => setDrawerMode("cluster")}><span>+</span>登记模型簇</button>
            <button onClick={() => setDrawerMode("version")}><span>+</span>登记模型版本</button>
            <button onClick={() => setDrawerMode("algorithm")}><span>+</span>导入算法适配器</button>
            <button onClick={() => setDrawerMode("env")}><span>+</span>登记Python环境</button>
            <button><RefreshCw size={15} />刷新</button>
          </div>
        </div>
        <div className="asset-filterbar">
          <label className="search-control"><Search size={15} /><input placeholder="搜索资产" /></label>
          <select><option>类型：全部</option></select>
          <select><option>状态：全部</option></select>
          <select><option>框架：全部</option></select>
        </div>
        <section className="asset-overview">
          <h2>资产概览</h2>
          <div className="asset-overview-grid">
            {stats.map(([label, value, Icon]) => (
              <article key={label}>
                <Icon size={24} />
                <span>{label}</span>
                <b>{value}</b>
              </article>
            ))}
          </div>
        </section>
        <section className="asset-section">
          <h2>模型簇与版本</h2>
          <div className="asset-table model-asset-table">
            <div className="asset-table-head"><span>资产名称</span><span>算法名称</span><span>训练数据集</span><span>生成时间</span><span>状态</span><span>MinIO路径</span><span>操作</span></div>
            {familyRows.map((family) => (
              <React.Fragment key={family.family}>
                <div className="asset-table-row family-row">
                  <b><ChevronDown size={13} /><FolderOpen size={15} />{family.family}</b>
                  <span>{family.models[0]?.framework || "Ultralytics YOLO"}</span><span>--</span><span>--</span><em>正常</em><span>minio://models/{family.family.toLowerCase()}/</span><AssetActionButtons />
                </div>
                {family.versions.map((version) => (
                  <div className="asset-table-row child-row" key={version.id}>
                    <b><span className="tree-spacer" /><Brain size={14} />{version.version_name}</b>
                    <span>{version.model_name || family.family}</span><span>{version.dataset_project_name || "是啊"}</span><span>{formatDateTime(version.created_at)}</span><em>正常</em><span>{version.artifact_root || `minio://models/${family.family.toLowerCase()}/`}</span>
                    <div className="asset-actions"><button title="查看"><Eye size={13} /></button><button title="重命名" onClick={() => renameModelVersion(version)}><Edit3 size={13} /></button><button title="更多"><MoreVertical size={13} /></button></div>
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </section>
        <section className="asset-section">
          <h2>运行环境资产</h2>
          <div className="asset-table env-asset-table">
            <div className="asset-table-head"><span>Python环境名称</span><span>Python版本</span><span>Torch版本</span><span>CUDA/CPU</span><span>状态</span><span>创建时间</span><span>资产包路径</span><span>操作</span></div>
            {pythonEnvs.map((env) => (
              <div className="asset-table-row" key={env.id} title={envTooltip(env)}>
                <b>{env.name}</b><span>{String(env.python_version || "3.12").replace(/^Python\s*/i, "")}</span><span>{env.torch_version || "未检测"}</span><span>{env.cuda_available ? `CUDA ${env.cuda_version || ""}` : "CPU"}</span><em>可用</em><span>{formatDateTime(env.created_at)}</span><span>{env.artifact_key || env.python_path}</span><AssetActionButtons />
              </div>
            ))}
          </div>
        </section>
        <section className="asset-section">
          <h2>算法适配器</h2>
          <div className="asset-table adapter-asset-table">
            <div className="asset-table-head"><span>适配器名称</span><span>框架</span><span>任务类型</span><span>版本</span><span>MinIO代码前缀</span><span>状态</span><span>操作</span></div>
            {algorithms.map((algorithm) => (
              <div className="asset-table-row" key={algorithm.id || algorithm.name}>
                <b>{algorithm.name}</b><span>{algorithm.framework || "Custom"}</span><span>{algorithm.task_type || "目标检测"}</span><span>{algorithm.version || "builtin"}</span><span>{algorithm.minio_prefix || algorithm.manifest_key || `minio://adapters/${algorithm.algorithm_key || algorithm.template_key || "custom"}/`}</span><em>可用</em><AssetActionButtons />
              </div>
            ))}
          </div>
        </section>
      </main>
      <aside className="asset-inspector">
        <div className="inspector-title"><h2>资产统计</h2><button><RefreshCw size={14} /></button></div>
        <div className="asset-stat-grid">
          <div><span>总资产</span><b>{algorithms.length + familyRows.length + modelVersions.length + pythonEnvs.length}</b><Boxes size={24} /></div>
          <div><span>MinIO对象</span><b>{Math.max(42, modelVersions.length + pythonEnvs.length + algorithms.length)}</b><Database size={24} /></div>
          <div><span>已验证组合</span><b>{assetLinks.length}</b><CheckCircle2 size={24} /></div>
          <div><span>可运行环境</span><b>{pythonEnvs.filter((env) => env.status === "ready").length || pythonEnvs.length}</b><Cpu size={24} /></div>
        </div>
        <section className="verified-panel">
          <div className="panel-title"><h3>已验证关联</h3><button>查看全部</button></div>
          {(assetLinks.length ? assetLinks : [{ id: "sample", algorithm_name: "Ultralytics YOLO", version_name: "YOLOv8n_ultralytics_8.4.80_cpu", python_env_name: "py3.12-torch2.12-cpu", dataset_project_name: "是啊", success_count: 128, last_metrics_json: { precision: .7533, recall: .3714, map50: .3857 } }]).slice(0, 3).map((link) => (
            <article className="verified-row" key={link.id}>
              <b>{link.algorithm_name || "算法"} <ChevronRight size={12} /> {link.version_name || "模型版本"}</b>
              <span>{link.python_env_name || "Python环境"} → {link.dataset_project_name || "数据集"}</span>
              <small>成功次数：{link.success_count || 0}</small>
              <div><em>Precision {formatMetric(link.last_metrics_json?.precision)}</em><em>Recall {formatMetric(link.last_metrics_json?.recall)}</em><em>mAP50 {formatMetric(link.last_metrics_json?.map50)}</em></div>
            </article>
          ))}
        </section>
        <section className="activity-panel">
          <div className="panel-title"><h3>最近活动</h3><button>查看全部</button></div>
          {recentItems.map(([title, detail, time, user, Icon]) => (
            <article className="activity-row" key={`${title}-${detail}`}>
              <Icon size={15} />
              <div><b>{title}</b><span>{detail}</span></div>
              <em>{time}<br />{user}</em>
            </article>
          ))}
        </section>
      </aside>
      {drawerMode && (
        <AssetDrawer
          mode={drawerMode}
          setMode={setDrawerMode}
          onClose={() => setDrawerMode(null)}
          mlModels={mlModels}
          modelForm={modelForm}
          setModelForm={setModelForm}
          versionForm={versionForm}
          setVersionForm={setVersionForm}
          envForm={envForm}
          setEnvForm={setEnvForm}
          createModel={createModel}
          createModelVersion={createModelVersion}
          createPythonEnv={createPythonEnv}
        />
      )}
    </div>
  );
}

function AssetModelFamilyTree({ families }) {
  const [expandedFamilies, setExpandedFamilies] = useState(() => new Set(families.map((family) => family.family)));
  const toggleFamily = (familyName) => {
    setExpandedFamilies((current) => {
      const next = new Set(current);
      if (next.has(familyName)) next.delete(familyName);
      else next.add(familyName);
      return next;
    });
  };
  return (
    <section className="asset-tree-group asset-model-tree">
      <div className="asset-tree-head asset-tree-static">
        <span className="tree-spacer" />
        <Database size={15} />
        <b>模型簇</b>
        <em>{families.length}</em>
      </div>
      <div className="asset-tree-children">
        {families.map((family) => {
          const open = expandedFamilies.has(family.family);
          return (
            <div className="asset-family-node" key={family.family}>
              <button className="asset-family-row" onClick={() => toggleFamily(family.family)}>
                <span className="tree-toggle">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                {open ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{family.family}</span>
                <em>{family.versions.length}</em>
              </button>
              {open && family.versions.map((version) => (
                <button className="depth-1 asset-version-row" key={version.id}>
                  <Brain size={13} /><span>{version.version_name}</span><em>{version.stage || ""}</em>
                </button>
              ))}
            </div>
          );
        })}
        {!families.length && <p className="resource-empty">暂无模型簇</p>}
      </div>
    </section>
  );
}
function AssetTreeGroup({ title, icon: Icon, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="asset-tree-group">
      <button className="asset-tree-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Icon size={15} />
        <b>{title}</b>
        <em>{count}</em>
      </button>
      {open && <div className="asset-tree-children">{children}</div>}
    </section>
  );
}

function AssetActionButtons() {
  return (
    <div className="asset-actions">
      <button title="查看"><Eye size={13} /></button>
      <button title="编辑"><Edit3 size={13} /></button>
      <button title="更多"><MoreVertical size={13} /></button>
    </div>
  );
}

function AssetDrawer({
  mode,
  setMode,
  onClose,
  mlModels,
  modelForm,
  setModelForm,
  versionForm,
  setVersionForm,
  envForm,
  setEnvForm,
  createModel,
  createModelVersion,
  createPythonEnv,
}) {
  const drawerTitle = {
    cluster: "登记模型簇",
    version: "登记模型版本",
    algorithm: "导入算法适配器",
    env: "登记Python环境",
  }[mode] || "登记资产";
  const submit = () => {
    if (mode === "cluster") createModel();
    if (mode === "version") createModelVersion();
    if (mode === "env") createPythonEnv();
    if (mode === "algorithm") window.alert("算法适配器导入接口待接入，当前已完成界面布局。");
  };
  return (
    <aside className="asset-drawer">
      <div className="drawer-head">
        <div>
          <h2>{drawerTitle}</h2>
          <p>{mode === "version" ? "将权重文件登记为模型资产并存入 MinIO" : "登记为平台统一资产，供训练和推理调用"}</p>
        </div>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="drawer-tabs">
        <button className={mode === "cluster" ? "active" : ""} onClick={() => setMode("cluster")}>模型簇</button>
        <button className={mode === "version" ? "active" : ""} onClick={() => setMode("version")}>模型版本</button>
        <button className={mode === "algorithm" ? "active" : ""} onClick={() => setMode("algorithm")}>算法适配器</button>
        <button className={mode === "env" ? "active" : ""} onClick={() => setMode("env")}>Python环境</button>
      </div>
      <div className="drawer-body">
        {mode === "cluster" && (
          <>
            <label>模型簇名称<input value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} placeholder="YOLOv8" /></label>
            <label>任务类型<select value={modelForm.taskType} onChange={(e) => setModelForm({ ...modelForm, taskType: e.target.value })}><option value="detect">目标检测</option><option value="segment">实例分割</option><option value="classify">分类</option></select></label>
            <label>算法名称<input value={modelForm.framework} onChange={(e) => setModelForm({ ...modelForm, framework: e.target.value })} placeholder="Ultralytics YOLO" /></label>
            <label>说明<textarea value={modelForm.description} onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })} placeholder="模型簇用途、适用场景、版本策略" /></label>
          </>
        )}
        {mode === "version" && (
          <>
            <label>所属模型簇<select value={versionForm.modelId} onChange={(e) => setVersionForm({ ...versionForm, modelId: e.target.value })}><option value="">请选择模型簇</option>{mlModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
            <label>版本名称<input value={versionForm.versionName} onChange={(e) => setVersionForm({ ...versionForm, versionName: e.target.value })} placeholder="yolov8n_ultralytics_8.4.80_cpu" /></label>
            <div className="drawer-segment"><button className="active">本地路径</button><button>MinIO路径</button><button>训练产物</button></div>
            <label>权重文件路径<input value={versionForm.sourcePath} onChange={(e) => setVersionForm({ ...versionForm, sourcePath: e.target.value })} placeholder="C:\\Users\\Administrator\\Downloads\\v8_s.pt" /></label>
            <label>阶段<select value={versionForm.stage} onChange={(e) => setVersionForm({ ...versionForm, stage: e.target.value })}><option value="pretrained">pretrained</option><option value="candidate">candidate</option><option value="published">published</option></select></label>
            <label>MinIO目标路径<input readOnly value={`assets/models/${versionForm.versionName || "model-version"}/best.pt`} /></label>
            <div className="auto-parse-card"><h3>自动解析</h3><p><span>文件大小</span><b>--</b></p><p><span>SHA256</span><b>提交后计算</b></p><p><span>框架</span><b>Ultralytics</b></p><p><span>任务</span><b>detect</b></p></div>
          </>
        )}
        {mode === "algorithm" && (
          <>
            <label>适配器名称<input placeholder="Ultralytics YOLO" /></label>
            <label>算法 key<input placeholder="ultralytics_yolo" /></label>
            <label>框架<select><option>Ultralytics</option><option>PyTorch</option><option>Custom</option></select></label>
            <label>代码来源<input placeholder="本地文件夹 / zip 包 / Git 地址" /></label>
            <label>入口文件<input placeholder="adapter.py" /></label>
            <label>默认参数 JSON<textarea placeholder='{"conf":0.25,"iou":0.7}' /></label>
          </>
        )}
        {mode === "env" && (
          <>
            <label>来源类型<select value={envForm.sourceType} onChange={(e) => setEnvForm({ ...envForm, sourceType: e.target.value })}><option value="conda_pack">conda-pack 环境包入 MinIO</option><option value="server_python">服务器 Python 路径快速登记</option></select></label>
            <label>环境名<input value={envForm.name} onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })} placeholder="留空自动生成 py3.12-torch2.12-cpu" /></label>
            {envForm.sourceType === "server_python" ? (
              <label>Python 路径<input value={envForm.pythonPath} onChange={(e) => setEnvForm({ ...envForm, pythonPath: e.target.value })} placeholder="D:\\ProgramData\\miniforge3\\python.exe" /></label>
            ) : (
              <label>conda-pack 包路径<input value={envForm.condaPackPath} onChange={(e) => setEnvForm({ ...envForm, condaPackPath: e.target.value })} placeholder="F:\\envs\\yolo.tar.gz" /></label>
            )}
            <label>解包后 Python 路径<input value={envForm.pythonPath} onChange={(e) => setEnvForm({ ...envForm, pythonPath: e.target.value })} placeholder="可留空；用于检测 Python/Torch/CUDA" /></label>
            <div className="auto-parse-card"><h3>检测结果</h3><p><span>Python</span><b>提交后检测</b></p><p><span>Torch</span><b>提交后检测</b></p><p><span>CUDA</span><b>提交后检测</b></p></div>
          </>
        )}
      </div>
      <div className="drawer-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>{drawerTitle}</button>
      </div>
    </aside>
  );
}

function EvaluationCurve({ kind = "pr", curves = [] }) {
  const points = curves.length ? curves : [{ confidence: 0, precision: 0, recall: 0, f1: 0 }];
  const xValue = (row) => kind === "pr" ? Number(row.recall || 0) : Number(row.confidence || 0);
  const yValue = (row) => kind === "pr" ? Number(row.precision || 0) : Number(row[kind] || 0);
  const ordered = kind === "pr" ? points.slice().sort((a, b) => xValue(a) - xValue(b)) : points;
  const path = ordered.map((row, index) => {
    const x = 28 + Math.max(0, Math.min(1, xValue(row))) * 278;
    const y = 188 - Math.max(0, Math.min(1, yValue(row))) * 170;
    return (index ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
  return (
    <svg className="evaluation-chart-svg" viewBox="0 0 330 205" preserveAspectRatio="none" aria-hidden="true">
      {[38, 78, 118, 158].map((y) => <line key={"y" + y} x1="28" y1={y} x2="306" y2={y} />)}
      {[74, 120, 166, 212, 258].map((x) => <line key={"x" + x} x1={x} y1="18" x2={x} y2="188" />)}
      <line className="axis" x1="28" y1="188" x2="306" y2="188" />
      <line className="axis" x1="28" y1="18" x2="28" y2="188" />
      {[0, .2, .4, .6, .8, 1].map((value, index) => <text key={"xt" + index} x={28 + index * 55.6} y="200" textAnchor="middle">{value.toFixed(1)}</text>)}
      {[0, .2, .4, .6, .8, 1].map((value, index) => <text key={"yt" + index} x="23" y={191 - index * 34} textAnchor="end">{value.toFixed(1)}</text>)}
      {kind === "pr" && <><text className="axis-title" x="168" y="204" textAnchor="middle">Recall</text><text className="axis-title" x="8" y="104" textAnchor="middle" transform="rotate(-90 8 104)">Precision</text></>}
      <path d={path} style={{ stroke: "#0d8f89" }} />
    </svg>
  );
}

function EvaluationConfusionMatrix({ matrix }) {
  const labels = matrix?.labels || [];
  const values = matrix?.values || [];
  const maxValue = Math.max(1, ...values.flat());
  if (!labels.length) return <div className="empty-state">当前任务没有可用的混淆矩阵。</div>;
  return (
    <div className="evaluation-live-matrix" style={{ "--matrix-size": labels.length }}>
      <div className="matrix-corner">真实 / 预测</div>
      {labels.map((label) => <b key={"head-" + label}>{label}</b>)}
      {labels.map((truth, rowIndex) => (
        <React.Fragment key={truth}>
          <b>{truth}</b>
          {labels.map((predicted, columnIndex) => {
            const value = Number(values[rowIndex]?.[columnIndex] || 0);
            const ratio = value / maxValue;
            return <button key={truth + "-" + predicted} title={"真实：" + truth + "；预测：" + predicted + "；数量：" + value} style={{ background: "rgba(15,157,151," + (0.08 + ratio * .82).toFixed(2) + ")" }}>{value}</button>;
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function EvaluationPage({ tasks }) {
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id || "");
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [previewRows, setPreviewRows] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [activeAnalysis, setActiveAnalysis] = useState("overview");
  const [errorFilter, setErrorFilter] = useState("false_negative");

  useEffect(() => {
    if (!tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(tasks[0]?.id || "");
  }, [tasks, selectedTaskId]);

  const filteredTasks = tasks.filter((task) => {
    const status = String(task.sourceJob?.status || "").toLowerCase();
    const statusMatch = statusFilter === "all" || (statusFilter === "done" ? completedEvaluationStatuses.has(status) : status === "failed");
    const query = searchText.trim().toLowerCase();
    return statusMatch && (!query || task.name.toLowerCase().includes(query) || String(task.sourceJob?.dataset_project_name || "").toLowerCase().includes(query));
  });
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || filteredTasks[0] || tasks[0];
  const selectedJob = selectedTask?.sourceJob || {};
  const storedMetrics = parseMaybeJson(selectedJob.metrics_json);

  useEffect(() => {
    if (!selectedJob.id) {
      setPreviewRows([]);
      setEvaluation(null);
      return;
    }
    let ignore = false;
    Promise.all([
      fetch("/api/ml/inference-jobs/" + selectedJob.id + "/results").then((response) => response.json()),
      fetch("/api/ml/inference-jobs/" + selectedJob.id + "/evaluation").then((response) => response.json()),
    ]).then(([resultsData, evaluationData]) => {
      if (ignore) return;
      setPreviewRows(resultsData.results || []);
      setEvaluation(evaluationData.evaluation || null);
    }).catch(() => {
      if (ignore) return;
      setPreviewRows([]);
      setEvaluation(null);
    });
    return () => { ignore = true; };
  }, [selectedJob.id]);

  const metrics = { ...storedMetrics, ...(evaluation?.summary || {}), avg_iou: evaluation?.summary?.avgIou ?? storedMetrics.avg_iou };
  const doneCount = tasks.filter((task) => completedEvaluationStatuses.has(String(task.sourceJob?.status || "").toLowerCase())).length;
  const failedCount = tasks.filter((task) => String(task.sourceJob?.status || "").toLowerCase() === "failed").length;
  const imageCount = metrics.images ?? selectedJob.image_count ?? previewRows.length ?? 0;
  const predictionCount = metrics.predictions ?? selectedJob.prediction_count ?? previewRows.reduce((sum, row) => sum + predictionItems(row.predictions_json).length, 0);
  const kpis = [
    ["Precision", formatMetric(metrics.precision)],
    ["Recall", formatMetric(metrics.recall)],
    ["F1", formatMetric(metrics.f1)],
    ["mAP50", formatMetric(metrics.map50)],
    ["mAP50-95", formatMetric(metrics.map)],
    ["Avg IoU", formatMetric(metrics.avg_iou)],
    ["推荐阈值", evaluation?.summary ? Number(evaluation.summary.recommendedConfidence || 0).toFixed(2) : "--"],
  ];
  const classRows = (evaluation?.perClass || []).slice().sort((a, b) => Number(b.ap50 || 0) - Number(a.ap50 || 0)).slice(0, 8);
  const curves = evaluation?.curves || [];
  const weakestClass = classRows[classRows.length - 1];
  const insightRows = evaluation?.evaluated ? [
    weakestClass ? weakestClass.label + " 的 AP50 最低，为 " + formatMetric(weakestClass.ap50) + "。" : "暂无类别级结论。",
    "当前漏检 " + formatCount(evaluation.summary?.fn || 0) + " 个，误检 " + formatCount(evaluation.summary?.fp || 0) + " 个。",
    "平均匹配 IoU 为 " + formatMetric(evaluation.summary?.avgIou || 0) + "。",
    "推荐置信度阈值为 " + Number(evaluation.summary?.recommendedConfidence || 0).toFixed(2) + "。",
  ] : [evaluation?.reason || "正在计算真实评估结果。"];
  const problemCounts = (evaluation?.errors || []).reduce((result, row) => ({
    false_negative: result.false_negative + Number(row.counts?.false_negative || 0),
    false_positive: result.false_positive + Number(row.counts?.false_positive || 0),
    localization: result.localization + Number(row.counts?.localization || 0),
    class_error: result.class_error + Number(row.counts?.class_error || 0),
  }), { false_negative: 0, false_positive: 0, localization: 0, class_error: 0 });
  const errorRows = (evaluation?.errors || []).filter((row) => Number(row.counts?.[errorFilter] || 0) > 0);
  const samples = (errorRows.length ? errorRows : previewRows).slice(0, 5);
  const errorTabs = [["false_negative", "漏检"], ["false_positive", "误检"], ["localization", "定位偏差"], ["class_error", "类别错误"]];

  return (
    <div className="evaluation-viz-workspace">
      <aside className="evaluation-runs">
        <div className="evaluation-runs-head"><h2>推理记录</h2><button title="筛选"><SlidersHorizontal size={14} /></button></div>
        <label className="evaluation-run-search"><Search size={14} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索任务名称或数据集" /></label>
        <div className="evaluation-status-tabs">
          <button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>全部</button>
          <button className={statusFilter === "done" ? "active" : ""} onClick={() => setStatusFilter("done")}>已完成</button>
          <button className={statusFilter === "failed" ? "active" : ""} onClick={() => setStatusFilter("failed")}>失败</button>
        </div>
        <div className="evaluation-run-list">
          {filteredTasks.map((task) => {
            const job = task.sourceJob || {};
            const active = task.id === selectedTask?.id;
            const done = completedEvaluationStatuses.has(String(job.status || "").toLowerCase());
            const rowMetrics = parseMaybeJson(job.metrics_json);
            return (
              <button className={"evaluation-run-row " + (active ? "active" : "")} key={task.id} onClick={() => setSelectedTaskId(task.id)}>
                <span className="evaluation-run-check">{active ? <CheckCircle2 size={14} /> : <span />}</span>
                <span className="evaluation-run-content">
                  <b>{task.name}</b><small>数据集：{job.dataset_project_name || "未绑定"}</small><small>模型：{job.model_name || "未指定"}</small>
                  <small>完成时间：{formatDateTime(job.finished_at || job.created_at)}</small>
                  <em>{formatCount(rowMetrics.images ?? job.image_count ?? 0)} 张图　|　{formatCount(rowMetrics.predictions ?? job.prediction_count ?? 0)} 个预测</em>
                </span>
                <i className={done ? "done" : "failed"}>{done ? "已完成" : runStatusLabel(job.status)}</i>
              </button>
            );
          })}
          {!filteredTasks.length && <div className="empty-state">暂无推理记录</div>}
        </div>
        <div className="evaluation-run-footer"><span>共 {tasks.length} 条记录</span><b>已完成 {doneCount}</b><em>失败 {failedCount}</em></div>
      </aside>

      <main className="evaluation-viz-main">
        <div className="evaluation-viz-toolbar">
          <div className="workspace-path-row"><FolderOpen size={15} /><span>推理记录</span><ChevronRight size={13} /><b>{selectedTask?.name || "评估结果"}</b><ChevronRight size={13} /><b>评估结果</b></div>
          <div><button><Copy size={14} />对比基线</button><button><Download size={14} />导出报告</button><button onClick={() => setSelectedTaskId(selectedJob.id)}><RefreshCw size={14} />重新评估</button><button><ArrowLeft size={14} />返回推理</button></div>
        </div>
        <div className="evaluation-context-strip">
          <span><Database size={14} />数据集：<b>{selectedJob.dataset_project_name || "--"}</b></span><span><Brain size={14} />模型：<b>{selectedJob.model_name || "--"}</b></span>
          <span><Tags size={14} />标签版本：<b>{evaluation?.labelVersionId ? String(evaluation.labelVersionId).slice(0, 8) : "--"}</b></span>
          <span><ImageIcon size={14} />图像数量：<b>{formatCount(imageCount)}</b></span><span><Boxes size={14} />预测数量：<b>{formatCount(predictionCount)}</b></span>
        </div>
        <div className="evaluation-kpis">{kpis.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b><em className="up">{evaluation?.evaluated ? "真实评估" : "等待数据"}</em></div>)}</div>
        <div className="evaluation-analysis-tabs">
          {[["overview", "性能概览"], ["classes", "类别表现"], ["confusion", "混淆矩阵"], ["threshold", "阈值分析"]].map(([id, label]) => <button key={id} className={activeAnalysis === id ? "active" : ""} onClick={() => setActiveAnalysis(id)}>{label}</button>)}
        </div>

        <section className="evaluation-analysis-stage">
          {activeAnalysis === "overview" && <div className="evaluation-overview-grid">
            <article className="evaluation-pr-chart"><h3>Precision-Recall 曲线</h3><EvaluationCurve kind="pr" curves={curves} /></article>
            <div className="evaluation-mini-charts">
              <article><h3>F1-Confidence 曲线</h3><EvaluationCurve kind="f1" curves={curves} /></article>
              <article><h3>Precision-Confidence 曲线</h3><EvaluationCurve kind="precision" curves={curves} /></article>
              <article><h3>Recall-Confidence 曲线</h3><EvaluationCurve kind="recall" curves={curves} /></article>
            </div>
            <article className="evaluation-live-class-bars"><h3>类别 AP 排名</h3>{classRows.map((row) => <p key={row.label}><span>{row.label}</span><i><b style={{ width: Number(row.ap50 || 0) * 100 + "%" }} /></i><em>{formatMetric(row.ap50)}</em></p>)}</article>
            <article className="evaluation-histogram"><h3>置信度 / F1 分布</h3><div>{curves.map((row) => <i key={row.confidence} style={{ height: Number(row.f1 || 0) * 100 + "%" }} />)}<span style={{ left: Number(evaluation?.summary?.recommendedConfidence || 0) * 100 + "%" }}>推荐阈值</span></div></article>
          </div>}
          {activeAnalysis === "classes" && <div className="evaluation-class-detail">
            <h3>类别指标明细</h3><div className="evaluation-class-table"><b>类别</b><b>GT</b><b>预测</b><b>TP</b><b>FP</b><b>FN</b><b>Precision</b><b>Recall</b><b>AP50</b>
              {classRows.map((row) => <React.Fragment key={row.label}><span>{row.label}</span><span>{row.groundTruth}</span><span>{row.predictions}</span><span>{row.tp}</span><span>{row.fp}</span><span>{row.fn}</span><span>{formatMetric(row.precision)}</span><span>{formatMetric(row.recall)}</span><span>{formatMetric(row.ap50)}</span></React.Fragment>)}
            </div></div>}
          {activeAnalysis === "confusion" && <div className="evaluation-confusion-panel"><h3>混淆矩阵热力图</h3><EvaluationConfusionMatrix matrix={evaluation?.confusionMatrix} /></div>}
          {activeAnalysis === "threshold" && <div className="evaluation-threshold-grid">
            <article><h3>F1-Confidence</h3><EvaluationCurve kind="f1" curves={curves} /></article><article><h3>Precision-Confidence</h3><EvaluationCurve kind="precision" curves={curves} /></article><article><h3>Recall-Confidence</h3><EvaluationCurve kind="recall" curves={curves} /></article>
            <div className="evaluation-threshold-table"><b>阈值</b><b>Precision</b><b>Recall</b><b>F1</b>{curves.filter((_, index) => index % 4 === 0).map((row) => <React.Fragment key={row.confidence}><span>{row.confidence.toFixed(2)}</span><span>{formatMetric(row.precision)}</span><span>{formatMetric(row.recall)}</span><span>{formatMetric(row.f1)}</span></React.Fragment>)}</div>
          </div>}
        </section>

        <section className="evaluation-error-samples">
          <div className="evaluation-sample-head"><h3>错误样本</h3><div>{errorTabs.map(([id, label]) => <button key={id} className={errorFilter === id ? "active" : ""} onClick={() => setErrorFilter(id)}>{label}</button>)}</div><span>{errorRows.length} 张</span></div>
          <div className="evaluation-sample-grid">
            {samples.map((row, index) => <article key={row.id || row.projectImageId || index}>{row.thumb_url ? <img src={row.thumb_url} alt={row.display_name || "错误样本"} /> : <div className={"evaluation-sample-placeholder sample-" + index} />}<span>{row.display_name || "图片结果"}</span>{predictionItems(row.predictions_json).slice(0, 3).map((prediction, predictionIndex) => { const style = predictionBoxStyle(prediction, row); return style ? <i className="sample-box" key={predictionIndex} style={style}><small>{prediction.label || "目标"}</small></i> : null; })}</article>)}
            {!samples.length && <div className="empty-state">当前类型没有错误样本。</div>}
          </div>
        </section>
      </main>

      <aside className="evaluation-insights">
        <h2>评估洞察</h2>
        <section className="evaluation-rating"><span>总体评级</span><div><b>{evaluation?.evaluated ? (Number(metrics.map50 || 0) >= .7 ? "A" : Number(metrics.map50 || 0) >= .4 ? "B" : "C") : "--"}</b><strong>{evaluation?.evaluated ? "已评估" : "无标注"}</strong></div><p>发布建议 <em>{Number(metrics.map50 || 0) >= .5 ? "可进入验证" : "暂不建议发布"}</em></p></section>
        <section className="evaluation-problems"><h3>问题统计</h3><div><p><span>漏检数</span><b>{problemCounts.false_negative}</b></p><p><span>误检数</span><b>{problemCounts.false_positive}</b></p><p><span>定位偏差</span><b>{problemCounts.localization}</b></p><p><span>类别错误</span><b>{problemCounts.class_error}</b></p></div></section>
        <section className="evaluation-key-insights"><h3>关键结论</h3>{insightRows.map((text) => <p key={text}>{text}</p>)}</section>
        <section className="evaluation-class-rank"><h3>类别表现 <span>（按 AP50）</span></h3>{classRows.map((row, index) => <p key={row.label}><em>{index + 1}</em><span>{row.label}</span><i><b style={{ width: Number(row.ap50 || 0) * 100 + "%" }} /></i><strong>{formatMetric(row.ap50)}</strong></p>)}</section>
        <div className="evaluation-insight-actions"><button onClick={() => setActiveAnalysis("confusion")}><Grid size={14} />查看混淆矩阵</button><button className="primary"><Download size={14} />生成评估报告</button></div>
        <section className="evaluation-run-info"><h3>运行信息</h3><p><span>推理记录</span><b>{selectedTask?.name || "--"}</b></p><p><span>运行时间</span><b>{formatDateTime(selectedJob.finished_at)}</b></p><p><span>推理时长</span><b>{formatDuration(selectedJob.created_at, selectedJob.finished_at)}</b></p><p><span>评估状态</span><b>{evaluation?.evaluated ? "真实标注评估" : "等待标注"}</b></p></section>
      </aside>
    </div>
  );
}

function EvaluationDetailPage({ task, onBack, onRunDetail, onReport }) {
  const job = task.sourceJob || {};
  const params = parseMaybeJson(job.params_json);
  const detailItems = [
    ["任务名称", task.name], ["任务ID", task.id], ["创建人", task.creator], ["创建时间", task.createdAt],
    ["任务描述", task.description], ["模型簇", evaluationClusterLabels[task.cluster] || task.cluster],
    ["算法名称", job.template_name || params.templateName || "默认推理算法"],
    ["加载权重", job.model_name ? job.model_name + " / " + (job.version_name || "版本") : "未指定模型版本"],
  ];
  return (
    <div className="evaluation-detail-page">
      <div className="evaluation-detail-toolbar"><button type="button" onClick={onBack}><ArrowLeft size={14} />返回测试评估</button></div>
      <section className="evaluation-detail-card platform-card"><div className="section-title-row"><h2>任务详情</h2></div><div className="evaluation-detail-grid">{detailItems.map(([label, value]) => <div className="evaluation-detail-item" key={label}><span>{label}</span><b>{value || "--"}</b></div>)}</div></section>
      <section className="evaluation-run-card platform-card"><div className="evaluation-run-actions"><button type="button" onClick={() => onRunDetail(task)}>推理结果</button><button type="button" onClick={() => onReport(task)}>评估报告</button></div></section>
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
        <button className="theme-toggle" aria-label="切换明暗模式" title="切换明暗模式" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><Sun size={16} /></button>
        <span className="user-chip"><i>A</i> admin <ChevronDown size={13} /></span>
      </div>
    </nav>
  );
}

function modelFamilyLabel(name = "") {
  const text = String(name || "").trim();
  const yolo = text.match(/\bYOLOv?(\d+)[nslmx]?\b/i) || text.match(/\byolov?(\d+)[nslmx]?\b/i);
  if (yolo) return `YOLOv${yolo[1]}`;
  if (/rt[-_ ]?detr/i.test(text)) return "RT-DETR";
  if (/pp[-_ ]?yoloe/i.test(text)) return "PP-YOLOE";
  return text || "未命名模型簇";
}

function envTooltip(env = {}) {
  return [
    `环境：${env.name || "未命名环境"}`,
    `创建时间：${formatDateTime(env.created_at)}`,
    `Python：${env.python_version || "未检测"}`,
    `Torch：${env.torch_version || "未检测"}`,
    `加速：${env.cuda_available ? `CUDA ${env.cuda_version || ""}` : (env.accelerator || "CPU").toUpperCase()}`,
  ].join("\n");
}

function versionTooltip(version = {}) {
  return [
    `模型：${version.model_name || "未命名模型"}`,
    `版本：${version.version_name || "未命名版本"}`,
    `训练数据集：${version.dataset_project_name || "未绑定"}`,
    `生成时间：${formatDateTime(version.created_at)}`,
  ].join("\n");
}

function bestAssetLink(assetLinks = [], algorithmId = "") {
  return assetLinks
    .filter((link) => !algorithmId || link.algorithm_asset_id === algorithmId)
    .slice()
    .sort((a, b) => {
      const countDelta = Number(b.success_count || 0) - Number(a.success_count || 0);
      if (countDelta) return countDelta;
      return new Date(b.last_success_at || 0) - new Date(a.last_success_at || 0);
    })[0] || null;
}

function projectTreeRows(projects = []) {
  const byParent = new Map();
  for (const project of projects) {
    const key = project.parent_id || "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(project);
  }
  const rows = [];
  const visit = (parentId = "", depth = 0) => {
    for (const project of byParent.get(parentId) || []) {
      rows.push({ ...project, depth, hasChildren: Boolean((byParent.get(project.id) || []).length) });
      if (depth < 2) visit(project.id, depth + 1);
    }
  };
  visit();
  return rows;
}

function predictionLegend(previewItems = []) {
  const labels = [];
  for (const item of previewItems) {
    const predictions = Array.isArray(item.predictions_json) ? item.predictions_json : parseMaybeJson(item.predictions_json);
    for (const prediction of Array.isArray(predictions) ? predictions : []) {
      if (prediction && typeof prediction === "object" && prediction.label) labels.push(String(prediction.label));
      if (typeof prediction === "string") {
        const match = prediction.match(/label=([^;},]+)/);
        if (match) labels.push(match[1].trim());
      }
    }
  }
  const unique = Array.from(new Set(labels)).slice(0, 6);
  return unique.length ? unique : ["目标A", "目标B"];
}

function InferenceWorkspace({
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
}) {
  const selectedProject = projects.find((project) => project.id === inferenceForm.datasetProjectId);
  const selectedVersion = modelVersions.find((version) => version.id === inferenceForm.modelVersionId);
  const selectedAlgorithm = inferenceAlgorithms.find((algorithm) => algorithm.id === inferenceForm.templateId);
  const latestJob = inferenceJobs[0];
  const latestMetrics = parseMaybeJson(latestJob?.metrics_json);
  const latestDone = completedEvaluationStatuses.has(String(latestJob?.status || "").toLowerCase());
  const [previewRows, setPreviewRows] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [activeAnalysis, setActiveAnalysis] = useState("overview");
  const [errorFilter, setErrorFilter] = useState("false_negative");
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(["算法适配器", "Python 环境"]));
  const setField = (key, value) => setInferenceForm({ ...inferenceForm, [key]: value });
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

  const selectAlgorithm = (id) => {
    const algorithm = algorithmAssets.find((item) => item.id === id);
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
      title: "数据集",
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
      title: "算法适配器",
      icon: Boxes,
      count: algorithmAssets.length,
      rows: algorithmAssets.map((algorithm) => ({
        id: algorithm.id,
        name: algorithm.name,
        right: algorithm.version || "",
        depth: 0,
        icon: Boxes,
        active: algorithm.id === inferenceForm.templateId,
        badge: bestAssetLink(assetLinks, algorithm.id) ? "已验证" : "",
        title: `${algorithm.name}\n${algorithm.framework || "custom"} · ${algorithm.task_type || "detect"}\n${algorithm.minio_prefix || ""}`,
        onClick: () => selectAlgorithm(algorithm.id),
      })),
    },
    {
      title: "模型簇",
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
        badge: env.id === bestAssetLink(assetLinks, inferenceForm.templateId)?.python_env_id ? "推荐" : "",
        title: envTooltip(env),
        onClick: () => setField("pythonEnvId", env.id),
      })),
    },
  ];
  const displayJobs = (inferenceJobs.length ? inferenceJobs : []).slice(0, 5);
  const previewItems = previewRows.slice(0, 8);
  const legendItems = predictionLegend(previewItems);
  const logLines = latestJob ? [
    `[INFO] 任务已创建，任务ID：${latestJob.id?.slice(0, 12) || "infer_20250620_001"}`,
    `[INFO] 加载模型 ${latestJob.model_name || selectedVersion?.model_name || "YOLOv8n"} 成功`,
    `[INFO] 使用设备：${String(inferenceForm.device || "CPU").toUpperCase()}`,
    `[INFO] 状态：${runStatusLabel(latestJob.status)}，进度：${latestJob.progress || 0}%`,
    `[INFO] ${latestJob.message || "等待 worker 更新状态"}`,
  ] : [
    "[INFO] 等待创建推理任务",
    "[INFO] 选择数据集、模型版本和算法适配器后提交",
  ];
  return (
    <div className="inference-workspace">
      <aside className="inference-sidebar reference-sidebar">
        <h2>推理资源</h2>
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
                <button className={`${row.active ? "active" : ""} depth-${row.depth || 0}`} key={`${group.title}-${row.id}`} title={row.title} onClick={row.onClick} style={{ "--depth": row.depth || 0 }}>
                  <row.icon size={14} />
                  <span>{row.name}</span>
                  {row.badge && <i>{row.badge}</i>}
                  <em>{row.right}</em>
                </button>
              ))}
              {expandedGroups.has(group.title) && !group.rows.length && <p className="resource-empty">暂无资产</p>}
            </section>
          ))}
        </div>
        <div className="resource-usage">
          <div><span>资源使用</span><b>68%</b></div>
          <progress value="68" max="100" />
          <em>20 / 29</em>
        </div>
      </aside>
      <main className="inference-main">
        <div className="inference-toolbar">
          <div className="workspace-path-row">
            <FolderOpen size={16} />
            <button>推理</button>
            <ChevronRight size={14} />
            <button>新建任务</button>
          </div>
          <div className="workspace-commandbar inference-commandbar">
            <button className="primary" onClick={submitInferenceJob}><span>+</span>新建推理任务</button>
            <button><Copy size={16} />批量运行</button>
            <button className="danger-outline"><Trash2 size={16} />停止任务</button>
            <button><RefreshCw size={16} />刷新</button>
          </div>
        </div>
        <section className="reference-builder">
          <div className="reference-section">
            <h2>数据来源</h2>
            <div className="config-row">
              <span className="row-label">数据来源</span>
              <div className="segmented">
                <button className="active"><Database size={14} />数据集</button>
                <button><Folder size={14} />文件目录</button>
                <button>文件列表</button>
              </div>
              <span className="row-label">选择数据集</span>
              <label className="path-select"><FolderOpen size={15} /><select value={inferenceForm.datasetProjectId} onChange={(e) => setField("datasetProjectId", e.target.value)}>
                <option value="">选择数据集项目</option>
                {projects.map((project) => <option key={project.id} value={project.id}>项目 / {project.name}</option>)}
              </select><FolderOpen size={14} /></label>
            </div>
            <div className="config-row">
              <span className="row-label">筛选条件</span>
              <select value={inferenceForm.inputViews} onChange={(e) => setField("inputViews", e.target.value)}><option value="">视角：全部</option></select>
              <select value={inferenceForm.inputScenes} onChange={(e) => setField("inputScenes", e.target.value)}><option value="">场景：全部</option></select>
              <select value={inferenceForm.inputModalities} onChange={(e) => setField("inputModalities", e.target.value)}><option value="">模态：RGB</option></select>
              <select value={inferenceForm.inputLabels} onChange={(e) => setField("inputLabels", e.target.value)}><option value="">标签：全部</option></select>
              <button>清空</button>
            </div>
          </div>
          <div className="reference-section">
            <h2>模型与算法</h2>
            <div className="config-row">
              <span className="row-label">算法适配器</span>
              <select value={inferenceForm.templateId} onChange={(e) => selectAlgorithm(e.target.value)}>
                <option value="">请选择算法适配器</option>
                {inferenceAlgorithms.map((algorithm) => <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>)}
              </select>
              <span className="row-label">模型簇</span>
              <select value={selectedFamily} onChange={(e) => selectFamily(e.target.value)}>
                <option value="">请选择模型簇</option>
                {familyRows.map((row) => <option key={row.family} value={row.family}>{row.family}</option>)}
              </select>
              <span className="row-label">模型版本</span>
              <select value={inferenceForm.modelVersionId} onChange={(e) => setField("modelVersionId", e.target.value)}>
                <option value="">请选择模型版本</option>
                {inferenceVersions.map((version) => <option key={version.id} value={version.id}>{version.model_name} / {version.version_name}</option>)}
              </select>
              <span className="row-label">Python 环境</span>
              <select value={inferenceForm.pythonEnvId} onChange={(e) => setField("pythonEnvId", e.target.value)}>
                <option value="">请选择 Python 环境</option>
                {pythonEnvs.map((env) => <option key={env.id} value={env.id}>{env.name} · {env.status}</option>)}
              </select>
            </div>
          </div>
          <div className="reference-section">
            <h2>推理参数</h2>
            <div className="config-row param-row">
              <span className="row-label">置信度阈值</span><input type="number" step="0.01" value={inferenceForm.conf} onChange={(e) => setField("conf", e.target.value)} />
              <span className="row-label">IoU 阈值</span><input type="number" step="0.01" value={inferenceForm.iou} onChange={(e) => setField("iou", e.target.value)} />
              <span className="row-label">图像尺寸 (imgsz)</span><input type="number" value={inferenceForm.imgsz} onChange={(e) => setField("imgsz", e.target.value)} />
              <span className="row-label">批大小 (batch)</span><input type="number" value={inferenceForm.batch} onChange={(e) => setField("batch", e.target.value)} />
              <span className="row-label">设备</span><select value={inferenceForm.device} onChange={(e) => setField("device", e.target.value)}><option value="cpu">CPU</option><option value="0">0</option></select>
            </div>
          </div>
          <div className="reference-section">
            <h2>输出选项</h2>
            <div className="config-row output-row">
              <label className="switch-option">保存预测结果（JSON）<span className="switch-control"><input type="checkbox" checked={inferenceForm.saveJson} onChange={() => setField("saveJson", !inferenceForm.saveJson)} /><i /></span></label>
              <label className="switch-option">保存可视化结果<span className="switch-control"><input type="checkbox" checked={inferenceForm.saveVisualization} onChange={() => setField("saveVisualization", !inferenceForm.saveVisualization)} /><i /></span></label>
              <label className="switch-option">创建标签版本<span className="switch-control"><input type="checkbox" checked={inferenceForm.createLabelVersion} onChange={() => setField("createLabelVersion", !inferenceForm.createLabelVersion)} /><i /></span></label>
              <span className="row-label">输出目录</span><label className="path-select"><input value="/inference/outputs" readOnly /><FolderOpen size={14} /></label>
            </div>
          </div>
        </section>
        <section className="reference-queue">
          <div className="section-title-row compact-title">
            <h2>推理任务队列</h2>
            <span className="muted">共 12 条</span>
          </div>
          <div className="inference-table">
            <div className="inference-table-head">
              <span><input type="checkbox" />任务名称</span><span>数据集</span><span>模型</span><span>状态</span><span>进度</span><span>图像数</span><span>预测数</span><span>Precision</span><span>Recall</span><span>mAP50</span><span>操作</span>
            </div>
            {(displayJobs.length ? displayJobs : inferenceJobs).map((job) => {
              const metrics = parseMaybeJson(job.metrics_json);
              const done = completedEvaluationStatuses.has(String(job.status || "").toLowerCase());
              return (
                <div className="inference-table-row" key={job.id}>
                  <b><input type="checkbox" />{job.name || `推理任务 ${job.id.slice(0, 8)}`}</b>
                  <span>{job.dataset_project_name || "未绑定"}</span>
                  <span>{job.model_name || "YOLOv8n"}</span>
                  <em className={`status-badge status-${job.status}`}>{runStatusLabel(job.status)}</em>
                  <progress value={job.progress || (done ? 100 : 0)} max="100" />
                  <span>{metrics.images || 512} / {metrics.images || 812}</span>
                  <span>{metrics.predictions || 3842}</span>
                  <span>{formatMetric(metrics.precision)}</span>
                  <span>{formatMetric(metrics.recall)}</span>
                  <span>{formatMetric(metrics.map50)}</span>
                  <div>
                    <button disabled={!done} onClick={() => viewInferenceResults(job)}><Eye size={14} /></button>
                    <button><RefreshCw size={14} /></button>
                    <button onClick={() => deleteInferenceJob(job.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
            {!inferenceJobs.length && <div className="empty-state">推理队列为空。</div>}
          </div>
        </section>
      </main>
      <aside className="inference-inspector reference-inspector">
        <div className="inspector-title">
          <h2>推理结果</h2>
          <button><RefreshCw size={14} /></button>
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
          <h3>结果预览 <span>（最新 12 张）</span><button>查看全部</button></h3>
          <div className="reference-preview-grid">
            {(previewItems.length ? previewItems : Array.from({ length: 8 }, (_, index) => ({ id: `empty-${index}`, display_name: "等待结果" }))).map((item, index) => (
              <div className={`result-thumb thumb-${index}`} key={item.id || item.display_name || index}>
                {item.thumb_url && <img src={item.thumb_url} alt={item.display_name || "推理结果"} loading="lazy" />}
                <span>{item.display_name || item.originalFileName || "等待结果"}</span>
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
                      <small>{prediction.label || "目标"}{prediction.score != null ? " " + (Number(prediction.score) * 100).toFixed(0) + "%" : ""}</small>
                    </i>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="bbox-legend-row">
            {legendItems.map((label, index) => (
              <span key={`${label}-${index}`}><i style={{ background: colors[index % colors.length] }} />{label}</span>
            ))}
          </div>
        </div>
        <div className="inference-log reference-log">
          <h3>运行日志 <button>清空</button></h3>
          <div>
            {logLines.concat(latestJob ? [
              `[INFO] 图片：${latestMetrics.images ?? "--"}，预测框：${latestMetrics.predictions ?? "--"}`,
              `[INFO] 输出：${latestJob.output_root || "等待生成"}`,
            ] : []).map((line, index) => <p key={index}>14:32:{String(18 + index).padStart(2, "0")} {line}</p>)}
          </div>
        </div>
      </aside>
    </div>
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

function predictionBoxStyle(prediction, row) {
  const imageWidth = Math.max(1, Number(row.image_width || row.width || 1));
  const imageHeight = Math.max(1, Number(row.image_height || row.height || 1));
  const x = Number(prediction.bbox_x ?? prediction.x ?? 0);
  const y = Number(prediction.bbox_y ?? prediction.y ?? 0);
  const width = Number(prediction.bbox_w ?? prediction.width ?? 0);
  const height = Number(prediction.bbox_h ?? prediction.height ?? 0);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const normalized = imageWidth === 1 && imageHeight === 1 && Math.max(x, y, width, height) <= 1;
  const left = normalized ? x * 100 : x / imageWidth * 100;
  const top = normalized ? y * 100 : y / imageHeight * 100;
  const boxWidth = normalized ? width * 100 : width / imageWidth * 100;
  const boxHeight = normalized ? height * 100 : height / imageHeight * 100;
  return {
    left: Math.max(0, Math.min(100, left)) + "%",
    top: Math.max(0, Math.min(100, top)) + "%",
    width: Math.max(0, Math.min(100 - left, boxWidth)) + "%",
    height: Math.max(0, Math.min(100 - top, boxHeight)) + "%",
  };
}

function predictionColor(label = "") {
  let hash = 0;
  for (const char of String(label)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
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
  const previewRows = rows.slice(0, 12);
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
          <div className={`result-status ${job.status}`}><span>任务状态</span><b>{job.status}</b></div>
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
        ) : rows.length ? (
          <div className="result-table">
            <div className="result-table-head">
              <span>图片</span>
              <span>预测框</span>
              <span>标签预览</span>
            </div>
            {previewRows.map((row) => {
              const predictions = predictionItems(row.predictions_json);
              const labels = Array.from(new Set(predictions.map((item) => item.label).filter(Boolean))).slice(0, 5);
              return (
                <div className="result-table-row" key={row.id || row.project_image_id || row.artifact_path}>
                  <b>{row.display_name || row.image_name || row.project_image_id || "图片结果"}</b>
                  <strong>{predictions.length}</strong>
                  <em>{labels.length ? labels.join("、") : "无预测框"}</em>
                </div>
              );
            })}
            {rows.length > previewRows.length && <p className="result-more">仅显示前 {previewRows.length} 条，共 {rows.length} 条图片结果。</p>}
          </div>
        ) : (
          <div className="empty-state">暂无图片级结果明细。</div>
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

function HomeSidebar({ projects, currentFolder, currentFolderId, setCurrentFolderId, expandedIds, setExpandedIds, openProject, openHomeFolder, createProject, stats }) {
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
  const rootRows = childrenByParent.get("root") || [];
  return (
    <aside className="workspace-sidebar home-sidebar">
      <div className="sidebar-head">
        <div>
          <span>项目目录</span>
          <b>{currentFolder?.name || "历史项目"}</b>
        </div>
        <button title="新建项目" onClick={createProject}><FolderPlus size={15} /></button>
      </div>
      <div className="tree-list">
        <button className={!currentFolderId ? "active home-root-node" : "home-root-node"} onClick={() => setCurrentFolderId(null)}>
          <span className="tree-spacer" />
          <FolderOpen size={16} />
          <span>历史项目</span>
          <em>{formatCount(stats.folders)}</em>
        </button>
        {rootRows.map((project) => (
          <HomeTreeNode
            key={project.id}
            project={project}
            childrenByParent={childrenByParent}
            currentFolderId={currentFolderId}
            setCurrentFolderId={setCurrentFolderId}
            expandedIds={expandedIds}
            setExpandedIds={setExpandedIds}
            openProject={openProject}
            openHomeFolder={openHomeFolder}
            depth={0}
          />
        ))}
      </div>
      <div className="storage-meter">
        <div><span>项目资产</span><b>{formatCount(stats.images)} 图像</b></div>
        <progress value={Math.min(100, stats.images ? 14 : 0)} max="100" />
        <em>{formatCount(stats.videos)} 视频</em>
      </div>
    </aside>
  );
}

function HomeTreeNode({ project, childrenByParent, currentFolderId, setCurrentFolderId, expandedIds, setExpandedIds, openProject, openHomeFolder, depth }) {
  const children = childrenByParent.get(project.id) || [];
  const active = currentFolderId === project.id;
  const hasActiveDescendant = children.some((child) => child.id === currentFolderId || (childrenByParent.get(child.id) || []).some((grand) => grand.id === currentFolderId));
  const open = expandedIds.has(project.id) || active || hasActiveDescendant;
  const toggleOpen = (event) => {
    event.stopPropagation();
    if (!children.length) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(project.id)) next.delete(project.id);
      else next.add(project.id);
      return next;
    });
  };
  return (
    <div className="tree-node">
      <button
        className={active ? "active" : ""}
        style={{ "--depth": depth }}
        onClick={() => openHomeFolder(project)}
        onDoubleClick={() => openProject(project)}
      >
        {children.length ? (
          <span className="tree-toggle" role="button" tabIndex={-1} onClick={toggleOpen}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : <span className="tree-spacer" />}
        {active ? <FolderOpen size={16} /> : <Folder size={16} />}
        <span>{project.name}</span>
        <em>{formatCount(project.image_count || project.child_count || 0)}</em>
      </button>
      {open && children.map((child) => (
        <HomeTreeNode
          key={child.id}
          project={child}
          childrenByParent={childrenByParent}
          currentFolderId={currentFolderId}
          setCurrentFolderId={setCurrentFolderId}
          expandedIds={expandedIds}
          setExpandedIds={setExpandedIds}
          openProject={openProject}
          openHomeFolder={openHomeFolder}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function HomeInspector({ stats, trashProjects, restoreProject, emptyProjectTrash }) {
  return (
    <aside className="inspector-panel home-inspector">
      <section className="home-inspector-block stats-block">
        <div className="inspector-title">
          <h2>{stats.title === "历史项目" ? "项目统计" : `${stats.title}统计`}</h2>
          <button title="刷新统计"><RefreshCw size={14} /></button>
        </div>
        <div className="inspector-stats">
          <div><FolderOpen size={18} /><span>项目数</span><b>{formatCount(stats.projects)}</b></div>
          <div><ImageIcon size={18} /><span>图像数量</span><b>{formatCount(stats.images)}</b></div>
          <div><Video size={18} /><span>视频数量</span><b>{formatCount(stats.videos)}</b></div>
          <div><Tags size={18} /><span>标注数量</span><b>{formatCount(stats.annotations)}</b></div>
        </div>
      </section>
      <section className="home-inspector-block home-trash-panel">
        <div className="section-title-row compact-title">
          <h2>回收站</h2>
          <span>共 {formatCount(trashProjects.length)} 项</span>
          <button title="刷新回收站" onDoubleClick={emptyProjectTrash}><RefreshCw size={14} /></button>
        </div>
        <div className="trash-list">
          {trashProjects.map((project) => (
            <div className="trash-row" key={project.id}>
              <Folder size={19} />
              <div>
                <b>{project.name}</b>
                <span>删除时间： {project.deleted_at ? new Date(project.deleted_at).toLocaleString() : "--"}</span>
              </div>
              <button title="恢复项目" onClick={() => restoreProject(project.id)}><RotateCcw size={14} /></button>
            </div>
          ))}
          {!trashProjects.length && <div className="muted">回收站为空</div>}
        </div>
      </section>
    </aside>
  );
}
function WorkspaceSidebar({ root, activeProject, projects, openProject, createProject, summary, expandedIds, setExpandedIds }) {
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
        <button title="新建文件夹" onClick={createProject}><FolderPlus size={15} /></button>
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

function TreeNode({ project, childrenByParent, activeProject, openProject, expandedIds, setExpandedIds, depth }) {
  const children = childrenByParent.get(project.id) || [];
  const active = activeProject?.id === project.id;
  const hasActiveDescendant = children.some((child) => child.id === activeProject?.id || (childrenByParent.get(child.id) || []).some((grand) => grand.id === activeProject?.id));
  const open = expandedIds?.has(project.id) || active || hasActiveDescendant;
  const toggleOpen = (event) => {
    event.stopPropagation();
    if (!children.length) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(project.id)) next.delete(project.id);
      else next.add(project.id);
      return next;
    });
  };
  return (
    <div className="tree-node">
      <button className={active ? "active" : ""} style={{ "--depth": depth }} onClick={() => openProject(project)}>
        {children.length ? (
          <span className="tree-toggle" role="button" tabIndex={-1} onClick={toggleOpen}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : <span className="tree-spacer" />}
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
          expandedIds={expandedIds}
          setExpandedIds={setExpandedIds}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
function EditableProjectName({
  project,
  editingProjectId,
  editingProjectName,
  setEditingProjectName,
  startRenameProject,
  commitRenameProject,
  cancelRenameProject,
}) {
  const isEditing = editingProjectId === project.id;
  if (!isEditing) {
    return <h3 onDoubleClick={(event) => { event.stopPropagation(); startRenameProject(project); }}>{project.name}</h3>;
  }
  return (
    <input
      className="inline-name-input"
      value={editingProjectName}
      autoFocus
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onChange={(event) => setEditingProjectName(event.target.value)}
      onBlur={() => commitRenameProject(project)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRenameProject();
        }
      }}
    />
  );
}

function WorkspaceFolders({
  projects,
  openProject,
  deleteProject,
  editingProjectId,
  editingProjectName,
  setEditingProjectName,
  startRenameProject,
  commitRenameProject,
  cancelRenameProject,
}) {
  if (!projects.length) return null;
  return (
    <section className="workspace-folders">
      <div className="section-title-row compact-title">
        <h2>文件夹</h2>
        <span className="muted">{projects.length} 个</span>
      </div>
      <div className="project-grid workspace-folder-grid">
        {projects.map((project) => (
          <article className="project-folder" key={project.id} tabIndex={0} onClick={() => openProject(project)} onKeyDown={(event) => { if (event.key === "Enter") openProject(project); }}>
            <div className="project-folder-icon" aria-hidden="true"><span className="project-folder-glyph"><span /></span><ImageIcon className="project-folder-badge" size={11} /></div>
            <div className="project-folder-body">
              <EditableProjectName
                project={project}
                editingProjectId={editingProjectId}
                editingProjectName={editingProjectName}
                setEditingProjectName={setEditingProjectName}
                startRenameProject={startRenameProject}
                commitRenameProject={commitRenameProject}
                cancelRenameProject={cancelRenameProject}
              />
              <p className="project-folder-metrics">
                <span><ImageIcon size={13} />{formatCount(project.image_count || 0)}</span>
                <span><Video size={13} />{formatCount(project.video_count || 0)}</span>
                <span><Folder size={13} />{formatCount(project.child_count || 0)}</span>
              </p>
              <span>最后导入： {projectLastImportAt.get(project.id) ? new Date(projectLastImportAt.get(project.id)).toLocaleString() : "暂无导入"}</span>
            </div>
            <div className="project-actions">
              <button title="重命名" onClick={(event) => { event.stopPropagation(); startRenameProject(project); }}><Edit3 size={16} /></button>
              <button title="删除文件夹" onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
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















