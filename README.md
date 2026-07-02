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

推荐通过 Docker Compose 运行。开发模式也支持分别启动 PostgreSQL、MinIO、后端和 Vite。

第一次接触本项目，建议直接阅读 [`0702使用说明.md`](./0702使用说明.md)，其中包含本次改动前后对比、零基础安装、完整操作流程、数据格式、备份和故障排查。

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

推荐环境：

- Ubuntu 22.04 或更新版本
- Docker Engine
- Docker Compose Plugin（支持 `docker compose`）
- 至少 4 GB 可用内存
- 足够容纳 PostgreSQL、MinIO 对象及导出数据的磁盘空间

原生 Ubuntu 文件夹选择器还需要宿主机具有：

- Node.js
- `zenity`
- 可用的图形桌面会话

这些组件不是核心依赖；缺失时会自动使用网页文件夹选择器。

### 2. 克隆项目

```bash
git clone https://github.com/GodBarry/Det-DashBoard.git
cd Det-DashBoard
git switch ZBH
```

### 3. 首次配置

复制便携部署配置：

```bash
cp .env.portable.example .env.portable
```

编辑 `.env.portable`，至少修改以下密码：

```dotenv
POSTGRES_PASSWORD=请替换为强密码
MINIO_ROOT_PASSWORD=请替换为强密码
```

`.env.portable` 不会提交到 Git。

### 4. 启动

```bash
bash scripts/portable-start.sh
```

脚本会完成以下工作：

1. 创建运行数据目录。
2. 构建应用镜像。
3. 启动 PostgreSQL 和 MinIO。
4. 迁移旧版 root 数据目录权限。
5. 等待依赖和应用健康检查通过。
6. 在条件允许时启动 Ubuntu 原生目录选择桥接。

启动成功后访问：

- 应用：http://localhost:5173
- MinIO API：http://localhost:59000
- MinIO Console：http://localhost:59001
- PostgreSQL：`127.0.0.1:55432`

所有端口默认只监听 `127.0.0.1`。

### 5. 查看状态

```bash
docker compose --env-file .env.portable -f docker-compose.portable.yml ps
```

正常状态下，`app`、`postgres`、`minio` 应显示为 `healthy`；`permissions` 是一次性初始化服务，正常状态为退出码 `0`。

查看日志：

```bash
docker compose --env-file .env.portable -f docker-compose.portable.yml logs -f app
docker compose --env-file .env.portable -f docker-compose.portable.yml logs -f postgres
docker compose --env-file .env.portable -f docker-compose.portable.yml logs -f minio
```

### 6. 停止

```bash
bash scripts/portable-stop.sh
```

停止不会删除数据库、对象、导出结果或配置。

## Docker 服务与目录

### 服务

| 服务 | 作用 | 默认宿主端口 |
| --- | --- | --- |
| `app` | Node.js API、任务执行和 React 页面 | `5173` |
| `postgres` | 业务数据库 | `55432` |
| `minio` | 对象存储 API 和控制台 | `59000`、`59001` |
| `permissions` | 一次性迁移持久化目录 UID/GID | 无 |

### 持久化目录

```text
Det-DashBoard/
├── datasets/                 # 默认数据集挂载目录
├── exports/                  # 导出结果
└── portable-data/
    ├── postgres/             # PostgreSQL 数据
    ├── minio/                # MinIO 对象
    └── storage/              # 缩略图、临时文件和 fallback 对象
```

需要迁移或备份时，至少保存：

- `.env.portable`
- `portable-data/`
- `exports/`
- 仍采用链接模式时的原始数据目录

## 配置说明

便携部署配置位于 `.env.portable`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_BIND_ADDRESS` | `127.0.0.1` | Web 服务监听地址 |
| `APP_PORT` | `5173` | Web 服务宿主端口 |
| `APP_IMAGE` | `det-dashboard:local` | 应用镜像名称 |
| `BUILD_LOCAL_IMAGE` | `true` | 是否在启动时构建镜像 |
| `DB_PORT` | `55432` | PostgreSQL 宿主端口 |
| `POSTGRES_DB` | `det_dashboard` | 数据库名称 |
| `POSTGRES_USER` | `det` | 数据库用户 |
| `POSTGRES_PASSWORD` | 无安全默认值 | 数据库密码 |
| `MINIO_HOST_PORT` | `59000` | MinIO API 宿主端口 |
| `MINIO_CONSOLE_HOST_PORT` | `59001` | MinIO 控制台宿主端口 |
| `MINIO_ROOT_USER` | `minioadmin` | MinIO 管理用户 |
| `MINIO_ROOT_PASSWORD` | 无安全默认值 | MinIO 管理密码 |
| `MINIO_BUCKET` | `zbh-datasets` | 对象 bucket |
| `HOST_BROWSE_ROOT` | `/` | 容器允许浏览的宿主目录 |
| `BROWSE_ROOT_DISPLAY` | `/` | 页面显示的浏览根路径 |
| `EXPORTS_DIR` | `./exports` | 宿主机导出目录 |
| `OBJECT_STORE_WRITE_FALLBACK` | `false` | 是否使用本地链接/fallback 写入模式 |

### 收窄文件系统访问范围

默认配置将 Ubuntu `/` 只读挂载到容器，便于浏览整个本机文件系统。若只需访问指定数据目录，建议改为：

```dotenv
HOST_BROWSE_ROOT=/home/barry/图片
BROWSE_ROOT_DISPLAY=/home/barry/图片
```

该挂载始终为只读；应用只会写入专用的 `portable-data/storage` 和 `exports` 挂载。

### 独立对象模式与链接模式

默认设置：

```dotenv
OBJECT_STORE_WRITE_FALLBACK=false
```

导入对象会写入 MinIO，移动或删除原始文件后仍能使用，更适合备份和迁移。

设置为 `true` 时，后端优先创建硬链接或符号链接，减少大数据集的重复占用：

```dotenv
OBJECT_STORE_WRITE_FALLBACK=true
```

链接模式依赖原文件路径；移动、重命名或删除源数据会造成对象不可读。

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

通过 `.env.portable` 修改导出位置：

```dotenv
EXPORTS_DIR=/mnt/datasets/exports
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
bash scripts/portable-stop.sh
tar -czf det-dashboard-backup.tar.gz .env.portable portable-data exports
```

如果启用了链接模式，还必须同时备份原始数据目录。

### 恢复

```bash
tar -xzf det-dashboard-backup.tar.gz
bash scripts/portable-start.sh
```

启动脚本会自动处理旧版 root 容器遗留的持久化目录权限。

## 升级

```bash
bash scripts/portable-stop.sh
git pull --ff-only
bash scripts/portable-start.sh
```

升级前建议先备份 `.env.portable`、`portable-data/` 和 `exports/`。

当前数据库新增结构由后端启动时补齐，但仓库尚未引入正式的版本化 migration 工具；跨大版本升级必须先备份。

## 使用已发布镜像

默认启动脚本会在本机构建镜像。若镜像已发布到 registry：

```bash
APP_IMAGE=ghcr.io/godbarry/det-dashboard:<version> \
BUILD_LOCAL_IMAGE=false \
bash scripts/portable-start.sh
```

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
docker compose up -d
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

# 构建隔离 Docker 栈并运行 API + Chrome 端到端测试
PLAYWRIGHT_CHANNEL=chrome npm run test:docker

# 启动正式 Node.js 服务
npm start

# 查看容器状态
docker compose --env-file .env.portable -f docker-compose.portable.yml ps

# 查看应用日志
docker compose --env-file .env.portable -f docker-compose.portable.yml logs -f app

# 重启应用
docker compose --env-file .env.portable -f docker-compose.portable.yml restart app

# 停止完整栈
bash scripts/portable-stop.sh
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

### 5173 无法访问

```bash
docker compose --env-file .env.portable -f docker-compose.portable.yml ps
docker compose --env-file .env.portable -f docker-compose.portable.yml logs --tail 100 app
curl -v http://localhost:5173/api/health/ready
```

### 文件夹选择器没有弹出

检查宿主机：

```bash
command -v node
command -v zenity
echo "$DISPLAY"
cat portable-data/folder-dialog.log
```

原生桥接失败时网页会自动使用内置目录选择器，不影响导入。

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
docker compose --env-file .env.portable -f docker-compose.portable.yml logs --tail 200 app
docker compose --env-file .env.portable -f docker-compose.portable.yml logs --tail 200 minio
```

检查 `portable-data/minio`、`portable-data/storage/object-store-fallback` 和源文件是否完整。

### 磁盘空间不足

```bash
df -h
du -sh portable-data/* exports
```

默认独立对象模式会把导入文件写入 MinIO；请为 `portable-data/minio` 预留足够空间。

### 清理失败导入

先 dry-run：

```bash
node scripts/cleanup-failed-import.js <import_batch_id>
```

确认后执行：

```bash
node scripts/cleanup-failed-import.js <import_batch_id> --apply
```

使用该脚本前需要设置正确的 `DATABASE_URL`。

## 安全边界

- 当前应用没有账号认证、权限模型、租户隔离和 TLS。
- Docker 发布配置默认只允许本机访问，不要直接暴露到公网或不可信局域网。
- 如需远程部署，应在前方增加带认证和 TLS 的反向代理，并收窄 `HOST_BROWSE_ROOT`。
- PostgreSQL 和 MinIO 管理端口也默认只绑定 `127.0.0.1`。
- 不要提交 `.env`、`.env.portable`、数据库目录或访问密钥。

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
│   ├── dataset-formats.js        # LabelMe/COCO/YOLO 导入适配器
│   ├── export-formats.js         # LabelMe/COCO/YOLO 导出适配器
│   ├── config.js                 # 环境配置
│   ├── db.js                     # PostgreSQL 连接池
│   ├── object-store.js           # MinIO 与 fallback
│   └── utils.js                  # 文件扫描和属性推断
├── db/schema.sql                 # 基础数据库 schema
├── scripts/
│   ├── portable-start.sh         # Docker 一键启动
│   ├── portable-stop.sh          # Docker 一键停止
│   ├── folder-dialog-bridge.js   # Ubuntu 原生目录选择桥接
│   └── cleanup-failed-import.js  # 失败导入清理工具
├── test/
│   ├── unit/                     # 格式、导出和场景推断单元测试
│   ├── integration/              # 真实 PostgreSQL/MinIO API 流程
│   └── e2e/                      # Playwright 浏览器流程
├── playwright.config.js          # 浏览器测试配置
├── Dockerfile                    # 多阶段生产镜像
├── docker-compose.portable.yml   # 推荐发布拓扑
├── docker-compose.yml            # 本地开发依赖
├── .env.portable.example         # 发布配置模板
└── .github/workflows/ci.yml      # CI 与 GHCR 发布
```

## License

仓库当前未声明开源许可证。对外分发、商业使用或接受外部贡献前，请由仓库所有者补充明确的 `LICENSE` 文件。
