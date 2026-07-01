const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const host = "127.0.0.1";
const port = Number(process.env.FOLDER_DIALOG_PORT || 4178);
const pidFile = path.join(__dirname, "..", "portable-data", "folder-dialog.pid");
const allowedOrigins = new Set(
  String(process.env.FOLDER_DIALOG_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function sendJson(res, statusCode, body, origin = "") {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (allowedOrigins.has(origin)) headers["access-control-allow-origin"] = origin;
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(body));
}

function selectFolder(initialPath, title) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const initialDir = fs.existsSync(initialPath) ? initialPath : "/";
    const child = spawn("zenity", [
      "--file-selection",
      "--directory",
      "--title",
      title,
      "--filename",
      path.join(initialDir, path.sep),
    ]);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ status: "failed", selectedPath: "", error: "系统文件夹选择器打开超时" });
    }, 120000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ status: "unavailable", selectedPath: "", error: error.message }));
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) return finish({ status: "selected", selectedPath: stdout.trim(), error: "" });
      if (code === 1) return finish({ status: "cancelled", selectedPath: "", error: "" });
      finish({ status: "failed", selectedPath: "", error: stderr.trim() || `文件夹选择器退出码：${code}` });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (!allowedOrigins.has(origin)) return sendJson(res, 403, { status: "failed", error: "不允许的请求来源" });
  if (req.method !== "GET" || req.url !== "/api/dialog/folder") {
    return sendJson(res, 404, { status: "failed", error: "not found" }, origin);
  }
  const result = await selectFolder("/", "选择要导入的数据文件夹");
  sendJson(res, 200, result, origin);
});

server.listen(port, host, () => {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid));
  console.log(`Folder dialog bridge listening on http://${host}:${port}`);
});

function cleanupPidFile() {
  try {
    if (fs.readFileSync(pidFile, "utf8").trim() === String(process.pid)) fs.unlinkSync(pidFile);
  } catch {}
}

process.on("exit", cleanupPidFile);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
