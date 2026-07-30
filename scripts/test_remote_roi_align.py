#!/usr/bin/env python3
"""Minimal RoIAlign smoke test for the remote Ascend runtime."""

from __future__ import annotations

import torch
import torch_npu  # noqa: F401
from mmcv.ops import RoIAlign


def main() -> int:
    device = "npu:0"
    x = torch.arange(1 * 1 * 8 * 8, dtype=torch.float32, device=device).reshape(1, 1, 8, 8)
    rois = torch.tensor([[0, 1.0, 1.0, 6.0, 6.0]], dtype=torch.float32, device=device)
    op = RoIAlign(output_size=(3, 3), spatial_scale=1.0, sampling_ratio=2, pool_mode="avg", aligned=True)
    y = op(x, rois)
    print("device=", y.device)
    print("shape=", tuple(y.shape))
    print("sum=", float(y.detach().cpu().sum()))
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
