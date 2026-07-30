from pathlib import Path
p=Path('/models_data/det-dashboard/runtime/npu-env/lib64/python3.9/site-packages/mmcv/ops/nms.py')
s=p.read_text()
old='''        inds = ext_module.nms(
            bboxes, scores, iou_threshold=float(iou_threshold), offset=offset)
'''
new='''        if bboxes.device.type == "npu":
            inds = ext_module.nms(bboxes.cpu(), scores.cpu(), iou_threshold=float(iou_threshold), offset=offset)
            inds = inds.to(bboxes.device)
        else:
            inds = ext_module.nms(bboxes, scores, iou_threshold=float(iou_threshold), offset=offset)
'''
if old not in s: raise SystemExit('pattern not found')
p.write_text(s.replace(old,new,1))
c=Path('/models_data/det-dashboard/runtime/inference-test/alashan_ccd_smoke.py')
t=c.read_text().replace('num_classes=17','num_classes=9')
c.write_text(t)
