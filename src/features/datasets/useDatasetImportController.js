import { useMemo, useState } from "react";

export function useDatasetImportController({
  activeProject,
  currentFolder,
  openProject,
  loadWorkspace,
  setLatestImport,
  appConfig,
  setError,
}) {
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [browseBusy, setBrowseBusy] = useState(false);
  const [dirPicker, setDirPicker] = useState(null);
  const [dirPickerBusy, setDirPickerBusy] = useState(false);

  function splitImportPaths(value) {
    return Array.from(new Set(String(value || "").split(";").map((item) => item.trim()).filter(Boolean)));
  }

  const parsedImportPaths = useMemo(() => splitImportPaths(importPath), [importPath]);

  function appendImportPath(pathValue) {
    if (!pathValue) return;

    setImportPath((current) => {
      const paths = splitImportPaths(current);
      if (!paths.includes(pathValue)) paths.push(pathValue);
      return paths.join("; ");
    });
  }

  function importData() {
    if (!activeProject) return;

    setImportPath("");
    setError(null);
    setShowImportDialog(true);
  }

  function importDataFromHome() {
    if (currentFolder) {
      setImportPath("");
      setError(null);
      openProject(currentFolder);
      setShowImportDialog(true);
      return;
    }

    setError("请先打开一个具体项目后再导入数据集");
  }

  async function browseFolder() {
    setError(null);
    const selectedPaths = splitImportPaths(importPath);
    const initialPath = selectedPaths[selectedPaths.length - 1] || (appConfig.browseAllDrives ? "__drives__" : appConfig.browseRootDisplay || "/");

    if (appConfig.nativeDialogMode === "disabled") {
      openDataRootPicker(initialPath);
      return;
    }

    setBrowseBusy(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 120000);
    const dialogBase = String(appConfig.hostDialogUrl || "").replace(/\/$/, "");
    const dialogQuery = `path=${encodeURIComponent(initialPath)}&title=${encodeURIComponent("选择要导入的数据文件夹")}`;
    const dialogUrl = dialogBase ? `${dialogBase}/api/dialog/folder?${dialogQuery}` : `/api/dialog/folder?purpose=import&${dialogQuery}`;

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
    fetch(`/api/fs/dirs?path=${encodeURIComponent(pathValue || (appConfig.browseAllDrives ? "__drives__" : appConfig.browseRootDisplay || appConfig.dataRootDisplay || appConfig.dataRoot))}`)
      .then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || "读取目录失败");
        setDirPicker(d);
      }))
      .catch((err) => setError(`读取数据根目录失败：${err.message}`))
      .finally(() => setDirPickerBusy(false));
  }

  function chooseDir(pathValue) {
    appendImportPath(pathValue);
    setDirPicker(null);
    setError(null);
  }

  function confirmImport() {
    const paths = splitImportPaths(importPath);

    if (!paths.length) {
      setError("请输入或选择数据文件夹路");
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
        if (status >= 400) throw new Error(d.error || "导入失败，请检查路径是否正");
        setLatestImport(d.batch || null);
        loadWorkspace(activeProject.id);
      })
      .catch((err) => {
        setError(err.message);
        setLatestImport(null);
      });
  }

  return {
    showImportDialog,
    setShowImportDialog,
    parsedImportPaths,
    importPath,
    setImportPath,
    browseFolder,
    browseBusy,
    confirmImport,
    dirPicker,
    setDirPicker,
    dirPickerBusy,
    openDataRootPicker,
    chooseDir,
    importData,
    importDataFromHome,
  };
}
