# 数据集资产管理正式架构

## 目标

系统同时支持图片、JSON 标注和视频。导入来源是服务端指定路径，后端递归遍历其中全部数据。内部采用 PostgreSQL + MinIO 管理，导出仍然生成标准 `dataset/images` 和 `dataset/jsons` 结构。

## 存储分工

- PostgreSQL：项目、导入批次、图片/视频资产索引、项目引用、标注版本、标注框、导出任务。
- MinIO：图片、视频、原始 JSON、缩略图、crop、抽帧、导出文件。
- 本地 `F:\ZBH\zhuji`：开发环境中 MinIO 的底层数据目录和临时文件目录。

## MinIO 对象 key

```text
objects/images/sha256/ab/abcdef.jpg
objects/videos/sha256/91/91abcd.mp4
objects/raw-labels/<project_id>/<version_id>/xxx.json
cache/thumbs/images/<image_asset_id>.webp
cache/thumbs/videos/<video_asset_id>.webp
cache/crops/<project_id>/<version_id>/<annotation_id>.webp
cache/frames/<video_asset_id>/frame_000120.webp
exports/<project_id>/export_20260627_001/images/AerialView_Grassland_VIS_000001.jpg
exports/<project_id>/export_20260627_001/jsons/AerialView_Grassland_VIS_000001.json
```

## 导入策略

1. 用户指定服务端路径，例如 `F:\ZBH\统计用`。
2. 后端递归遍历图片、JSON、视频。
3. 图片按 `imagePath`、同名文件、basename 匹配 JSON。
4. 图片/视频计算 quick hash 与 SHA256。
5. 相同 SHA256 的资产只在 MinIO 存一份。
6. 项目通过 `project_images` / `project_videos` 引用全局资产。
7. 每次导入 JSON 都生成新的 `label_versions`，不覆盖旧标注。
8. 视频若无标注，进入 `project_videos.label_status = unlabeled`，后续人工补 `view / scene / keyword`。

## 命名规则

内部对象名按 hash 存储，不依赖原始文件名。项目显示名和导出名使用：

```text
{view}_{scene}_{modality}_{index}.{ext}
```

示例：

```text
AerialView_Grassland_VIS_000001.jpg
AerialView_Grassland_VIS_000001.json
```

导出 JSON 的 `imagePath` 会写成：

```json
"imagePath": "../images/AerialView_Grassland_VIS_000001.jpg"
```

## 启动

```powershell
cd /d E:\projects\det-dashboard
docker compose up -d
C:\tmp\node-with-npm\node-v24.14.0-win-x64\npm.cmd install
C:\tmp\node-with-npm\node-v24.14.0-win-x64\npm.cmd run api:pg
```

前端：

```powershell
C:\tmp\node-with-npm\node-v24.14.0-win-x64\npm.cmd run dev -- --host 0.0.0.0
```

