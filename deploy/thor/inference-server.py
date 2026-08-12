#!/usr/bin/env python3
"""
Det-DashBoard FastAPI 推理服务

接受单张图像 POST，运行 YOLO 推理，返回打标结果。

启动方式（由 sidecar 管理）:
  python server/inference-server.py --port 4180 --weights /path/to/model.pt --python ~/.venv/ultralytics/bin/python

API:
  POST /infer        — 上传单张图像，返回检测结果 + base64 打标图像
  GET  /health       — 健康检查
  GET  /models       — 当前加载的模型信息
"""

import argparse
import base64
import io
import json
import os
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageDraw, ImageFont
import numpy as np


# ── 全局状态 ──────────────────────────────────────────────────────────────

MODEL = None
MODEL_PATH = ""
MODEL_NAMES = {}
CONF = 0.25
IOU = 0.7
IMGSZ = 640
DEVICE = "cpu"
STARTED_AT = None
RUNS_DIR = "/tmp/det-dashboard-runs"


# ── 工具函数 ──────────────────────────────────────────────────────────────

def load_font(size=20):
    """尝试加载字体，失败则用默认."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def build_detection_description(predictions):
    """根据本次检测结果生成固定场景句式的中文说明。"""
    if not predictions:
        return (
            "这是无人机从沙漠正上方俯拍到的视角。\n\n"
            "当前画面中 **未检测到符合置信度要求的重型装备。**"
        )

    class_name_zh = {
        "car": "汽车",
        "tank": "坦克",
        "zhuangjiache": "装甲车",
        "fasheche": "发射车",
        "hanma": "悍马",
        "minyongkache": "民用卡车",
        "buzhanche": "步战车",
        "daodanfasheche": "导弹发射车",
    }
    labels = []
    for pred in predictions:
        raw_label = str(pred.get("label") or "未知装备")
        label = class_name_zh.get(raw_label.lower(), raw_label)
        if label not in labels:
            labels.append(label)

    if len(labels) == 1:
        class_summary = labels[0]
    else:
        class_summary = "、".join(labels[:-1]) + "和" + labels[-1]

    return (
        "这是无人机从沙漠正上方俯拍到的视角。\n\n"
        f"可以看到黄沙里正有 **{len(predictions)} 辆重型装备，包括{class_summary}，在缓缓向前开。**"
    )


def draw_boxes(image, predictions, names):
    """在 PIL Image 上绘制检测框和标签."""
    draw = ImageDraw.Draw(image)
    font = load_font(max(14, min(24, image.width // 50)))
    colors = {}

    for pred in predictions:
        label = pred.get("label", "?")
        score = pred.get("score")
        x1 = float(pred.get("bbox_x", 0))
        y1 = float(pred.get("bbox_y", 0))
        x2 = x1 + float(pred.get("bbox_w", 0))
        y2 = y1 + float(pred.get("bbox_h", 0))

        # 每个类别固定颜色
        if label not in colors:
            h = hash(label) % 360
            # 简单 HSL→RGB
            import colorsys
            r, g, b = colorsys.hsv_to_rgb(h / 360, 0.8, 0.9)
            colors[label] = (int(r * 255), int(g * 255), int(b * 255))
        color = colors[label]

        # 绘制矩形
        draw.rectangle([x1, y1, x2, y2], outline=color, width=max(2, image.width // 400))

        # 标签文字
        text = f"{label}"
        if score is not None:
            text += f" {score:.2f}"
        bbox = draw.textbbox((x1, y1 - 18), text, font=font)
        draw.rectangle([bbox[0] - 2, bbox[1] - 2, bbox[2] + 2, bbox[3] + 2], fill=color)
        draw.text((x1, y1 - 18), text, fill=(255, 255, 255), font=font)

    return image


# ── 生命周期 ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global STARTED_AT
    STARTED_AT = time.time()
    print(f"[inference-server] 启动完成，模型: {MODEL_PATH}", flush=True)
    yield
    print("[inference-server] 正在关闭", flush=True)


app = FastAPI(title="Det-DashBoard 推理服务", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── API 端点 ──────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": os.path.basename(MODEL_PATH),
        "modelPath": MODEL_PATH,
        "device": DEVICE,
        "conf": CONF,
        "iou": IOU,
        "imgsz": IMGSZ,
        "uptime": round(time.time() - STARTED_AT, 1) if STARTED_AT else 0,
    }


@app.get("/models")
def list_models():
    return {
        "modelPath": MODEL_PATH,
        "modelName": os.path.basename(MODEL_PATH),
        "names": MODEL_NAMES,
        "classCount": len(MODEL_NAMES),
    }

@app.get("/v1/runs/{run_id}/files/{filename}")
async def serve_run_file(run_id: str, filename: str):
    """提供推理结果文件."""
    file_path = os.path.join(RUNS_DIR, run_id, "files", filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(file_path)


@app.post("/infer")
async def infer(request: Request, image: UploadFile = File(...)):
    """接收单张图像，返回检测结果 + base64 打标图像."""
    if MODEL is None:
        raise HTTPException(status_code=503, detail="模型未加载")

    # 读取图像
    try:
        contents = await image.read()
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法读取图像: {e}")

    original_size = pil_image.size

    # 运行推理
    try:
        results = MODEL.predict(
            source=pil_image,
            conf=CONF,
            iou=IOU,
            imgsz=IMGSZ,
            device=DEVICE,
            verbose=False,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"推理失败: {e}")

    result = results[0] if isinstance(results, list) else results

    # 提取预测
    predictions = []
    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        xyxy = boxes.xyxy.cpu().tolist() if getattr(boxes, "xyxy", None) is not None else []
        confs = boxes.conf.cpu().tolist() if getattr(boxes, "conf", None) is not None else [None] * len(xyxy)
        clss = boxes.cls.cpu().tolist() if getattr(boxes, "cls", None) is not None else [None] * len(xyxy)
        for idx, coords in enumerate(xyxy):
            x1, y1, x2, y2 = [float(v) for v in coords]
            cls_id = int(clss[idx]) if clss[idx] is not None else -1
            label = MODEL_NAMES.get(cls_id, str(cls_id))
            predictions.append({
                "label": label,
                "score": None if confs[idx] is None else round(float(confs[idx]), 4),
                "bbox_x": round(x1, 2),
                "bbox_y": round(y1, 2),
                "bbox_w": round(max(0.0, x2 - x1), 2),
                "bbox_h": round(max(0.0, y2 - y1), 2),
                "class_id": cls_id,
            })

    # 绘制打标图像
    annotated = draw_boxes(pil_image.copy(), predictions, MODEL_NAMES)

    # 生成 run_id 并保存文件
    run_id = f"run_{time.strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}"
    run_dir = os.path.join(RUNS_DIR, run_id, "files")
    os.makedirs(run_dir, exist_ok=True)

    primary_filename = image.filename or "primary.png"
    overlay_filename = "detection_overlay.png"

    pil_image.save(os.path.join(run_dir, primary_filename), format="PNG")
    annotated.save(os.path.join(run_dir, overlay_filename), format="PNG")

    base_url = f"{str(request.base_url).rstrip('/')}/v1/runs/{run_id}/files"

    return JSONResponse({
        "run_id": run_id,
        "artifacts": [
            {
                "label": "primary_input",
                "filename": primary_filename,
                "url": f"{base_url}/{primary_filename}",
            },
            {
                "label": "final_overlay",
                "filename": overlay_filename,
                "url": f"{base_url}/{overlay_filename}",
            },
            {
                "label": "description",
                "context": json.dumps({
                    "description": build_detection_description(predictions),
                }, ensure_ascii=False),
            },
            {
                "label": "others",
                "context": "",
            },
        ],
    })


# ── 入口 ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Det-DashBoard FastAPI 推理服务")
    parser.add_argument("--port", type=int, default=4180, help="监听端口 (默认 4180)")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址 (默认 0.0.0.0)")
    parser.add_argument("--weights", required=True, help="模型权重文件路径 (.pt)")
    parser.add_argument("--conf", type=float, default=0.25, help="置信度阈值 (默认 0.25)")
    parser.add_argument("--iou", type=float, default=0.7, help="IoU 阈值 (默认 0.7)")
    parser.add_argument("--imgsz", type=int, default=640, help="推理图像尺寸 (默认 640)")
    parser.add_argument("--device", default="cpu", help="设备 (cpu / cuda:0 等)")
    args = parser.parse_args()

    global MODEL, MODEL_PATH, MODEL_NAMES, CONF, IOU, IMGSZ, DEVICE

    if not os.path.exists(args.weights):
        print(f"ERROR: 权重文件不存在: {args.weights}", file=sys.stderr)
        sys.exit(1)

    MODEL_PATH = os.path.abspath(args.weights)
    CONF = args.conf
    IOU = args.iou
    IMGSZ = args.imgsz
    DEVICE = args.device

    print(f"正在加载模型: {MODEL_PATH}")
    from ultralytics import YOLO
    MODEL = YOLO(MODEL_PATH)
    MODEL_NAMES = getattr(MODEL, "names", {}) or {}
    print(f"模型已加载，{len(MODEL_NAMES)} 个类别", flush=True)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
