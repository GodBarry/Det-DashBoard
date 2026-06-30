# 数据集资产管理正式架构

## 目标

系统同时支持图片、JSON 标注和视频。导入来源是服务端指定路径，后端递归遍历其中全部数据。内部采用 PostgreSQL + MinIO 管理，导出仍然生成标准 `dataset/images` 和 `dataset/jsons` 结构。

## 存储分工

- PostgreSQL：项目、导入批次、图片/视频资产索引、项目引用、标注版本、标注框、导出任务。
- MinIO：图片、视频、原始 JSON、缩略图、crop、抽帧、导出文件、模型权重、conda-pack 运行环境包。
- 本地 `./runtime/minio`：Podman/MinIO 的底层对象数据目录。
- 本地 `./runtime/storage`：Node 后端的临时文件、缓存和 MinIO 不可用时的 fallback 对象目录。

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
envs/python/conda-pack/<sha_prefix>/<sha256>/yolo-env.tar.gz
```

## 导入策略

1. 用户指定服务端路径，例如 `/home/administrator/Projects/det-dashboard/runtime/datasets/demo`。
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

```bash
cd /home/administrator/Projects/det-dashboard
mkdir -p runtime/postgres runtime/minio runtime/storage runtime/datasets
bash scripts/podman-up.sh
npm install
npm run api:pg
```

## 推理平台流程

推理平台按训练平台的 Run / Artifact / Model Version / Queue 思路组织，当前前端流程为：

```text
数据集项目 -> 模型簇 -> 推理模型版本 -> 推理模板/算法入口 -> 任务类型 -> 运行环境资产 -> 推理参数 -> 输出策略 -> 推理队列
```

当前已支持：

- 选择模型簇并过滤模型版本。
- 选择推理模板/算法入口，现阶段复用训练模板表，后续可拆为独立 `inference_templates`。
- 选择任务类型：目标检测、实例分割、图像分类。
- 选择运行环境资产：服务器 Python 路径或导入到 MinIO 的 conda-pack 包。
- 配置推理参数：`conf / iou / imgsz / batch / device`。
- 配置输出策略：保存预测 JSON、保存可视化结果、生成候选标注版本。
- 提交推理任务到 `inference_jobs`，推理结果入口暂时预留。

后续待接：

- 推理 worker 真正执行任务。
- 独立推理模板表和算法命令配置。
- 推理结果写入 `inference_results`。
- 推理结果进入测试评估平台。

## 推理输入缓存

推理任务提交后，后端会先把本次任务选中的项目图片整理成任务级输入缓存，任务状态从 `preparing` 进入 `pending` 后再等待推理 worker 执行。

目录结构：

```text
runtime/inference/<job_id>/input-cache/
  images/
    00000001.jpg
    00000002.jpg
  manifest.json
  dataset_meta.json
  source_filters.json
```

数据流：

```text
PostgreSQL project_images/image_assets
  -> MinIO object_key
  -> runtime/cache/assets/images/<image_asset_id>.<ext>
  -> runtime/inference/<job_id>/input-cache/images/
```

`manifest.json` 会记录缓存文件与平台资产的映射关系：

```json
{
  "jobId": "...",
  "projectId": "...",
  "imageCount": 944,
  "images": [
    {
      "projectImageId": "...",
      "imageAssetId": "...",
      "objectKey": "objects/images/sha256/ab/abcdef.jpg",
      "originalFileName": "DJI_001.jpg",
      "cachedFileName": "00000001.jpg",
      "localPath": "images/00000001.jpg",
      "scene": "Grassland",
      "view": "Aerial View",
      "modality": "visible"
    }
  ]
}
```

前端推理任务可配置输入范围：

- 全项目。
- 按场景、视角、模态、导入批次、类别和关键词筛选。
- 限制最大图片数。
- 缓存策略：复用资产缓存或任务独立副本。

算法脚本不直接访问 PostgreSQL 或 MinIO，只读取：

```text
runtime/inference/<job_id>/input-cache/images/
```

推理输出再通过 `manifest.json` 映射回 `project_image_id`，供 `inference_results` 和测试评估平台使用。

## 运行环境资产

运行环境采用 PostgreSQL 管元数据、MinIO 管制品的方式。现阶段支持两种来源：

- 服务器 Python 路径：登记服务器上已有的 Python/Conda/Miniforge 解释器。
- conda-pack 云端导入：将服务器可访问的 `.tar.gz` 环境包导入 MinIO，并记录 `artifact_key / sha256 / unpack_path`。

conda-pack 导入要求环境包先放在 `DATA_ROOT` 或 `STORAGE_ROOT` 内，后端再上传到 MinIO：

```text
envs/python/conda-pack/<sha_prefix>/<sha256>/<package_name>.tar.gz
```

推理任务只引用环境资产 ID，真正解包、激活和执行由后续推理 worker 完成。

## 测试评估平台

测试评估平台入口已预留，后续从推理任务进入。计划能力包括：

- 浏览推理结果。
- 与人工标注或基线标注对比。
- 计算 Precision、Recall、mAP、混淆矩阵。
- 按类别、场景、视角、模态统计。
- 可视化 TP / FP / FN。
- 将高置信预测导入为候选标注版本。

前端：

```bash
npm run dev -- --host 0.0.0.0
```

Node 后端建议使用 `.env.podman.example` 里的 Linux 路径：

```bash
set -a
. ./.env.podman.example
set +a
npm run api:pg
```

如果已经安装了 `podman compose` 或 `podman-compose`，也可以使用：

```bash
podman compose -f podman-compose.yml up -d
```

停止 PostgreSQL 和 MinIO：

```bash
bash scripts/podman-down.sh
```
