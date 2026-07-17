const defaultFs = require("fs");
const defaultPath = require("path");
const defaultChildProcess = require("child_process");

function createPathService(options = {}) {
  const config = options.config || {};
  const fs = options.fs || defaultFs;
  const path = options.path || defaultPath;
  const childProcess = options.child_process || options.childProcess || defaultChildProcess;
  const platform = config.platform || process.platform;

  const {
    dataRoot,
    dataRootDisplay,
    browseRoot,
    browseRootDisplay,
    browseAllDrives,
    hostPathMode,
  } = config;

  function isInsideRoot(root, target) {
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  function isWindowsHostPathMode() {
    return hostPathMode === "windows";
  }

  function windowsHostPathToInternal(value, internalRoot) {
    if (!isWindowsHostPathMode()) return null;
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (raw === "/" || raw === "\\") return path.resolve(internalRoot);
    const driveMatch = raw.match(/^([A-Za-z]):[\\/]*(.*)$/);
    const slashDriveMatch = raw.match(/^\/([A-Za-z])(?:\/(.*))?$/);
    const match = driveMatch || slashDriveMatch;
    if (!match) return null;
    const drive = match[1].toUpperCase();
    const rest = String(match[2] || "").replace(/\\/g, "/").split("/").filter(Boolean);
    return path.resolve(internalRoot, drive, ...rest);
  }

  function internalToWindowsHostPath(value, internalRoot) {
    if (!isWindowsHostPathMode()) return null;
    const resolved = path.resolve(value || "");
    if (!isInsideRoot(internalRoot, resolved)) return null;
    const relative = path.relative(internalRoot, resolved);
    if (!relative) return "/";
    const parts = relative.split(path.sep).filter(Boolean);
    const drive = parts.shift();
    if (!/^[A-Za-z]$/.test(drive || "")) return null;
    return parts.length ? `${drive.toUpperCase()}:\\${parts.join("\\")}` : `${drive.toUpperCase()}:\\`;
  }

  function pathMappings() {
    return [
      { internal: dataRoot, display: dataRootDisplay },
      { internal: browseRoot, display: browseRootDisplay },
    ];
  }

  function bestMappingFor(value, key) {
    const resolved = path.resolve(value || "");
    return pathMappings()
      .filter((mapping) => isInsideRoot(mapping[key], resolved))
      .sort((a, b) => b[key].length - a[key].length)[0] || null;
  }

  function toInternalDataPath(value) {
    const windowsBrowsePath = windowsHostPathToInternal(value, browseRoot);
    if (windowsBrowsePath) return windowsBrowsePath;
    const windowsDataPath = windowsHostPathToInternal(value, dataRoot);
    if (windowsDataPath) return windowsDataPath;
    const resolved = path.resolve(value || dataRoot);
    const internalMapping = bestMappingFor(resolved, "internal");
    if (internalMapping) return resolved;
    const displayMapping = bestMappingFor(resolved, "display");
    if (displayMapping) {
      const relative = path.relative(displayMapping.display, resolved);
      return path.resolve(displayMapping.internal, relative);
    }
    return resolved;
  }

  function toDisplayDataPath(value) {
    const resolved = path.resolve(value || dataRoot);
    const windowsBrowsePath = internalToWindowsHostPath(resolved, browseRoot);
    if (windowsBrowsePath) return windowsBrowsePath;
    const windowsDataPath = internalToWindowsHostPath(resolved, dataRoot);
    if (windowsDataPath) return windowsDataPath;
    const internalMapping = bestMappingFor(resolved, "internal");
    if (internalMapping) {
      const relative = path.relative(internalMapping.internal, resolved);
      return path.resolve(internalMapping.display, relative);
    }
    return resolved;
  }

  function toScopedInternalPath(value, internalRoot, displayRoot) {
    const windowsPath = windowsHostPathToInternal(value, internalRoot);
    if (windowsPath) return windowsPath;
    const resolved = path.resolve(value || displayRoot);
    if (isWindowsHostPathMode() && (value === "/" || value == null || value === "")) {
      return path.resolve(internalRoot);
    }
    if (isInsideRoot(internalRoot, resolved)) return resolved;
    if (isInsideRoot(displayRoot, resolved)) {
      return path.resolve(internalRoot, path.relative(displayRoot, resolved));
    }
    return resolved;
  }

  function listFolders(target, scope = "browse") {
    const root = scope === "data" ? dataRoot : browseRoot;
    const displayRoot = scope === "data" ? dataRootDisplay : browseRootDisplay;
    const allDrives = scope === "browse" && browseAllDrives && platform === "win32";
    if (allDrives && (!target || target === "__drives__")) {
      const dirs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        .split("")
        .map((letter) => `${letter}:\\`)
        .filter((drive) => fs.existsSync(drive))
        .map((drive) => ({ name: drive, path: drive }));
      return { root: "__drives__", current: "__drives__", parent: "", dirs };
    }
    const current = toScopedInternalPath(target || displayRoot, root, displayRoot);
    const stat = fs.statSync(current);
    if (!stat.isDirectory()) {
      const error = new Error("路径必须是文件夹");
      error.statusCode = 400;
      throw error;
    }
    const dirs = fs.readdirSync(current, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = path.join(current, entry.name);
        return { name: entry.name, path: toDisplayDataPath(fullPath) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    const parent = path.dirname(current);
    return {
      root: displayRoot,
      current: toDisplayDataPath(current),
      parent: allDrives && parent === current
        ? "__drives__"
        : (parent && parent !== current && (allDrives || isInsideRoot(root, parent))
          ? toDisplayDataPath(parent)
          : ""),
      dirs,
    };
  }

  function psQuote(value) {
    return `'${String(value || "").replace(/'/g, "''")}'`;
  }

  function runFolderDialog(command, args, timeoutMs = 120000) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = childProcess.spawn(command, args, { windowsHide: true });
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish({ status: "failed", selectedPath: "", error: "系统文件夹选择器打开超时" });
      }, timeoutMs);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => finish({ status: "unavailable", selectedPath: "", error: error.message }));
      child.on("close", (code) => {
        if (code === 0 && stdout.trim()) {
          finish({ status: "selected", selectedPath: stdout.trim(), error: "" });
          return;
        }
        if (code === 1) {
          finish({ status: "cancelled", selectedPath: "", error: "" });
          return;
        }
        finish({ status: "failed", selectedPath: "", error: stderr.trim() || `文件夹选择器退出码：${code}` });
      });
    });
  }

  async function selectFolder(defaultPath, description) {
    if (platform === "linux") {
      const initialDir = fs.existsSync(defaultPath || "") ? defaultPath : dataRoot;
      return runFolderDialog("zenity", [
        "--file-selection",
        "--directory",
        "--title",
        description || "选择数据文件夹",
        "--filename",
        path.join(initialDir, path.sep),
      ]);
    }

    if (platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        `$dialog.Description = ${psQuote(description || "Select folder")}`,
        `$dialog.SelectedPath = ${psQuote(defaultPath || dataRoot)}`,
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath; exit 0 } else { exit 1 }",
      ].join("; ");
      return runFolderDialog("powershell.exe", ["-NoProfile", "-STA", "-Command", script]);
    }

    return { status: "unavailable", selectedPath: "", error: `暂不支持 ${platform} 系统文件夹选择器` };
  }

  return {
    isInsideRoot,
    isWindowsHostPathMode,
    windowsHostPathToInternal,
    internalToWindowsHostPath,
    pathMappings,
    bestMappingFor,
    toInternalDataPath,
    toDisplayDataPath,
    toScopedInternalPath,
    listFolders,
    runFolderDialog,
    selectFolder,
  };
}

module.exports = { createPathService };
