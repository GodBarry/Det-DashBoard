# 数据集资产管理架构

## 运行边界

正式发布形态是单机 Docker Compose：浏览器访问 Node.js API 和 React 静态页面，业务元数据写入 PostgreSQL，二进制对象写入 MinIO。Ubuntu 宿主文件系统仅通过只读挂载提供浏览和导入；应用只写专用 storage 与 exports 挂载。

```text
Browser :5173
    │
    ▼
Node.js API + React static files (uid/gid 1000, read-only rootfs)
    ├── PostgreSQL: metadata and job state
    ├── MinIO: imported objects and raw labels
    ├── /host/browse: read-only Ubuntu source tree
    ├── /data/storage: caches and local fallback
    └── /data/exports: generated datasets
```

服务默认仅绑定 `127.0.0.1`，没有认证、租户隔离或 TLS，不能直接暴露到公网。

## 代码分层

- `src/`：项目工作台、目录浏览、筛选、标注编辑和任务状态界面。
- `server/postgres-app.js`：HTTP 路由、导入/导出编排、项目与模型任务接口。
- `server/dataset-formats.js`：LabelMe、COCO、YOLO 到统一图片标注模型的适配。
- `server/export-formats.js`：统一标注模型到 LabelMe、COCO、YOLO 的序列化。
- `server/db.js`：PostgreSQL 连接池。
- `server/object-store.js`：MinIO、只读旧对象和可选本地 fallback。
- `server/utils.js`：异步扫描、场景推断和通用文件工具。

`postgres-app.js` 当前仍承担过多领域职责。后续拆分应按项目、资产、标注、导入、导出、基准集和模型任务划分，而不是按 HTTP 方法划分。

## 存储分工

- PostgreSQL：项目、导入批次、图片/视频资产索引、项目引用、标注版本、检测框、导出任务、基准集和模型任务状态。
- MinIO：图片、视频、原始标注及其他不可变二进制对象。
- `portable-data/storage`：缩略图、临时文件及显式启用时的 fallback 对象。
- `exports`：给用户直接使用的 LabelMe、COCO、YOLO 导出目录。

## MinIO 对象 key

```text
objects/images/sha256/ab/abcdef.jpg
objects/videos/sha256/91/91abcd.mp4
objects/raw-labels/<project_id>/<version_id>/xxx.json
cache/thumbs/images/<image_asset_id>.webp
cache/thumbs/videos/<video_asset_id>.webp
cache/crops/<project_id>/<version_id>/<annotation_id>.webp
cache/frames/<video_asset_id>/frame_000120.webp
```

## 导入流水线

1. 用户用 Ubuntu 原生选择器或网页目录浏览器选择服务端可见目录。
2. 后端异步递归扫描图片、视频、JSON、TXT、YAML 和 names 文件，并支持协作式取消。
3. 格式适配器建立图片到 LabelMe、COCO 或 YOLO 标注的唯一匹配；优先级为 LabelMe、COCO、YOLO。
4. 图片缺少尺寸元数据时由 Sharp 读取真实尺寸；无效框被拒绝，归一化框被缩放并裁剪到图片边界。
5. 场景优先取标注明示字段，否则从图片上级语义目录推断，并跳过 `images/train/val` 等结构目录。
6. 图片和视频按 SHA-256 全局去重，对象只存一次；项目通过引用表关联资产。
7. 每次导入标注都生成不可覆盖的 `label_versions`，检测框写入统一内部模型。
8. 导入批次保留进度、警告和失败状态；进程重启时遗留运行任务会被安全标记为失败。

格式转换边界：内部模型目前是矩形检测框。LabelMe 点集、COCO segmentation 和 YOLO polygon 都取外接矩形，原始 COCO segmentation 作为属性保留，但导出不会重建原多边形。

## 路径模型

容器真实路径和页面显示路径必须成对配置：

- 数据集挂载：`DATA_ROOT` / `DATA_ROOT_DISPLAY`
- 全文件系统浏览：`BROWSE_ROOT` / `BROWSE_ROOT_DISPLAY`
- 导出目录：`EXPORT_ROOT` / `EXPORT_ROOT_DISPLAY`

每个入口使用自己的作用域映射，映射后还要通过 `path.relative` 校验不能越过对应根目录。即使两个 display root 相同，也不会把浏览请求错误映射到数据集挂载。

## 命名规则

内部对象名按 hash 存储，不依赖原始文件名。项目显示名和导出名使用：

```text
{view}_{scene}_{modality}_{index}.{ext}
```

LabelMe 导出的 `imagePath` 写成相对图片路径，例如：

```json
"imagePath": "../images/AerialView_Grassland_VIS_000001.jpg"
```

## 导出流水线

1. 一次查询加载项目图片和当前标注，避免逐图片 N+1 查询。
2. 对象从 MinIO 或只读兼容存储流式复制到导出目录。
3. 按用户选择生成 LabelMe、COCO 或 YOLO 文档。
4. 后台任务记录状态、输出目录和错误；导出根目录是唯一可写边界。

## 推理平台流程

推理平台按训练平台的 Run / Artifact / Model Version / Queue 思路组织：

```text
数据集项目 -> 模型簇 -> 推理模型版本 -> 推理模板/算法入口 -> 任务类型 -> 运行环境资产 -> 推理参数 -> 输出策略 -> 推理队列
```

推理任务提交后，后端先把选中的项目图片整理成任务级输入缓存，再由推理 worker 消费。输入范围支持全项目，也支持按场景、视角、模态、导入批次、类别、关键词和最大图片数筛选。

```text
PostgreSQL project_images/image_assets
  -> MinIO object_key
  -> runtime/cache/assets/images/<image_asset_id>.<ext>
  -> runtime/inference/<job_id>/input-cache/images/
```

运行环境采用 PostgreSQL 管元数据、MinIO 管制品的方式。现阶段支持登记服务器 Python 路径，也支持将服务器可访问的 conda-pack `.tar.gz` 环境包导入为运行环境资产。

## 测试与发布门禁

- `npm test`：Node 内置测试运行器验证格式转换、错误输入、场景推断和取消扫描。
- `npm run test:docker`：创建临时隔离目录和 Compose 项目，真实启动 PostgreSQL、MinIO、应用，执行 API 全流程与 Playwright 浏览器流程，结束后自动清理。
- Dockerfile 的 `test` 阶段在产生运行镜像前执行单元测试；失败时镜像不能生成。
- GitHub Actions 依次执行单元/构建验证、隔离集成测试和多架构镜像构建。

当前集成测试覆盖项目生命周期、三种格式导入导出、目录上级导航、场景/类别筛选、标注保存、视频资产、导入删除恢复、基准集合并、模型元数据与任务排队、请求体上限和路径穿越拒绝。按产品约束，测试不会实际执行训练或推理进程。

## 启动

```bash
cp .env.portable.example .env.portable
bash scripts/portable-start.sh
```

完整运行、配置、备份和排错说明见仓库根目录 `README.md`。
