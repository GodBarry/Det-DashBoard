# Det-DashBoard

Det-DashBoard 是一个面向目标检测数据集的本地管理平台，提供项目管理、多格式数据导入、场景属性识别、图片预览、LabelMe 标注、多格式数据导出、基准数据集合并以及模型任务管理。

当前正式运行架构为：

```text
Browser
   │ http://localhost:5173
   ▼
Node.js API + React 静态页面
   ├── PostgreSQL：项目、资产、标注、任务元数据
   ├── MinIO：图片、视频、JSON 和导出对象
   └── Ubuntu 只读目录挂载：浏览并导入本机数据
```

依赖服务通过 Podman/Docker Compose 运行，应用本体由 Node.js 直接启动，或用根目录 `Dockerfile` 构建镜像。

## 对外发布：Ubuntu 离线迁移包

`migration/ubuntu24.04/` 提供免构建的离线运行包，内含 PostgreSQL 16 与 MinIO 镜像 tar 包、Compose 配置和启停脚本，用于在 Ubuntu 24.04 上恢复数据并运行依赖服务：

```bash
cd migration/ubuntu24.04
./load-images.sh
./start.sh
./verify.sh
```

详细步骤见 [`migration/ubuntu24.04/README-UBUNTU24.md`](./migration/ubuntu24.04/README-UBUNTU24.md)。推送 `v*` 标签时，GitHub Actions 会构建并发布 `linux/amd64`、`linux/arm64` 应用镜像到 GHCR。

第一次接触本项目，建议直接阅读 [`docs/平台使用说明书.md`](./docs/平台使用说明书.md)，其中包含完整功能与操作流程。

## 功能概览

- 项目管理：新建、删除、回收站、恢复和永久清理。
- 数据导入：递归导入图片、视频、LabelMe、标准 COCO 和 YOLO 检测/分割标注。
- 资产去重：按照 SHA-256 去重，避免同一原始文件重复存储。
- 场景识别：优先读取 JSON 的 `scene`，缺失时从目录层级自动推断场景或日期。
- 数据浏览：分页缩略图、详情查看、缩放、平移和多条件筛选。
- 筛选属性：场景、视角、模态、标注类别和导入批次。
- 标注编辑：绘制、移动、缩放、删除检测框并保存 LabelMe 标注。
- 导入管理：查看进度、取消导入、删除批次和恢复批次。
- 数据导出：后台导出 LabelMe、标准 COCO 或 YOLO 检测数据集。
- 基准数据集：多项目资产去重、IoU 冲突检查和来源优先级合并。
- 模型平台：模型族、模型版本、训练模板、Python 环境、训练日志和推理任务记录。

## 快速开始

### 1. 环境要求

- Node.js `>=22.12.0` 和 npm
- Podman（或 Docker）及 Compose，用于运行 PostgreSQL 与 MinIO
- 足够容纳 PostgreSQL、MinIO 对象及导出数据的磁盘空间

Windows 下可直接运行 `restart-det-dashboard-podman.bat`，自动完成依赖启动、前端构建和前后端重启。

### 2. 克隆项目

```bash
git clone https://github.com/GodBarry/Det-DashBoard.git
cd Det-DashBoard
```

### 3. 首次配置

```bash
cp .env.example .env
npm ci
```

`.env` 不会提交到 Git；其中的密码和路径请按本机情况修改。

### 4. 启动依赖服务

```bash
podman compose -f podman-compose.yml up -d
```

该 Compose 只启动 PostgreSQL（`15432`）和 MinIO（`9000`/`9001`），数据持久化到 `runtime/`。使用 Docker 时请把 `podman` 换成 `docker`，并去掉卷挂载末尾的 `:Z,U` 标记。

### 5. 启动应用

```bash
npm run build
npm start
```

`npm start` 运行 Node.js API 并托管前端静态页面，访问 http://localhost:4177。

开发模式也可以前后端分离：

```bash
npm run api:pg   # API，http://localhost:4177
npm run dev      # Vite，http://localhost:5173，/api 代理到 4177
```

### 6. 停止

```bash
podman compose -f podman-compose.yml down
```

停止不会删除数据库、对象、导出结果或配置。

## 依赖服务与目录

### 服务

`podman-compose.yml` 只管理两个依赖服务；应用本体由 Node.js 直接运行，或通过根目录 `Dockerfile` 构建镜像运行。

| 服务 | 作用 | 默认宿主端口 |
| --- | --- | --- |
| `postgres` | 业务数据库 | `15432` |
| `minio` | 对象存储 API 和控制台 | `9000`、`9001` |

### 持久化目录

```text
Det-DashBoard/
├── runtime/
│   ├── postgres/             # PostgreSQL 数据
│   ├── minio/                # MinIO 对象
│   └── cache/                # 缩略图、临时文件和 fallback 对象（STORAGE_ROOT）
└── exports/                  # 导出结果
```

需要迁移或备份时，至少保存：

- `.env`
- `runtime/`
- `exports/`

## 配置说明

运行配置位于 `.env`，完整示例见 `.env.example`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `4177` | API 与静态页面端口 |
| `DATA_ROOT` / `DATA_ROOT_DISPLAY` | `./runtime/data-root` | 数据集来源根目录及页面显示路径 |
| `BROWSE_ROOT` / `BROWSE_ROOT_DISPLAY` | 同 `DATA_ROOT` | 网页目录选择器允许浏览的根目录 |
| `BROWSE_ALL_DRIVES` | `false` | Windows 下允许目录选择器列出全部盘符 |
| `HOST_PATH_MODE` | `posix` | 宿主路径格式；Windows 盘符模式设为 `windows` |
| `STORAGE_ROOT` | `./runtime/cache` | 缩略图、导出临时文件和对象 fallback 缓存根 |
| `EXPORT_ROOT` / `EXPORT_ROOT_DISPLAY` | `./exports` | 数据集导出目录 |
| `DATABASE_URL` | `postgres://det:det_password@localhost:15432/det_dashboard` | PostgreSQL 连接串 |
| `MINIO_*` | localhost:9000 | MinIO 连接、bucket 与数据目录，见 `.env.example` |

### 收窄文件系统访问范围

网页目录选择器只能浏览 `BROWSE_ROOT` 以内的路径。生产部署建议把它设置为专用数据目录，例如：

```dotenv
BROWSE_ROOT=/home/barry/图片
BROWSE_ROOT_DISPLAY=/home/barry/图片
```

Windows 下设置 `HOST_PATH_MODE=windows`；如需跨盘符浏览，再开启 `BROWSE_ALL_DRIVES=true`。

### 对象存储与 fallback

导入对象默认写入 MinIO，移动或删除原始文件后仍能使用，更适合备份和迁移。MinIO 暂时不可用时，后端使用 `STORAGE_ROOT` 下的本地 fallback 目录兜底，避免导入中断。

## 数据导入

### 基本流程

1. 打开 http://localhost:5173。
2. 新建项目并进入项目。
3. 点击“导入数据”。
4. 点击“浏览”或输入 Ubuntu 文件夹路径。
5. 确认目录后点击“开始导入”。
6. 在页面查看扫描与导入进度。

同一项目同一时间只允许一个导入任务。服务重启会将未完成任务标记为失败，避免任务永久停留在 `running`。

### 支持的文件

图片：

```text
.jpg .jpeg .png .bmp .webp
```

视频：

```text
.mp4 .avi .mov .mkv .wmv
```

标注：当前支持以下格式：

- LabelMe：每张图片一个 JSON，矩形或其他点集会统一转换为检测框。
- COCO：单个 JSON 中包含 `images`、`categories`、`annotations`；读取 `bbox`，同时保留 `segmentation` 等原始属性。
- YOLO：支持归一化检测框和多边形分割行；分割多边形导入后使用其外接检测框。类别名从 `data.yaml`、`dataset.yaml` 或 `.names` 读取。

LabelMe JSON 会按照以下顺序尝试匹配图片：

1. `imagePath` 相对路径。
2. JSON 同目录或上级目录中的图片。
3. 相邻 `images/` 目录。
4. 同名图片和 JSON。

支持类似 COCO 的目录组织方式，例如：

```text
2026-07-01/
├── images/
│   ├── 000001.jpg
│   └── 000002.jpg
└── jsons/
    ├── 000001.json
    └── 000002.json
```

同样支持标准 COCO 单文件，例如 `annotations/instances_train.json`。系统通过 COCO 的 `file_name` 匹配图片；当文件名重复且无法唯一确定时会跳过并记录警告，不会猜测错误图片。

典型 YOLO 目录：

```text
2026-07-01/
├── data.yaml
├── images/
│   ├── train/000001.jpg
│   └── val/000002.jpg
└── labels/
    ├── train/000001.txt
    └── val/000002.txt
```

### LabelMe JSON 示例

```json
{
  "imagePath": "../images/000001.jpg",
  "imageHeight": 2160,
  "imageWidth": 3840,
  "view": "AerialView",
  "scene": "Grassland",
  "keyword": "",
  "shapes": [
    {
      "label": "target",
      "points": [[1914, 770], [2251, 903]],
      "shape_type": "rectangle"
    }
  ]
}
```

### 场景属性自动识别

场景识别优先级：

1. 使用 JSON 中非空的 `scene`。
2. 从图片所在目录向上查找最近的语义目录。
3. 自动跳过结构目录，例如 `images`、`jsons`、`annotations`、`train`、`val`、`test`、`visible`、`infrared`、`可见光`、`红外`。
4. 对结构明确的历史 `UnknownScene` 批次进行保守回填。

例如：

```text
山地/2026-07-01/images/000001.jpg
```

系统会将场景识别为 `2026-07-01`。该值会自动出现在左侧“场景”筛选中。

## 数据导出

在项目工作台先选择 LabelMe、COCO 或 YOLO，再点击“导出数据集”。任务会在后台执行，结果写入带格式后缀的目录：

```text
exports/<项目名>_<时间戳>_<格式>/
```

- LabelMe：`images/` + `jsons/`，每张图片一个 JSON。
- COCO：`images/` + `annotations/instances.json`。
- YOLO：`images/` + `labels/` + `data.yaml`。

当前内部标注模型是矩形检测框，因此 COCO/YOLO 分割导入会转换为外接框；再次导出时不会恢复原始多边形轮廓。

通过 `.env` 修改导出位置：

```dotenv
EXPORT_ROOT=/mnt/datasets/exports
EXPORT_ROOT_DISPLAY=/mnt/datasets/exports
```

不要把整个宿主机文件系统以可写方式挂载给应用；自定义导出应始终使用专用挂载目录。

## 健康检查

应用提供：

```text
GET /api/health/live
GET /api/health/ready
```

检查：

```bash
curl -fsS http://localhost:5173/api/health/live
curl -fsS http://localhost:5173/api/health/ready
```

正常返回：

```json
{"status":"ok"}
```

## 备份与恢复

### 备份

先停止服务，保证文件一致性：

```bash
podman compose -f podman-compose.yml down
tar -czf det-dashboard-backup.tar.gz .env runtime exports
```

### 恢复

```bash
tar -xzf det-dashboard-backup.tar.gz
podman compose -f podman-compose.yml up -d
npm start
```

## 升级

```bash
podman compose -f podman-compose.yml down
git pull --ff-only
npm ci
npm run build
podman compose -f podman-compose.yml up -d
npm start
```

升级前建议先备份 `.env`、`runtime/` 和 `exports/`。

当前数据库新增结构由后端启动时补齐，但仓库尚未引入正式的版本化 migration 工具；跨大版本升级必须先备份。

## 使用已发布镜像

手动构建和推送：

```bash
docker build -t ghcr.io/godbarry/det-dashboard:<version> .
docker push ghcr.io/godbarry/det-dashboard:<version>
```

GitHub Actions 会验证 `main`、`ZBH` 和 Pull Request；推送 `v*` 标签时发布 `linux/amd64` 和 `linux/arm64` 镜像到 GHCR。

## 本地开发

### 要求

- Node.js `>=22.12.0`
- npm
- PostgreSQL
- MinIO，或允许本地 fallback

### 安装依赖

```bash
npm ci
```

### 启动开发依赖

```bash
cp .env.example .env
podman compose -f podman-compose.yml up -d
```

基础 schema 只会在全新 PostgreSQL 数据目录初始化时自动导入；已有独立数据库可手动执行：

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

### 启动后端

```bash
npm run api:pg
```

默认 API 地址：

```text
http://localhost:4177
```

### 启动前端

另开终端：

```bash
npm run dev
```

默认地址：

```text
http://localhost:5173
```

Vite 会把 `/api` 代理到 `http://localhost:4177`。

## 常用命令

```bash
# 构建前端
npm run build

# 运行快速单元测试
npm test

# 启动正式 Node.js 服务
npm start

# 查看依赖容器状态
podman compose -f podman-compose.yml ps

# 查看数据库日志
podman compose -f podman-compose.yml logs -f postgres

# 停止依赖服务
podman compose -f podman-compose.yml down
```

## 故障排查

### Docker 权限不足

错误：

```text
permission denied while trying to connect to the Docker daemon socket
```

处理：

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker info
```

### 页面或 API 无法访问

```bash
podman compose -f podman-compose.yml ps
curl -v http://localhost:4177/api/health/ready
```

开发模式下再确认 Vite 终端（`npm run dev`）没有报错。

### 文件夹选择器行为异常

网页内置目录选择器不依赖宿主组件，默认即可使用。`HOST_DIALOG_URL` 和 `NATIVE_DIALOG_MODE` 仅在自行部署原生目录选择桥接服务时使用；桥接不可用时页面会自动回退到内置选择器，不影响导入。

### “上一级”按钮不可用

网页选择器只能导航到 `BROWSE_ROOT_DISPLAY` 对应的浏览根。默认值是 `/`；如果配置为 `/home/barry/图片`，到达该目录后按钮按安全边界禁用。

### 场景显示 `UnknownScene`

- 检查 LabelMe JSON 是否包含 `scene`。
- 检查图片上级目录是否只有 `images`、`train` 等结构名称。
- 新导入会按目录自动推断；历史数据只在目录结构无歧义时回填。
- 查看项目导入批次的 `source_path` 是否仍能在宿主机访问。

### 图片显示失败或出现 `NoSuchKey`

表示数据库记录存在，但 MinIO 和 fallback 中都没有对应对象：

```bash
podman compose -f podman-compose.yml logs --tail 200 minio
```

检查 `runtime/minio`、`runtime/cache` 中的 fallback 对象和源文件是否完整。

### 磁盘空间不足

```bash
df -h
du -sh runtime/* exports
```

导入文件默认写入 MinIO；请为 `runtime/minio` 预留足够空间。失败或废弃的导入批次可在"导入管理"界面直接删除。

## 安全边界

- 当前应用没有账号认证、权限模型、租户隔离和 TLS。
- Docker 发布配置默认只允许本机访问，不要直接暴露到公网或不可信局域网。
- 如需远程部署，应在前方增加带认证和 TLS 的反向代理，并收窄 `BROWSE_ROOT`。
- PostgreSQL 和 MinIO 管理端口也默认只绑定 `127.0.0.1`。
- 不要提交 `.env`、数据库目录或访问密钥。

## 已知架构限制

- `server/postgres-app.js` 仍是较大的单体模块，后续应拆分导入、导出、标注和训练域。
- 数据库结构尚未采用版本化 migration 工具。
- 导入、导出和训练任务在 API 进程内执行，重启会安全标记为失败，但不能跨节点续跑。
- 内部标注模型当前只保存矩形框；COCO/YOLO 多边形会转换为外接框。
- 视频可以导入、去重和纳入项目统计，但尚无完整的浏览器内时间轴标注工作台。
- 训练依赖宿主或容器中可访问的 Python、Ultralytics、PyTorch 和模型文件路径；便携 Compose 默认关闭训练 worker。

## 项目结构

```text
Det-DashBoard/
├── src/                          # React 前端
├── server/
│   ├── postgres-app.js           # 正式 API 与任务入口
│   ├── dataset/                  # 项目、导入、基线、回收站服务
│   ├── ml-assets/                # 模型、算法资产与 Python 环境服务
│   ├── runtime-jobs/             # 训练/推理任务队列与 worker
│   ├── compute-tasks/            # 智能标注计算任务
│   ├── routes/                   # API 路由
│   ├── config.js                 # 环境配置
│   ├── object-store.js           # MinIO 与 fallback
│   └── utils.js                  # 文件扫描和属性推断
├── db/schema.sql                 # 基础数据库 schema
├── migration/ubuntu24.04/        # Ubuntu 离线迁移包（镜像 + Compose）
├── scripts/                      # 数据导入与盘点脚本
├── test/unit/                    # node:test 单元测试
├── Dockerfile                    # 多阶段生产镜像
├── podman-compose.yml            # PostgreSQL + MinIO 依赖服务
├── .env.example                  # 配置模板
└── .github/workflows/ci.yml      # CI 与 GHCR 发布
```

## License

仓库当前未声明开源许可证。对外分发、商业使用或接受外部贡献前，请由仓库所有者补充明确的 `LICENSE` 文件。
