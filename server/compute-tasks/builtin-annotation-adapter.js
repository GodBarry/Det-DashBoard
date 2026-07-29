"use strict";

const annotationAdapterSource = String.raw`import argparse
import json
import os
import sys

import cv2
import numpy as np
import torch

_SEGMENT_PREDICTORS = {}


def bbox_from_mask(mask):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())]


def suggestion(image, prompt, mask, score=None, frame_index=None):
    if image.get("persistSuggestion") is False or not image.get("projectImageId"):
        return None
    box = bbox_from_mask(mask)
    if box is None:
        return None
    return {
        "projectImageId": image["projectImageId"],
        "frameIndex": image.get("sequenceIndex", image.get("frameIndex")),
        "trackId": prompt.get("trackId", ""),
        "revision": int(prompt.get("revision", 1)),
        "label": prompt.get("label", "unknown"),
        "shapeType": "rectangle",
        "geometry": {"bbox": box},
        "score": score,
    }


def model_config(request):
    params = request.get("parameters") or {}
    configured = params.get("model_cfg") or params.get("modelConfig")
    if configured:
        return configured
    root = (request.get("assets") or {}).get("algorithmRoot") or os.getcwd()
    model_path = str((request.get("assets") or {}).get("modelPath") or "").lower()
    variant = "t" if "tiny" in model_path else "s" if "small" in model_path else "b+" if "base_plus" in model_path or "base-plus" in model_path else "l"
    config_name = {
        "t": "sam2.1_hiera_t.yaml",
        "s": "sam2.1_hiera_s.yaml",
        "b+": "sam2.1_hiera_b+.yaml",
        "l": "sam2.1_hiera_l.yaml",
    }[variant]
    candidates = [
        os.path.join(root, "configs", "samurai", config_name),
        os.path.join(root, "samurai_sam2", "configs", "samurai", config_name),
        os.path.join("configs", "samurai", config_name),
    ]
    return next((value for value in candidates if os.path.isfile(value)), candidates[-1])


def segment(request):
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    assets = request.get("assets") or {}
    images = (request.get("input") or {}).get("images") or []
    prompt = (request.get("input") or {}).get("prompt") or {}
    if not images:
        raise RuntimeError("segment requires one materialized image")
    if not assets.get("modelPath"):
        raise RuntimeError("segment requires a registered SAM2 model weight")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    config = model_config(request)
    cache_key = (config, assets["modelPath"], str(device))
    predictor = _SEGMENT_PREDICTORS.get(cache_key)
    if predictor is None:
        predictor = SAM2ImagePredictor(build_sam2(config, assets["modelPath"], device=device))
        _SEGMENT_PREDICTORS[cache_key] = predictor
    image = cv2.cvtColor(cv2.imread(images[0]["path"]), cv2.COLOR_BGR2RGB)
    predictor.set_image(image)
    box = np.asarray(prompt.get("bbox"), dtype=np.float32) if prompt.get("bbox") else None
    points = np.asarray(prompt.get("points"), dtype=np.float32) if prompt.get("points") else None
    point_labels = np.asarray(prompt.get("pointLabels"), dtype=np.int32) if prompt.get("pointLabels") else None
    masks, scores, _ = predictor.predict(point_coords=points, point_labels=point_labels, box=box, multimask_output=False)
    row = suggestion(images[0], prompt, masks[0].astype(bool), float(scores[0]) if len(scores) else None)
    return {"suggestions": [row] if row else []}


def propagate(request):
    from sam2.build_sam import build_sam2_video_predictor
    assets = request.get("assets") or {}
    payload = request.get("input") or {}
    images = payload.get("images") or []
    prompts = payload.get("prompts") or []
    if not images or not prompts:
        raise RuntimeError("propagate requires an ordered image sequence and at least one prompt")
    if not assets.get("modelPath"):
        raise RuntimeError("propagate requires a registered SAMURAI model weight")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    start_frame = int(payload.get("startFrame") or 0)
    image_paths = [row["path"] for row in images]
    rows = []
    # Some SAMURAI forks only support scalar stability scores. Isolate each
    # target in its own predictor state and merge the platform-level tracks.
    for object_index, prompt in enumerate(prompts):
        prompt = dict(prompt)
        prompt.setdefault("revision", int((request.get("parameters") or {}).get("revision", 1)))
        predictor = build_sam2_video_predictor(model_config(request), assets["modelPath"], device=device, apply_postprocessing=device.type == "cuda")
        state = predictor.init_state(image_list=image_paths, offload_video_to_cpu=True)
        object_id = 1
        box = np.asarray(prompt.get("bbox"), dtype=np.float32)
        predictor.add_new_points_or_box(state, box=box, frame_idx=start_frame, obj_id=object_id)
        inference_context = torch.autocast("cuda", dtype=torch.float16) if device.type == "cuda" else torch.inference_mode()
        with torch.inference_mode(), inference_context:
            for frame_index, object_ids, masks in predictor.propagate_in_video(state):
                if frame_index < 0 or frame_index >= len(images):
                    continue
                for mask in masks:
                    row = suggestion(images[frame_index], prompt, (mask[0].detach().cpu().numpy() > 0), frame_index=frame_index)
                    if row:
                        rows.append(row)
        del state, predictor
        if device.type == "cuda":
            torch.cuda.empty_cache()
    return {"suggestions": rows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--det-dashboard-task")
    parser.add_argument("--output")
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if args.serve:
        for line in sys.stdin:
            message = json.loads(line)
            request_path = message["requestPath"]
            output_path = message["outputPath"]
            request_id = message.get("requestId", "")
            try:
                with open(request_path, "r", encoding="utf-8") as handle:
                    request = json.load(handle)
                result = segment(request)
                with open(output_path, "w", encoding="utf-8") as handle:
                    json.dump(result, handle, ensure_ascii=False)
                print("DET_DASHBOARD_RESULT:" + request_id + ":ok", flush=True)
            except Exception as error:
                print("DET_DASHBOARD_RESULT:" + request_id + ":error:" + str(error).replace("\n", " "), flush=True)
        return
    if not args.det_dashboard_task or not args.output:
        raise RuntimeError("--det-dashboard-task and --output are required")
    with open(args.det_dashboard_task, "r", encoding="utf-8") as handle:
        request = json.load(handle)
    operation = request.get("operation")
    if operation == "segment":
        result = segment(request)
    elif operation in {"propagate", "correct"}:
        result = propagate(request)
    else:
        raise RuntimeError("unsupported operation: %s" % operation)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)


if __name__ == "__main__":
    main()
`;

module.exports = { annotationAdapterSource };
