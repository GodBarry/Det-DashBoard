#!/usr/bin/env python3
"""Patch MMCV RoIAlign to fall back to CPU when tensors are on Ascend NPU.

This script is intended to be uploaded to the offline Ascend server and run
inside the target Python environment. It modifies the installed
``mmcv.ops.roi_align`` module in-place and keeps a ``.bak`` beside the file.
"""

from __future__ import annotations

import importlib.util
import shutil
import sys
from pathlib import Path


MARKER = "# DET_DASHBOARD_ASCEND_NPU_ROI_ALIGN_CPU_FALLBACK"


def locate_roi_align() -> Path:
    spec = importlib.util.find_spec("mmcv.ops.roi_align")
    if spec is None or not spec.origin:
        raise RuntimeError("Cannot locate mmcv.ops.roi_align in this Python environment")
    path = Path(spec.origin)
    if not path.exists():
        raise RuntimeError(f"Located roi_align.py does not exist: {path}")
    return path


def patch_source(source: str) -> str:
    if MARKER in source:
        return source

    old = """        ext_module.roi_align_forward(
            input,
            rois,
            output,
            argmax_y,
            argmax_x,
            aligned_height=ctx.output_size[0],
            aligned_width=ctx.output_size[1],
            spatial_scale=ctx.spatial_scale,
            sampling_ratio=ctx.sampling_ratio,
            pool_mode=ctx.pool_mode,
            aligned=ctx.aligned)
"""

    new = f"""        {MARKER}
        _input_device_type = getattr(input.device, 'type', '')
        if _input_device_type == 'npu':
            cpu_input = input.detach().cpu()
            cpu_rois = rois.detach().cpu()
            cpu_output = output.detach().cpu()
            cpu_argmax_y = argmax_y.detach().cpu()
            cpu_argmax_x = argmax_x.detach().cpu()
            ext_module.roi_align_forward(
                cpu_input,
                cpu_rois,
                cpu_output,
                cpu_argmax_y,
                cpu_argmax_x,
                aligned_height=ctx.output_size[0],
                aligned_width=ctx.output_size[1],
                spatial_scale=ctx.spatial_scale,
                sampling_ratio=ctx.sampling_ratio,
                pool_mode=ctx.pool_mode,
                aligned=ctx.aligned)
            output.copy_(cpu_output.to(device=input.device, dtype=output.dtype))
            if cpu_argmax_y.numel():
                argmax_y.copy_(cpu_argmax_y.to(device=input.device, dtype=argmax_y.dtype))
            if cpu_argmax_x.numel():
                argmax_x.copy_(cpu_argmax_x.to(device=input.device, dtype=argmax_x.dtype))
        else:
            ext_module.roi_align_forward(
                input,
                rois,
                output,
                argmax_y,
                argmax_x,
                aligned_height=ctx.output_size[0],
                aligned_width=ctx.output_size[1],
                spatial_scale=ctx.spatial_scale,
                sampling_ratio=ctx.sampling_ratio,
                pool_mode=ctx.pool_mode,
                aligned=ctx.aligned)
"""

    if old not in source:
        raise RuntimeError("Expected roi_align_forward block was not found; MMCV source layout differs")
    return source.replace(old, new, 1)


def main() -> int:
    path = locate_roi_align()
    original = path.read_text(encoding="utf-8")
    patched = patch_source(original)

    if patched == original:
        print(f"already patched: {path}")
        return 0

    backup = path.with_suffix(path.suffix + ".bak")
    if not backup.exists():
        shutil.copy2(path, backup)
    path.write_text(patched, encoding="utf-8")
    print(f"patched: {path}")
    print(f"backup: {backup}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
