#!/usr/bin/env python3
"""HTTP inference receiver that reports inbound inference events to Det-DashBoard."""
import argparse
import io
import json
import time
import urllib.request
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=4180)
    parser.add_argument("--device", default="0")
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.7)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--callback-url", required=True)
    parser.add_argument("--callback-token", required=True)
    parser.add_argument("--receiver-id", required=True)
    parser.add_argument("--storage-root", required=True)
    return parser.parse_args()


ARGS = parse_args()
MODEL = None
MODEL_ERROR = ""
STARTED_AT = time.time()

try:
    from ultralytics import YOLO
    MODEL = YOLO(ARGS.weights)
except Exception as error:
    MODEL_ERROR = str(error)

app = FastAPI(title="Det-DashBoard inference receiver")


def notify(event, **payload):
    data = {"token": ARGS.callback_token, "receiverId": ARGS.receiver_id, "event": event, **payload}
    request = urllib.request.Request(
        ARGS.callback_url,
        data=json.dumps(data).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=5).read()
    except Exception as error:
        print(f"[inference-server] callback failed: {error}", flush=True)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ready": MODEL is not None,
        "model": Path(ARGS.weights).name,
        "modelPath": ARGS.weights,
        "device": ARGS.device,
        "conf": ARGS.conf,
        "iou": ARGS.iou,
        "imgsz": ARGS.imgsz,
        "receiverId": ARGS.receiver_id,
        "uptime": round(time.time() - STARTED_AT, 1),
        "error": MODEL_ERROR or None,
    }


@app.post("/infer")
async def infer(image: UploadFile = File(...)):
    if MODEL is None:
        notify("failed", error=MODEL_ERROR or "模型未加载")
        raise HTTPException(status_code=503, detail=MODEL_ERROR or "模型未加载")
    request_id = uuid.uuid4().hex
    notify("accepted", requestId=request_id, filename=image.filename or "image")
    try:
        from PIL import Image
        raw = await image.read()
        source = Image.open(io.BytesIO(raw)).convert("RGB")
        result = MODEL.predict(source=source, conf=ARGS.conf, iou=ARGS.iou, imgsz=ARGS.imgsz, device=ARGS.device, verbose=False)[0]
        names = getattr(MODEL, "names", {}) or {}
        predictions = []
        for coords, score, class_id in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.conf.cpu().tolist(), result.boxes.cls.cpu().tolist()):
            x1, y1, x2, y2 = [float(item) for item in coords]
            class_id = int(class_id)
            predictions.append({"label": names.get(class_id, str(class_id)), "score": round(float(score), 4), "class_id": class_id, "bbox_x": x1, "bbox_y": y1, "bbox_w": x2 - x1, "bbox_h": y2 - y1})
        run_dir = Path(ARGS.storage_root) / "remote-inference" / request_id
        run_dir.mkdir(parents=True, exist_ok=True)
        source_path = run_dir / "input.png"
        overlay_path = run_dir / "overlay.jpg"
        source.save(source_path)
        Image.fromarray(result.plot()[:, :, ::-1]).save(overlay_path)
        artifact_path = f"/data/storage/remote-inference/{request_id}/overlay.jpg"
        input_path = f"/data/storage/remote-inference/{request_id}/input.png"
        notify("completed", requestId=request_id, predictions=predictions, artifactPath=artifact_path, inputPath=input_path)
        return JSONResponse({"requestId": request_id, "receiverId": ARGS.receiver_id, "predictions": predictions, "count": len(predictions), "artifacts": {"input": input_path, "overlay": artifact_path}})
    except Exception as error:
        notify("failed", requestId=request_id, error=str(error))
        raise HTTPException(status_code=500, detail=f"推理失败: {error}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=ARGS.host, port=ARGS.port)
