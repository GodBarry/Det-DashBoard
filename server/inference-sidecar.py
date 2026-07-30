#!/usr/bin/env python3
"""Host-side controller for the 4180 inference receiver.

Run this in the GPU Python environment, then point INFERENCE_SIDECAR_URL at it.
"""
import argparse
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROCESS = None
DETAILS = {}


def reply(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/inference-server/status":
            running = PROCESS is not None and PROCESS.poll() is None
            return reply(self, 200, {"running": running, "pid": PROCESS.pid if running else None, **DETAILS})
        return reply(self, 404, {"error": "not found"})

    def do_POST(self):
        global PROCESS, DETAILS
        size = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(size).decode("utf-8") or "{}")
        except ValueError:
            return reply(self, 400, {"error": "invalid JSON"})
        if self.path == "/inference-server/stop":
            if PROCESS and PROCESS.poll() is None:
                PROCESS.terminate()
            PROCESS, DETAILS = None, {}
            return reply(self, 200, {"ok": True, "running": False})
        if self.path != "/inference-server/start":
            return reply(self, 404, {"error": "not found"})
        if PROCESS and PROCESS.poll() is None:
            return reply(self, 409, {"error": "推理服务已运行", "pid": PROCESS.pid, **DETAILS})
        required = ["weights", "receiverId", "callbackUrl", "callbackToken"]
        missing = [key for key in required if not body.get(key)]
        if missing:
            return reply(self, 400, {"error": f"缺少参数: {', '.join(missing)}"})
        script = Path(__file__).with_name("inference-server.py")
        command = [sys.executable, str(script), "--weights", str(body["weights"]), "--host", str(body.get("host", "0.0.0.0")), "--port", str(body.get("port", 4180)), "--device", str(body.get("device", "0")), "--conf", str(body.get("conf", 0.25)), "--iou", str(body.get("iou", 0.7)), "--imgsz", str(body.get("imgsz", 640)), "--receiver-id", str(body["receiverId"]), "--callback-url", str(body["callbackUrl"]), "--callback-token", str(body["callbackToken"]), "--storage-root", str(STORAGE_ROOT)]
        PROCESS = subprocess.Popen(command, start_new_session=True)
        DETAILS = {"port": int(body.get("port", 4180)), "weights": body["weights"], "modelName": Path(body["weights"]).name, "receiverId": body["receiverId"]}
        return reply(self, 200, {"ok": True, "running": True, "pid": PROCESS.pid, **DETAILS})

    def log_message(self, *_):
        return


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=4178)
    parser.add_argument("--storage-root", default="./portable-data/storage")
    options = parser.parse_args()
    STORAGE_ROOT = str(Path(options.storage_root).resolve())
    ThreadingHTTPServer((options.host, options.port), Handler).serve_forever()
