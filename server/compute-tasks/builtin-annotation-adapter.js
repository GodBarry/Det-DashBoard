"use strict";

const annotationAdapterSource = String.raw`import argparse
import json
import os
import sys

import cv2
import numpy as np
import torch


def bbox_from_mask(mask):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())]


def suggestion(image, prompt, mask, score=None, frame_index=None):
    box = bbox_from_mask(mask)
    if box is None:
        return None
    return {
        "projectImageId": image["projectImageId"],
        "frameIndex": image.get("frameIndex") if frame_index is None else frame_index,
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
    candidates = [
        os.path.join(root, "configs", "samurai", "sam2.1_hiera_l.yaml"),
        os.path.join(root, "samurai_sam2", "configs", "samurai", "sam2.1_hiera_l.yaml"),
        "configs/samurai/sam2.1_hiera_l.yaml",
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
    predictor = SAM2ImagePredictor(build_sam2(model_config(request), assets["modelPath"], device=device))
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
    parser.add_argument("--det-dashboard-task", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
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
