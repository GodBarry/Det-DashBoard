import { useMemo, useRef, useState } from "react";
import { recordDatasetActivity } from "./datasetActivityLog.js";

async function readImportResponse(response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(response.ok ? "导入服务返回了空响应" : `导入服务无响应（HTTP ${response.status}）`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`导入服务返回了无效响应（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(data?.error || data?.message || `导入失败（HTTP ${response.status}）`);
  return data;
}

function buildFailedImport(paths, message) {
  return {
    id: `client-failed-${Date.now()}`,
    status: "failed",
    message: message || "导入任务提交失败",
    error_message: message || "导入任务提交失败",
    source_path: paths.join("; "),
    progress: 100,
    processed_files: 0,
    total_files: 1,
  };
}

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
  const [importMode, setImportMode] = useState("merge_project");
  const [importStrategy, setImportStrategy] = useState("incremental");
  const [localFolder, setLocalFolder] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const localFolderInputRef = useRef(null);

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
    setLocalFolder(null);
    setUploadProgress(null);
    setError(null);
    setShowImportDialog(true);
  }

  function importDataFromHome() {
    if (currentFolder) {
      setImportPath("");
      setLocalFolder(null);
      setUploadProgress(null);
      setError(null);
      openProject(currentFolder);
      setShowImportDialog(true);
      return;
    }

    setError("请先打开一个具体项目后再导入数据集");
  }

  function browseLocalFolder() {
    setError(null);
    localFolderInputRef.current?.click();
  }

  function updateImportPath(value) {
    setLocalFolder(null);
    setUploadProgress(null);
    setImportPath(value);
  }

  function selectLocalFolder(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const firstRelativePath = files[0].webkitRelativePath || files[0].name;
    const rootName = firstRelativePath.split("/")[0] || "dataset";
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    setLocalFolder({ rootName, files, totalBytes });
    setImportPath("");
    setUploadProgress(null);
    setError(null);
  }

  async function browseServerFolder() {
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
    setLocalFolder(null);
    setDirPicker(null);
    setError(null);
  }

  async function uploadLocalFolder() {
    if (!activeProject || !localFolder?.files?.length) return;
    const { rootName, files, totalBytes } = localFolder;
    let uploadId = "";
    let completedFiles = 0;
    let completedBytes = 0;
    setError(null);
    setUploadProgress({ completedFiles: 0, totalFiles: files.length, completedBytes: 0, totalBytes });
    setLatestImport({ status: "uploading", message: `正在上传本机目录 ${rootName}`, progress: 0, processed_files: 0, total_files: files.length });
    try {
      const sessionResponse = await fetch("/api/import-uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootName, fileCount: files.length, totalBytes }),
      });
      const session = await readImportResponse(sessionResponse);
      uploadId = session.uploadId;
      const pending = [...files];
      const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (pending.length) {
          const file = pending.shift();
          const browserRelativePath = file.webkitRelativePath || file.name;
          const relativeParts = browserRelativePath.split("/");
          const relativePath = relativeParts.length > 1 ? relativeParts.slice(1).join("/") : file.name;
          const response = await fetch(`/api/import-uploads/${encodeURIComponent(uploadId)}/files?path=${encodeURIComponent(relativePath)}`, {
            method: "PUT",
            headers: { "content-type": "application/octet-stream" },
            body: file,
          });
          await readImportResponse(response);
          completedFiles += 1;
          completedBytes += file.size;
          const progress = Math.round((completedBytes / Math.max(1, totalBytes)) * 100);
          setUploadProgress({ completedFiles, totalFiles: files.length, completedBytes, totalBytes });
          setLatestImport({
            status: "uploading",
            message: `正在上传 ${completedFiles} / ${files.length} 个文件`,
            progress,
            processed_files: completedFiles,
            total_files: files.length,
          });
        }
      });
      await Promise.all(workers);
      const completeResponse = await fetch(`/api/import-uploads/${encodeURIComponent(uploadId)}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: activeProject.id, rename: true, importMode, importStrategy }),
      });
      const result = await readImportResponse(completeResponse);
      recordDatasetActivity("导入", `已上传并提交导入：${activeProject.name}`, "info", `${rootName}（${files.length} 个文件）`);
      setLatestImport(result.batch || null);
      setShowImportDialog(false);
      setLocalFolder(null);
      setUploadProgress(null);
      loadWorkspace(activeProject.id);
    } catch (err) {
      if (uploadId) fetch(`/api/import-uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => {});
      const message = err.message || "本机目录上传失败";
      setError(message);
      setLatestImport(buildFailedImport([rootName], message));
    }
  }

  function confirmImport() {
    if (localFolder?.files?.length) {
      uploadLocalFolder();
      return;
    }
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
      body: JSON.stringify({ projectId: activeProject.id, sourcePath: paths[0], sourcePaths: paths, rename: true, importMode, importStrategy }),
    })
      .then((r) => readImportResponse(r))
      .then((d) => {
        recordDatasetActivity("导入", `已提交导入：${activeProject.name}`, "info", paths.join("; "));
        setLatestImport(d.batch || null);
        loadWorkspace(activeProject.id);
      })
      .catch((err) => {
        recordDatasetActivity("导入", `导入失败：${activeProject.name}`, "error", `${paths.join("; ")}\n${err.message}`);
        setError(err.message);
        setLatestImport(buildFailedImport(paths, err.message));
      });
  }

  return {
    showImportDialog,
    setShowImportDialog,
    parsedImportPaths,
    localFolder,
    uploadProgress,
    localFolderInputRef,
    browseLocalFolder,
    selectLocalFolder,
    importMode,
    setImportMode,
    importStrategy,
    setImportStrategy,
    importPath,
    setImportPath,
    updateImportPath,
    browseFolder: browseServerFolder,
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
