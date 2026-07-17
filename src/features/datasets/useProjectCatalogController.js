import { useMemo, useState } from "react";

import {
  buildHomeStats,
  buildProjectBreadcrumbs,
  buildProjectById,
  buildProjectLastImportAt,
  getCreateProjectContext,
} from "./project-catalog-core.js";

export function useProjectCatalogController({
  fetch: fetchRequest,
  prompt,
  confirm,
  withScope,
  datasetScope,
  view,
  currentFolderId,
  setCurrentFolderId,
  setView,
  setError,
  consumeRestoredActiveProjectId,
  resetWorkspace,
}) {
  const [projects, setProjects] = useState([]);
  const [trashProjects, setTrashProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [homeExpandedIds, setHomeExpandedIds] = useState(() => new Set());

  const projectById = useMemo(() => buildProjectById(projects), [projects]);
  const projectLastImportAt = useMemo(() => buildProjectLastImportAt(projects), [projects]);
  const currentFolder = currentFolderId ? projectById.get(currentFolderId) : null;
  const visibleProjects = useMemo(
    () => projects.filter((project) => (project.parent_id || null) === (currentFolderId || null)),
    [projects, currentFolderId],
  );
  const breadcrumbs = useMemo(
    () => buildProjectBreadcrumbs(currentFolder, projectById, 3),
    [currentFolder, projectById],
  );
  const activeChildProjects = useMemo(
    () => activeProject ? projects.filter((project) => (project.parent_id || null) === activeProject.id) : [],
    [projects, activeProject],
  );
  const activeBreadcrumbs = useMemo(
    () => buildProjectBreadcrumbs(activeProject, projectById, 4),
    [activeProject, projectById],
  );
  const workspaceRoot = activeBreadcrumbs[0] || activeProject;
  const homeStats = useMemo(
    () => buildHomeStats(currentFolder, projects, trashProjects),
    [currentFolder, projects, trashProjects],
  );

  function refreshHome() {
    fetchRequest(withScope("/api/projects", datasetScope)).then((r) => r.json()).then((d) => {
      const rows = d.projects || [];
      setProjects(rows);
      setActiveProject((current) => {
        const projectId = consumeRestoredActiveProjectId(current?.id);
        return projectId ? rows.find((project) => project.id === projectId) || null : null;
      });
      setCurrentFolderId((current) => current && rows.some((project) => project.id === current) ? current : null);
    }).catch(() => {});

    fetchRequest("/api/projects/trash").then((r) => r.json()).then((d) => setTrashProjects(d.projects || [])).catch(() => {});
  }

  function createProject() {
    const context = getCreateProjectContext({
      view,
      activeProject,
      activeBreadcrumbs,
      breadcrumbs,
      currentFolderId,
    });

    if (context.depth >= 3) {
      setError("项目本身计为第 1 级，最多只能创建到第 3 级文件夹");
      return;
    }

    const name = prompt(
      context.isWorkspace ? "请输入新建文件夹名称" : "请输入项目名称或路径（最多 3 级，例如：任务A/批次1/样本集）",
      context.isWorkspace ? "新建文件" : "新建项目",
    );
    if (!name) return;

    if (/[\\/]/.test(name)) {
      setError("请一次只创建一个项目或文件夹，名称不能包含路径分隔");
      return;
    }

    fetchRequest("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, parentId: context.parentId }),
    })
      .then((r) => r.json().then((data) => {
        if (!r.ok) throw new Error(data.error || "新建项目失败");
        return data;
      }))
      .then((data) => {
        if (!context.isWorkspace && data.project?.parent_id) setCurrentFolderId(data.project.parent_id);
        refreshHome();
      })
      .catch((err) => setError(err.message));
  }

  function deleteProject(projectId) {
    if (!confirm("确定删除该项目或文件夹吗？其下级文件夹会一并进入回收站；可在回收站恢复，清空回收站后将永久删除")) return;
    fetchRequest(`/api/projects/${projectId}`, { method: "DELETE" }).then(() => refreshHome());
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

    fetchRequest(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json().then((data) => {
        if (!r.ok) throw new Error(data.error || "重命名失");
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
    fetchRequest(`/api/projects/${projectId}/restore`, { method: "POST" }).then(() => refreshHome());
  }

  function restoreAllProjects() {
    if (!trashProjects.length) return;
    if (!confirm(`确定恢复回收站中的 ${trashProjects.length} 个项目吗？`)) return;

    Promise.all(trashProjects.map((project) => fetchRequest(`/api/projects/${project.id}/restore`, { method: "POST" })))
      .then(() => refreshHome())
      .catch((err) => setError("恢复全部项目失败：" + err.message));
  }

  function deleteProjectPermanently(projectId) {
    if (!confirm("确定永久删除该项目及其子文件夹吗？该操作不可恢复")) return;

    fetchRequest(`/api/projects/${projectId}/permanent`, { method: "DELETE" })
      .then((response) => response.json().catch(() => ({})).then((data) => {
        if (!response.ok) throw new Error(data.error || "永久删除项目失败");
        refreshHome();
      }))
      .catch((err) => setError(err.message || "永久删除项目失败"));
  }

  function emptyProjectTrash() {
    if (!trashProjects.length) return;
    if (!confirm(`确定清空项目回收站吗？将永久删除 ${trashProjects.length} 个项目及其不再被引用的数据。`)) return;

    fetchRequest("/api/projects/trash/empty", { method: "DELETE" })
      .then(() => refreshHome())
      .catch((err) => setError("清空项目回收站失败：" + err.message));
  }

  function openProject(project) {
    setActiveProject(project);
    setCurrentFolderId(project.id);
    setView("workspace");
    resetWorkspace();
    setError(null);
  }

  function goHome() {
    setView("home");
    setActiveProject(null);
    setCurrentFolderId(null);
    setError(null);
    refreshHome();
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

  function openHomeFolder(project) {
    const hasChildren = Number(project?.child_count || 0) > 0;
    const hasAssets = Number(project?.image_count || 0) > 0 || Number(project?.video_count || 0) > 0;

    if (!hasChildren && hasAssets) {
      openProject(project);
      return;
    }

    setCurrentFolderId(project.id);
  }

  function openDatasetView() {
    setError(null);
    setActiveProject(null);
    setCurrentFolderId(null);
    setView("home");
    refreshHome();
  }

  return {
    activeBreadcrumbs,
    activeChildProjects,
    activeProject,
    breadcrumbs,
    cancelRenameProject,
    commitRenameProject,
    createProject,
    currentFolder,
    deleteProject,
    deleteProjectPermanently,
    editingProjectId,
    editingProjectName,
    emptyProjectTrash,
    goHome,
    goUpFolder,
    homeExpandedIds,
    homeStats,
    openDatasetView,
    openHomeFolder,
    openProject,
    projectById,
    projectLastImportAt,
    projects,
    refreshHome,
    restoreAllProjects,
    restoreProject,
    setActiveProject,
    setEditingProjectName,
    setHomeExpandedIds,
    startRenameProject,
    trashProjects,
    visibleProjects,
    workspaceRoot,
  };
}
