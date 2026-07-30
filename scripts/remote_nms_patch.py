from pathlib import Path

p = Path('/models_data/det-dashboard/runtime/inference-test/run.py')
s = p.read_text()
block = '''import mmcv.ops.nms as _nmsmod
_orig_nms = _nmsmod.nms
def _safe_nms(boxes, scores, *args, **kwargs):
    if boxes.device.type == "npu":
        dets, inds = _orig_nms(boxes.cpu(), scores.cpu(), *args, **kwargs)
        return dets.to(boxes.device), inds.to(boxes.device)
    return _orig_nms(boxes, scores, *args, **kwargs)
_nmsmod.nms = _safe_nms
'''
if '_safe_nms' not in s:
    s = s.replace('from mmdet.apis', block + 'from mmdet.apis')
p.write_text(s)

c = Path('/models_data/det-dashboard/runtime/inference-test/alashan_ccd_smoke.py')
t = c.read_text()
t = t.replace('num_classes=17', 'num_classes=9')
c.write_text(t)
