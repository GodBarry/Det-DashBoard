#!/usr/bin/env python3
"""Private host-side DINOv3 Faster R-CNN runner for Det-DashBoard jobs."""

import argparse
import base64
import json
import os
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Runner:
    def __init__(self, storage_root, config, checkpoint):
        self.storage_root = Path(storage_root)
        self.config = config
        self.checkpoint = checkpoint
        self.classes = ['tank', 'zhuangjiache', 'fasheche', 'hanma', 'buzhanche', 'truck', 'car', 'daodanfasheche']
        # Serialize access to the single Thor GPU. Concurrent HTTP requests
        # otherwise start multiple MMDetection processes and can exhaust VRAM.
        self.gpu_lock = threading.Lock()

    def infer(self, payload):
        job_id = str(payload['jobId'])
        score_thr = float(payload.get('scoreThr', 0.25))
        output_root = self.storage_root / 'runtime' / 'inference' / job_id
        manifest_path = output_root / 'input-cache' / 'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        output_dir = output_root / 'output'
        output_dir.mkdir(parents=True, exist_ok=True)
        image_dir = output_root / 'input-cache' / 'images'
        runner_dir = output_dir / '_mmdet_runner'
        command = [sys.executable, '-m', 'tools.infer', str(image_dir), self.config, self.checkpoint,
                   '--out-dir', str(runner_dir), '--device', 'cuda:0', '--score-thr', str(score_thr), '--batch-size', '1']
        if not payload.get('saveVisualization'):
            command.append('--no-save-vis')
        completed = subprocess.run(command, cwd=str(Path(self.config).parents[2]), env=os.environ.copy(), text=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if completed.returncode:
            raise RuntimeError(completed.stdout[-4000:])
        rows = []
        for item in manifest.get('images', []):
            pred_path = runner_dir / 'preds' / f"{Path(item['cachedFileName']).stem}.json"
            result = json.loads(pred_path.read_text(encoding='utf-8'))
            predictions = []
            for label, score, bbox in zip(result['labels'], result['scores'], result['bboxes']):
                if float(score) < score_thr:
                    continue
                x1, y1, x2, y2 = [float(value) for value in bbox]
                predictions.append({
                    'label': self.classes[int(label)], 'class_id': int(label), 'score': float(score),
                    'bbox_x': x1, 'bbox_y': y1, 'bbox_w': max(0.0, x2 - x1), 'bbox_h': max(0.0, y2 - y1),
                })
            rows.append({
                'index': item.get('index'), 'cachedFileName': item.get('cachedFileName'),
                'projectImageId': item.get('projectImageId'), 'imageAssetId': item.get('imageAssetId'),
                'originalFileName': item.get('originalFileName'), 'width': item.get('width'),
                'height': item.get('height'), 'predictions': predictions,
            })
        result_path = output_dir / 'predictions.json'
        output = {
            'format': 'det-dashboard.predictions.v1', 'algorithm': 'dinov3_faster_rcnn',
            'jobId': job_id, 'imageCount': len(rows),
            'predictionCount': sum(len(row['predictions']) for row in rows), 'images': rows,
        }
        result_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
        return {'ok': True, 'imageCount': output['imageCount'], 'predictionCount': output['predictionCount']}

    def infer_image(self, payload):
        """Infer one browser-uploaded image without creating a dataset job."""
        image_bytes = base64.b64decode(payload.get('image_base64', ''), validate=True)
        if not image_bytes:
            raise ValueError('缺少 image_base64 图像内容')
        score_thr = float(payload.get('scoreThr', 0.25))
        request_id = uuid.uuid4().hex
        work_dir = self.storage_root / 'runtime' / 'online-inference' / request_id
        image_path = work_dir / 'upload.jpg'
        runner_dir = work_dir / 'output'
        work_dir.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(image_bytes)
        command = [sys.executable, '-m', 'tools.infer', str(image_path), self.config, self.checkpoint,
                   '--out-dir', str(runner_dir), '--device', 'cuda:0', '--score-thr', str(score_thr), '--batch-size', '1']
        if not payload.get('saveVisualization'):
            command.append('--no-save-vis')
        completed = subprocess.run(command, cwd=str(Path(self.config).parents[2]), env=os.environ.copy(), text=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if completed.returncode:
            raise RuntimeError(completed.stdout[-4000:])
        pred_path = runner_dir / 'preds' / 'upload.json'
        result = json.loads(pred_path.read_text(encoding='utf-8'))
        predictions = []
        for label, score, bbox in zip(result['labels'], result['scores'], result['bboxes']):
            if float(score) < score_thr:
                continue
            x1, y1, x2, y2 = [float(value) for value in bbox]
            class_id = int(label)
            predictions.append({'label': self.classes[class_id], 'class_id': class_id, 'score': float(score),
                                'bbox_x': x1, 'bbox_y': y1, 'bbox_w': max(0.0, x2 - x1), 'bbox_h': max(0.0, y2 - y1)})
        return {'ok': True, 'requestId': request_id, 'predictions': predictions, 'predictionCount': len(predictions)}


class Handler(BaseHTTPRequestHandler):
    runner = None

    def do_GET(self):
        if self.path != '/health':
            self.send_error(404)
            return
        payload = json.dumps({'status': 'ok'}, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path not in ('/infer', '/infer-image'):
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            payload = json.loads(self.rfile.read(size).decode('utf-8'))
            with self.runner.gpu_lock:
                result = self.runner.infer_image(payload) if self.path == '/infer-image' else self.runner.infer(payload)
            self.send_response(200)
        except Exception as exc:  # return errors to the platform task log
            result = {'ok': False, 'error': str(exc)}
            self.send_response(500)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))

    def log_message(self, _fmt, *_args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--storage-root', required=True)
    parser.add_argument('--config', required=True)
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--host', default='172.17.0.1')
    parser.add_argument('--port', type=int, default=4181)
    args = parser.parse_args()
    Handler.runner = Runner(args.storage_root, args.config, args.checkpoint)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
