import { useEffect, useRef, useState } from "react";

import {
  buildTerminalImportRefreshKey,
  buildWorkspaceSearchParams,
  createDatasetWorkspaceFilters,
  DATASET_WORKSPACE_PAGE_SIZE,
  DATASET_WORKSPACE_POLL_INTERVAL,
  findRunningImport,
} from "./dataset-workspace-core.js";

const requestWithFetch = (...args) => fetch(...args);

export function useDatasetWorkspaceController({
  activeProject,
  currentUser,
  consumeRestoredSelected,
  setError,
  fetch: request = requestWithFetch,
}) {
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [imports, setImports] = useState([]);
  const [trashImports, setTrashImports] = useState([]);
  const [latestImport, setLatestImport] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState(createDatasetWorkspaceFilters);
  const [page, setPage] = useState(1);
  const [exportFormat, setExportFormat] = useState("labelme");
  const [viewerIndex, setViewerIndex] = useState(null);
  const [checkedIds, setCheckedIds] = useState([]);
  const [lastCheckedId, setLastCheckedId] = useState(null);
  const importRefreshKeyRef = useRef("");

  useEffect(() => {
    if (!activeProject) return;

    loadWorkspace(activeProject.id);
  }, [activeProject, page, filters]);

  useEffect(() => {
    if (!currentUser) return;

    const timer = window.setInterval(() => {
      request("/api/jobs").then((response) => response.json()).then((data) => setJobs(data.jobs || [])).catch(() => {});

      if (activeProject) {
        loadImports(activeProject.id);
        loadSummary(activeProject.id);
      } else {
        setLatestImport(null);
      }
    }, DATASET_WORKSPACE_POLL_INTERVAL);

    return () => window.clearInterval(timer);
  }, [activeProject, currentUser?.id]);

  useEffect(() => {
    if (!activeProject) return;

    const refreshKey = buildTerminalImportRefreshKey(activeProject, imports);

    if (!refreshKey || importRefreshKeyRef.current === refreshKey) return;

    importRefreshKeyRef.current = refreshKey;
    loadWorkspace(activeProject.id);
  }, [activeProject, imports]);

  function loadWorkspace(projectId) {
    const params = buildWorkspaceSearchParams(page, filters);

    request(`/api/projects/${projectId}/images?${params}`).then((response) => response.json()).then((data) => {
      setItems(data.items || []);
      setTotalItems(Number(data.total) || 0);

      const restoredSelected = consumeRestoredSelected(data.items);

      if (restoredSelected) {
        setSelected(restoredSelected);
        return;
      }

      if (!selected && data.items?.[0]) setSelected(data.items[0]);
      if (selected && !data.items?.some((item) => item.id === selected.id)) setSelected(data.items?.[0] || null);

      setCheckedIds((ids) => ids.filter((id) => data.items?.some((item) => item.id === id)));
    }).catch(() => {});

    loadSummary(projectId);
    loadImports(projectId);
  }

  function resetWorkspace() {
    setPage(1);
    setSelected(null);
    setItems([]);
    setTotalItems(0);
    setSummary(null);
    setCheckedIds([]);
  }

  function loadSummary(projectId) {
    request(`/api/projects/${projectId}/summary`).then((response) => response.json()).then((data) => setSummary(data.summary || null)).catch(() => {});
  }

  function loadImports(projectId) {
    request(`/api/projects/${projectId}/imports`).then((response) => response.json()).then((data) => {
      const rows = data.imports || [];

      setImports(rows);
      setLatestImport(findRunningImport(rows));
    }).catch(() => {});

    request(`/api/projects/${projectId}/imports?trash=1`).then((response) => response.json()).then((data) => setTrashImports(data.imports || [])).catch(() => {});
  }

  function cancelLatestImport() {
    if (!latestImport?.id) return;

    if (!window.confirm("确定取消当前导入任务吗？已经导入的文件会保留在本次导入记录中，可稍后删除本次导入")) return;

    request(`/api/imports/${latestImport.id}/cancel`, { method: "POST" })
      .then((response) => response.json())
      .then(() => setLatestImport({ ...latestImport, status: "cancel_requested", message: "正在取消导入" }))
      .catch((error) => setError("取消导入失败: " + error.message));
  }

  function deleteImport(importId) {
    if (!window.confirm("删除本次导入后会进入导入回收站，是否继续")) return;

    request(`/api/imports/${importId}`, { method: "DELETE" }).then(() => activeProject && loadWorkspace(activeProject.id));
  }

  function restoreImport(importId) {
    request(`/api/imports/${importId}/restore`, { method: "POST" }).then(() => activeProject && loadWorkspace(activeProject.id));
  }

  function emptyImportTrash() {
    if (!activeProject || !trashImports.length) return;

    if (!window.confirm(`确定清空导入回收站吗？将永久删除 ${trashImports.length} 条导入记录及其不再被引用的数据。`)) return;

    request(`/api/projects/${activeProject.id}/imports/trash/empty`, { method: "DELETE" })
      .then(() => loadWorkspace(activeProject.id))
      .catch((error) => setError("清空导入回收站失败：" + error.message));
  }

  function exportProject() {
    if (!activeProject) return;

    setError(null);

    request(`/api/projects/${activeProject.id}/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: exportFormat }),
    })
      .then((response) => response.json().then((data) => {
        if (!response.ok) throw new Error(data.error || "导出失败");
        return data;
      }))
      .catch((error) => setError("导出失败: " + error.message));
  }

  function openWorkspaceTrash() {
    const records = document.querySelector(".records-panel");

    if (records) {
      records.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setError("当前目录暂无导入回收站；项目回收站可在首页管理");
  }

  function deleteCheckedImages() {
    if (!activeProject || !checkedIds.length) return;

    if (!window.confirm(`确定删除选中的 ${checkedIds.length} 张图片吗？删除后不会物理删除对象存储中的原图，只会从当前项目预览中移除。`)) return;

    request(`/api/projects/${activeProject.id}/images/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: checkedIds }),
    })
      .then((response) => response.json())
      .then((data) => {
        setCheckedIds([]);
        setError(`已删除 ${data.deleted || 0} 张图片`);
        loadWorkspace(activeProject.id);
      })
      .catch((error) => setError("删除图片失败: " + error.message));
  }

  return {
    cancelLatestImport,
    checkedIds,
    deleteCheckedImages,
    deleteImport,
    emptyImportTrash,
    exportFormat,
    exportProject,
    filters,
    imports,
    items,
    totalItems,
    jobs,
    lastCheckedId,
    latestImport,
    loadWorkspace,
    openWorkspaceTrash,
    page,
    pageSize: DATASET_WORKSPACE_PAGE_SIZE,
    resetWorkspace,
    restoreImport,
    selected,
    setCheckedIds,
    setExportFormat,
    setFilters,
    setImports,
    setItems,
    setJobs,
    setLastCheckedId,
    setLatestImport,
    setPage,
    setSelected,
    setSummary,
    setTrashImports,
    setViewerIndex,
    summary,
    trashImports,
    viewerIndex,
  };
}
