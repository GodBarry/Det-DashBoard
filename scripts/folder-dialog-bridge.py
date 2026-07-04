#!/usr/bin/env python3
"""Token-protected bridge that opens Zenity on the deployment host."""

import atexit
import json
import os
import pathlib
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


HOST = os.environ.get("FOLDER_DIALOG_HOST", "0.0.0.0")
PORT = int(os.environ.get("FOLDER_DIALOG_PORT", "4178"))
TOKEN = os.environ.get("FOLDER_DIALOG_TOKEN", "")
PID_FILE = pathlib.Path(os.environ.get("FOLDER_DIALOG_PID_FILE", pathlib.Path(__file__).resolve().parent.parent / "portable-data" / "folder-dialog.pid"))


def select_paths(mode: str, initial_path: str) -> dict:
    initial = pathlib.Path(initial_path).expanduser()
    if not initial.exists():
        initial = pathlib.Path.home()
    if initial.is_file():
        initial = initial.parent
    titles = {
        "folder": "选择要导入的数据文件夹",
        "file": "选择要导入的数据文件",
        "files": "选择多个要导入的数据文件",
    }
    args = ["zenity", "--file-selection", "--title", titles[mode], "--filename", f"{initial}/"]
    if mode == "folder":
        args.insert(2, "--directory")
    elif mode == "files":
        args[2:2] = ["--multiple", "--separator=\n"]
    try:
        completed = subprocess.run(args, capture_output=True, text=True, timeout=120, check=False)
    except FileNotFoundError:
        return {"status": "unavailable", "selectedPath": "", "selectedPaths": [], "error": "未安装 zenity"}
    except subprocess.TimeoutExpired:
        return {"status": "failed", "selectedPath": "", "selectedPaths": [], "error": "系统文件选择器打开超时"}
    paths = [value.strip() for value in completed.stdout.splitlines() if value.strip()]
    if completed.returncode == 0 and paths:
        return {"status": "selected", "selectedPath": paths[0], "selectedPaths": paths, "error": ""}
    if completed.returncode == 1:
        return {"status": "cancelled", "selectedPath": "", "selectedPaths": [], "error": ""}
    return {"status": "failed", "selectedPath": "", "selectedPaths": [], "error": completed.stderr.strip() or f"系统选择器退出码：{completed.returncode}"}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if not TOKEN or self.headers.get("X-Dialog-Token") != TOKEN:
            self.send_json(403, {"status": "failed", "error": "无效的桥接凭据"})
            return
        parsed = urlparse(self.path)
        if parsed.path != "/api/dialog/select":
            self.send_json(404, {"status": "failed", "error": "not found"})
            return
        query = parse_qs(parsed.query)
        mode = query.get("mode", ["folder"])[0]
        if mode not in {"folder", "file", "files"}:
            mode = "folder"
        initial_path = query.get("initialPath", [str(pathlib.Path.home())])[0]
        self.send_json(200, select_paths(mode, initial_path))

    def log_message(self, format_string: str, *args) -> None:
        print(f"dialog-bridge: {format_string % args}", flush=True)


def cleanup() -> None:
    try:
        if PID_FILE.read_text(encoding="utf-8").strip() == str(os.getpid()):
            PID_FILE.unlink()
    except OSError:
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    atexit.register(cleanup)
    print(f"Folder dialog bridge listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
