#!/usr/bin/env python3
"""
Det-DashBoard 推理/训练 HTTP 侧车服务 (sidecar)

在宿主机上运行，使用本地 Python 环境（含 ultralytics + PyTorch + CUDA），
为容器内的 app 提供推理和训练能力。

启动方式:
  python server/inference-sidecar.py --port 4178 --storage-root ./portable-data/storage

API:
  POST /infer     — 执行 YOLO 推理
  POST /train     — 执行 YOLO 训练
  GET  /health    — 健康检查
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler


# ── 全局配置 ──────────────────────────────────────────────────────────────

STORAGE_ROOT = os.path.abspath("./portable-data/storage")
PYTHON_BIN = sys.executable  # 使用当前 Python 解释器

# ── 推理服务管理 ──────────────────────────────────────────────────────────

INFERENCE_SERVER_PROC = None
INFERENCE_SERVER_PORT = 4180
INFERENCE_SERVER_WEIGHTS = ""
INFERENCE_SERVER_LOG = "/tmp/det-dashboard-inference-server.log"

def _resolve_weights_fallback(requested):
    """权重文件不存在时尝试智能查找."""
    import glob
    candidates = []

    # 1. 在 artifact_root 目录及其上级目录递归查找 .pt 文件
    requested_dir = os.path.dirname(requested)
    for search_root in [requested_dir, os.path.dirname(requested_dir)]:
        if os.path.isdir(search_root):
            for root, dirs, files in os.walk(search_root):
                for f in files:
                    if f.endswith(".pt"):
                        candidates.append(os.path.join(root, f))
                if candidates:
                    break
        if candidates:
            break

    # 2. 检查常见 fallback 路径
    fallback_dirs = [
        os.path.expanduser("~/Models"),
        os.path.expanduser("~/models"),
    ]
    for d in fallback_dirs:
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith(".pt"):
                    candidates.append(os.path.join(d, f))

    # 返回第一个找到的
    if candidates:
        chosen = candidates[0]
        print(f"[sidecar] 权重 fallback: {requested} -> {chosen}", flush=True)
        return chosen
    return ""

def start_inference_server(weights, port=4180, conf=0.25, iou=0.7, imgsz=640, device="cpu", host="0.0.0.0"):
    """启动 FastAPI 推理服务子进程."""
    global INFERENCE_SERVER_PROC, INFERENCE_SERVER_PORT, INFERENCE_SERVER_WEIGHTS

    if INFERENCE_SERVER_PROC is not None and INFERENCE_SERVER_PROC.poll() is None:
        return {"ok": False, "error": "推理服务已在运行", "pid": INFERENCE_SERVER_PROC.pid}

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inference-server.py")
    if not os.path.exists(script):
        return {"ok": False, "error": f"推理服务脚本不存在: {script}"}

    # 翻译容器路径到宿主机路径
    weights = resolve_storage(weights)

    # 智能 fallback：权重文件不存在时尝试查找
    if not os.path.isfile(weights):
        resolved = _resolve_weights_fallback(weights)
        if resolved:
            weights = resolved
        else:
            return {"ok": False, "error": f"权重文件不存在: {weights}"}

    INFERENCE_SERVER_PORT = port
    INFERENCE_SERVER_WEIGHTS = weights

    cmd = [
        PYTHON_BIN, script,
        "--port", str(port),
        "--host", host,
        "--weights", weights,
        "--conf", str(conf),
        "--iou", str(iou),
        "--imgsz", str(imgsz),
        "--device", device,
    ]

    with open(INFERENCE_SERVER_LOG, "w") as log_file:
        INFERENCE_SERVER_PROC = subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    # 等待就绪
    for _ in range(30):
        time.sleep(0.5)
        if INFERENCE_SERVER_PROC.poll() is not None:
            return {"ok": False, "error": f"推理服务启动失败 (exit={INFERENCE_SERVER_PROC.returncode})", "pid": INFERENCE_SERVER_PROC.pid}
        try:
            import urllib.request
            resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
            if resp.status == 200:
                return {"ok": True, "pid": INFERENCE_SERVER_PROC.pid, "port": port, "weights": weights}
        except Exception:
            pass

    return {"ok": False, "error": "推理服务启动超时", "pid": INFERENCE_SERVER_PROC.pid}


def stop_inference_server():
    """停止推理服务."""
    global INFERENCE_SERVER_PROC
    if INFERENCE_SERVER_PROC is None:
        return {"ok": False, "error": "推理服务未运行"}
    if INFERENCE_SERVER_PROC.poll() is not None:
        returncode = INFERENCE_SERVER_PROC.returncode
        INFERENCE_SERVER_PROC = None
        return {"ok": True, "stopped": True, "wasAlreadyStopped": True, "exitCode": returncode}

    pid = INFERENCE_SERVER_PROC.pid
    try:
        INFERENCE_SERVER_PROC.terminate()
        INFERENCE_SERVER_PROC.wait(timeout=5)
    except subprocess.TimeoutExpired:
        INFERENCE_SERVER_PROC.kill()
        INFERENCE_SERVER_PROC.wait()
    returncode = INFERENCE_SERVER_PROC.returncode
    INFERENCE_SERVER_PROC = None
    return {"ok": True, "stopped": True, "pid": pid, "exitCode": returncode}


def inference_server_status():
    """获取推理服务状态."""
    global INFERENCE_SERVER_PROC
    running = INFERENCE_SERVER_PROC is not None and INFERENCE_SERVER_PROC.poll() is None
    status = {
        "running": running,
        "pid": INFERENCE_SERVER_PROC.pid if INFERENCE_SERVER_PROC else None,
        "port": INFERENCE_SERVER_PORT if running else None,
        "weights": INFERENCE_SERVER_WEIGHTS if running else "",
        "modelName": os.path.basename(INFERENCE_SERVER_WEIGHTS) if running else "",
    }
    if running:
        try:
            import urllib.request
            resp = urllib.request.urlopen(f"http://127.0.0.1:{INFERENCE_SERVER_PORT}/health", timeout=2)
            if resp.status == 200:
                health_data = json.loads(resp.read().decode())
                status["health"] = health_data
        except Exception:
            status["health"] = None
    return status


# ── 工具函数 ──────────────────────────────────────────────────────────────

def send_json(handler, status, data):
    body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if length == 0:
        raise ValueError("empty request body")
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def resolve_storage(container_path):
    """将容器内路径 (/data/storage/...) 翻译为宿主机路径."""
    if container_path.startswith("/data/storage/"):
        return os.path.join(STORAGE_ROOT, container_path[len("/data/storage/"):])
    if container_path.startswith("/data/storage"):
        return STORAGE_ROOT
    return container_path


# ── 推理 ──────────────────────────────────────────────────────────────────

def run_inference(payload):
    """执行 YOLO 推理，payload 使用容器内路径，内部自动翻译."""
    weights = resolve_storage(payload["weights"])
    manifest_path = resolve_storage(payload["manifestPath"])
    output_path = resolve_storage(payload["outputPath"])
    conf = float(payload.get("conf", 0.25))
    iou = float(payload.get("iou", 0.7))
    imgsz = int(payload.get("imgsz", 640))
    batch = int(payload.get("batch", 1))
    device = str(payload.get("device", "0"))

    # 检查关键文件
    if not os.path.exists(weights):
        raise FileNotFoundError(f"权重文件不存在: {weights}")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"manifest 不存在: {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    images = manifest.get("images") or []
    cache_root = manifest.get("cacheRoot") or os.path.dirname(manifest_path)

    image_paths = []
    by_abs = {}
    for item in images:
        local_path = item.get("localPath") or item.get("cachedFileName")
        abs_path = local_path if os.path.isabs(str(local_path)) else os.path.join(cache_root, str(local_path))
        abs_path = os.path.normpath(abs_path)
        # 翻译容器路径
        abs_path = resolve_storage(abs_path)
        image_paths.append(abs_path)
        by_abs[os.path.abspath(abs_path)] = item

    # 运行推理
    from ultralytics import YOLO

    model = YOLO(weights)
    names = getattr(model, "names", {}) or {}

    rows = []
    for abs_path in image_paths:
        results = model.predict(
            source=abs_path, conf=conf, iou=iou, imgsz=imgsz,
            batch=1, device=device, verbose=False, stream=True,
        )
        result = next(iter(results))
        source_path = os.path.abspath(str(getattr(result, "path", "") or ""))
        item = by_abs.get(source_path) or by_abs.get(
            os.path.abspath(os.path.normpath(source_path))
        ) or {}

        preds = []
        boxes = getattr(result, "boxes", None)
        if boxes is not None:
            xyxy = boxes.xyxy.cpu().tolist() if getattr(boxes, "xyxy", None) is not None else []
            confs = boxes.conf.cpu().tolist() if getattr(boxes, "conf", None) is not None else [None] * len(xyxy)
            clss = boxes.cls.cpu().tolist() if getattr(boxes, "cls", None) is not None else [None] * len(xyxy)
            for idx, coords in enumerate(xyxy):
                x1, y1, x2, y2 = [float(v) for v in coords]
                cls_id = int(clss[idx]) if clss[idx] is not None else -1
                label = names.get(cls_id, str(cls_id)) if isinstance(names, dict) else str(cls_id)
                preds.append({
                    "label": label,
                    "score": None if confs[idx] is None else float(confs[idx]),
                    "bbox_x": x1, "bbox_y": y1,
                    "bbox_w": max(0.0, x2 - x1), "bbox_h": max(0.0, y2 - y1),
                    "class_id": cls_id,
                })
        rows.append({
            "index": item.get("index"),
            "cachedFileName": item.get("cachedFileName"),
            "projectImageId": item.get("projectImageId"),
            "imageAssetId": item.get("imageAssetId"),
            "originalFileName": item.get("originalFileName") or os.path.basename(source_path),
            "width": item.get("width"),
            "height": item.get("height"),
            "predictions": preds,
        })

    payload_out = {
        "format": "det-dashboard.predictions.v1",
        "algorithm": "ultralytics_yolo",
        "jobId": payload.get("jobId"),
        "imageCount": len(rows),
        "predictionCount": sum(len(r["predictions"]) for r in rows),
        "images": rows,
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload_out, f, ensure_ascii=False, indent=2)

    return {
        "imageCount": payload_out["imageCount"],
        "predictionCount": payload_out["predictionCount"],
        "outputPath": output_path,
    }


# ── 训练 ──────────────────────────────────────────────────────────────────

def run_training(payload):
    """执行 YOLO 训练."""
    python = payload.get("python", PYTHON_BIN)
    data_yaml = payload["dataYaml"]
    model = payload.get("model", "yolov8n.pt")
    epochs = int(payload.get("epochs", 100))
    imgsz = int(payload.get("imgsz", 640))
    batch = int(payload.get("batch", 16))
    device = str(payload.get("device", "0"))
    project = payload.get("project", ".")
    name = payload.get("name", "run")
    task_type = payload.get("taskType", "detect")

    # 翻译路径
    data_yaml = resolve_storage(data_yaml)
    project = resolve_storage(project)

    cmd = [
        python, "-c", "from ultralytics.cfg import entrypoint; entrypoint()",
        task_type, "train",
        f"data={data_yaml}",
        f"model={model}",
        f"epochs={epochs}",
        f"imgsz={imgsz}",
        f"batch={batch}",
        f"project={project}",
        f"name={name}",
        "exist_ok=True",
    ]
    if device:
        cmd.append(f"device={device}")

    os.makedirs(project, exist_ok=True)

    proc = subprocess.run(
        cmd,
        cwd=project,
        capture_output=True,
        text=True,
        timeout=payload.get("timeout", 86400),
    )

    return {
        "exitCode": proc.returncode,
        "stdout": proc.stdout[-5000:],
        "stderr": proc.stderr[-5000:],
        "project": project,
        "name": name,
    }


# ── HTTP 处理器 ───────────────────────────────────────────────────────────

class RequestHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {args[0]}", flush=True)

    def do_GET(self):
        if self.path == "/health":
            send_json(self, 200, {"status": "ok", "python": sys.version, "storageRoot": STORAGE_ROOT})
        elif self.path == "/inference-server/status":
            send_json(self, 200, inference_server_status())
        elif self.path == "/inference-server/logs":
            try:
                with open(INFERENCE_SERVER_LOG, "r") as f:
                    content = f.read()[-10000:]
                send_json(self, 200, {"ok": True, "logs": content})
            except FileNotFoundError:
                send_json(self, 200, {"ok": True, "logs": ""})
        else:
            send_json(self, 404, {"error": "not found"})

    def do_POST(self):
        try:
            payload = read_json(self)

            if self.path == "/infer":
                result = run_inference(payload)
                send_json(self, 200, {"ok": True, **result})

            elif self.path == "/train":
                result = run_training(payload)
                ok = result["exitCode"] == 0
                send_json(self, 200 if ok else 500, {"ok": ok, **result})

            elif self.path == "/inference-server/start":
                weights = payload.get("weights", "")
                port = int(payload.get("port", 4180))
                conf = float(payload.get("conf", 0.25))
                iou = float(payload.get("iou", 0.7))
                imgsz = int(payload.get("imgsz", 640))
                device = str(payload.get("device", "cpu"))
                host = str(payload.get("host", "0.0.0.0"))
                result = start_inference_server(weights, port, conf, iou, imgsz, device, host)
                send_json(self, 200 if result["ok"] else 500, result)

            elif self.path == "/inference-server/stop":
                result = stop_inference_server()
                send_json(self, 200, result)

            elif self.path == "/inference-server/infer":
                # 代理到 FastAPI 推理服务
                if not INFERENCE_SERVER_PROC or INFERENCE_SERVER_PROC.poll() is not None:
                    send_json(self, 503, {"ok": False, "error": "推理服务未运行"})
                    return
                import urllib.parse
                import urllib.request as ur
                img_b64 = payload.get("image_base64", "")
                import base64 as b64
                img_bytes = b64.b64decode(img_b64)
                boundary = "----DetDashBoard"
                body = (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="image"; filename="infer.jpg"\r\n'
                    f"Content-Type: image/jpeg\r\n\r\n"
                ).encode() + img_bytes + f"\r\n--{boundary}--\r\n".encode()
                req = ur.Request(
                    f"http://127.0.0.1:{INFERENCE_SERVER_PORT}/infer",
                    data=body,
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                )
                resp = ur.urlopen(req, timeout=60)
                send_json(self, 200, json.loads(resp.read().decode()))

            else:
                send_json(self, 404, {"error": "not found"})

        except Exception as exc:
            send_json(self, 500, {"ok": False, "error": str(exc)})


# ── 入口 ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Det-DashBoard 推理/训练侧车")
    parser.add_argument("--port", type=int, default=4178, help="监听端口 (默认 4178)")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址 (默认 127.0.0.1)")
    parser.add_argument("--storage-root", default="./portable-data/storage",
                        help="宿主机上 storage 目录路径 (默认 ./portable-data/storage)")
    parser.add_argument("--python", default=sys.executable,
                        help="Python 解释器路径 (默认当前)")
    args = parser.parse_args()

    global STORAGE_ROOT, PYTHON_BIN
    STORAGE_ROOT = os.path.abspath(args.storage_root)
    PYTHON_BIN = args.python

    print(f"Det-DashBoard 推理侧车启动")
    print(f"  监听:    http://{args.host}:{args.port}")
    print(f"  存储根:  {STORAGE_ROOT}")
    print(f"  Python:  {PYTHON_BIN}")
    print(f"  Python 版本: {sys.version.split()[0]}", flush=True)

    server = HTTPServer((args.host, args.port), RequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n侧车已停止", flush=True)
        server.server_close()


if __name__ == "__main__":
    main()
