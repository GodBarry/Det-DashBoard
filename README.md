# 目标检测数据集管理平台

React + Vite + Node.js 单页应用，用于管理目标检测数据集资产。当前主线已经从早期的“本地目录扫描原型”演进为 PostgreSQL + 对象存储的项目化工作台。

## 当前能力

- 项目管理：新建项目、项目回收站、恢复和清空回收站。
- 数据导入：从服务端路径递归导入图片、LabelMe JSON 和视频。
- 资产存储：图片和视频按 SHA256 去重，元数据写入 PostgreSQL，对象写入 MinIO；MinIO 不可用时后端会退回本地 fallback 对象目录。
- 数据预览：分页缩略图、场景/视角/模态/类别/导入批次筛选、详情面板。
- 标注编辑：图片查看器支持缩放、平移、左右切换、画框、移动/缩放框、删除框和保存标注。
- 导入管理：导入记录、导入取消、导入回收站。
- 导出：按 `dataset/images` 和 `dataset/jsons` 结构导出 LabelMe 数据。
- 基准数据集：多项目按图片资产去重，基于 IoU 和来源优先级生成基准项目。
- 模型平台雏形：模型族、模型版本、训练模板、Python 环境、训练队列、训练日志和推理任务记录。

## 主要入口

| 文件 | 作用 |
| --- | --- |
| `src/main.jsx` | 前端主应用，当前 UI 主要调用项目化 API。 |
| `server/postgres-app.js` | 正式后端入口，连接 PostgreSQL，并通过 MinIO/本地 fallback 存对象。 |
| `server.js` | 早期轻量后端，只做本地目录扫描、缩略图和导出；不匹配当前前端主线。 |
| `db/schema.sql` | 基础数据库 schema。部分新增表由 `server/postgres-app.js` 启动时补齐。 |
| `docs/architecture.md` | 原始正式架构说明。 |
| `docker-compose.yml` | PostgreSQL + MinIO 开发依赖。 |

## 运行要求

- Node.js 20+ 和 npm
- PostgreSQL 16+
- 可选：MinIO
- 可选：Docker Compose，用于一键启动 PostgreSQL 和 MinIO

当前仓库带有一个 `runtime/node/node.exe`，它是 Windows 可执行文件，Linux 下不能运行。

## 配置

后端通过环境变量读取配置：

```bash
PORT=4177
DATA_ROOT=/path/to/dataset-root
STORAGE_ROOT=/path/to/det-dashboard-storage
DATABASE_URL=postgres://det:det_password@localhost:5432/det_dashboard
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=zbh-datasets
```

Windows 原环境示例：

```powershell
$env:DATA_ROOT = "F:\ZBH"
$env:STORAGE_ROOT = "F:\ZBH\zhuji"
$env:DATABASE_URL = "postgres://det:det_password@localhost:5432/det_dashboard"
```

Linux 示例：

```bash
export DATA_ROOT="$PWD/runtime/data-root"
export STORAGE_ROOT="$PWD/runtime"
export DATABASE_URL="postgres://det:det_password@127.0.0.1:55434/det_dashboard"
```

注意：前端导入时填写的 `sourcePath` 必须位于 `DATA_ROOT` 之内，否则后端会拒绝导入。

## 使用 Docker Compose 启动依赖

复制并按机器情况调整 `.env.example`：

```bash
cp .env.example .env
```

启动 PostgreSQL 和 MinIO：

```bash
docker compose up -d
```

初始化 schema：

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

如果使用 Docker Compose 默认配置，连接串是：

```bash
export DATABASE_URL="postgres://det:det_password@localhost:5432/det_dashboard"
```

## 启动后端和前端

安装依赖：

```bash
npm install
```

启动正式后端：

```bash
npm run api:pg
```

另开终端启动前端：

```bash
npm run dev
```

默认访问：

- 前端：`http://localhost:5173`
- API：`http://localhost:4177`
- MinIO Console：`http://localhost:9001`

Vite 已把 `/api` 代理到 `http://localhost:4177`。

## 便携 Docker 一体启动

如果希望把项目复制到 U 盘，再放到另一台 Ubuntu 机器运行，推荐使用便携 Compose 配置。核心功能只要求目标机器安装 Docker 和 Docker Compose 插件。

目录约定：

```text
Det-DashBoard/
  datasets/          # 要导入的数据集目录，复制或挂载到这里
  portable-data/     # PostgreSQL、MinIO 和对象 fallback 数据
```

启动：

```bash
cd /path/to/Det-DashBoard
cp .env.portable.example .env.portable
# 首次运行前修改 .env.portable 中的数据库与 MinIO 密码
bash scripts/portable-start.sh
```

访问：

```text
http://localhost:5173
```

便携模式下，容器内的数据根目录是：

```text
/data/datasets
```

如果宿主机同时具备 Node.js、`zenity` 和图形会话，启动脚本会启动一个仅监听 `127.0.0.1:4178` 的文件夹选择桥接服务。“浏览”会优先调用宿主机原生选择器；桥接不可用时直接使用网页目录选择器，因此 Docker 核心功能不依赖宿主机 Node.js。取消原生选择不会触发回退。

便携模式默认将宿主机 `/` 以只读方式挂载到容器 `/host/browse`，所以网页目录选择器可以浏览整个 Ubuntu 文件系统，页面上仍显示宿主机原始路径。数据集目录另行只读挂载到 `/data/datasets`；PostgreSQL、MinIO 和应用持久数据保存在 `portable-data/`。默认导入会把对象写入 MinIO，移动源文件后仍可使用；只有明确设置 `OBJECT_STORE_WRITE_FALLBACK=true` 时才启用本地链接/回退模式。

导出不向只读的宿主机根挂载写数据，而是统一写入项目的 `exports/` 目录。可通过 `.env.portable` 的 `EXPORTS_DIR` 把该目录映射到其他宿主机位置。导出任务在后台执行，页面的任务进度不会被长时间 HTTP 请求阻塞。

所有端口默认仅绑定 `127.0.0.1`。本应用目前没有用户认证，不应直接暴露到公网或不可信局域网。如需收窄文件浏览范围，在 `.env.portable` 设置 `HOST_BROWSE_ROOT` 和 `BROWSE_ROOT_DISPLAY`。

构建并发布镜像：

```bash
docker build -t ghcr.io/<owner>/det-dashboard:<version> .
docker push ghcr.io/<owner>/det-dashboard:<version>
```

使用已发布镜像而不在目标机器重新构建：

```bash
APP_IMAGE=ghcr.io/<owner>/det-dashboard:<version> \
BUILD_LOCAL_IMAGE=false \
bash scripts/portable-start.sh
```

仓库内的 GitHub Actions 会在 `main`、`ZBH` 和 Pull Request 上执行前端与 Docker 多架构构建验证；推送 `v*` 标签时会把 `linux/amd64`、`linux/arm64` 镜像发布到当前仓库的 GHCR Package。

停止：

```bash
bash scripts/portable-stop.sh
```

## 使用 Docker 访问复制来的真实数据

如果要访问从另一台机器完整复制来的真实数据，使用专门的 compose 文件：

```bash
docker compose -f docker-compose.real-data.yml up -d
```

如果当前机器还没有 Docker，先执行：

```bash
bash scripts/install-docker-ubuntu.sh
newgrp docker
```

然后启动真实数据容器：

```bash
bash scripts/start-real-data-docker.sh
```

这个模式会启动：

- PostgreSQL 16：挂载 `runtime/postgres`，宿主机端口 `55432`
- MinIO：挂载 `runtime/minio`，API 端口 `9000`，控制台端口 `9001`

这些端口默认只绑定到 `127.0.0.1`，用于本机 API 访问。

启动 API 时切到真实数据连接串：

```bash
bash scripts/start-real-data-api.sh
```

真实数据模式下，`scripts/start-real-data-api.sh` 默认设置 `DATA_ROOT=/home/barry/图片`。导入框里填写的路径必须位于这个目录下，例如：

```text
/home/barry/图片/最新统计/统计用/山地
/home/barry/图片/统计用/山地
```

检查容器状态：

```bash
docker compose -f docker-compose.real-data.yml ps
docker logs det-dashboard-postgres-real
docker logs det-dashboard-minio-real
```

检查 PostgreSQL：

```bash
PATH="$PWD/.conda-det-dashboard/bin:$PATH" \
psql "postgres://det:det_password@127.0.0.1:55432/det_dashboard" -c "select current_database(), current_user;"
```

注意：

- `runtime/postgres` 是 PostgreSQL 16 数据目录，必须用 PostgreSQL 16 容器或 PG16 程序启动。
- `docker-compose.real-data.yml` 使用 `db/pg_hba.real-data.conf` 覆盖容器内认证配置，不直接修改 `runtime/postgres/pg_hba.conf`。该配置只用于本机开发，默认 trust 认证。
- 容器启动时会移除复制残留的 `runtime/postgres/postmaster.pid`，并把 `runtime/postgres` 目录权限改成 `700`，这是 PostgreSQL 接管复制数据目录所必需的。
- compose 默认用 `LOCAL_UID=1000` 和 `LOCAL_GID=1000` 运行 PostgreSQL，匹配当前 Linux 用户，避免 Docker 自动把复制来的数据目录改成容器用户所有。
- 如果当前机器没有 Docker，需要先安装 Docker 或换到已有 Docker 的机器运行这些命令。

## 当前 Linux 本地无 sudo 启动方式

如果机器没有系统级 Node.js、Docker 或 PostgreSQL，可以使用项目内 Conda 环境启动。本仓库当前已按这种方式验证过。

确认运行时：

```bash
cd /home/barry/projects/det-dashboard
PATH="$PWD/.conda-det-dashboard/bin:$PATH" node --version
PATH="$PWD/.conda-det-dashboard/bin:$PATH" npm --version
PATH="$PWD/.conda-det-dashboard/bin:$PATH" psql --version
```

安装/修复 Linux 原生依赖：

```bash
PATH="$PWD/.conda-det-dashboard/bin:$PATH" npm install
PATH="$PWD/.conda-det-dashboard/bin:$PATH" npm install --no-save --prefer-offline \
  @rolldown/binding-linux-x64-gnu@1.1.3 \
  lightningcss-linux-x64-gnu@1.32.0 \
  @img/sharp-linux-x64@0.35.2 \
  @img/sharp-libvips-linux-x64@1.3.1
```

当前复制来的 `runtime/postgres` 是 PostgreSQL 16 数据目录，而本地 Conda 提供的是 PostgreSQL 17，不要用 PG17 强行启动旧目录。没有 PostgreSQL 16 可执行文件时，使用新的开发目录：

```bash
mkdir -p runtime/postgres17-local runtime/pg-run-local runtime/data-root
PATH="$PWD/.conda-det-dashboard/bin:$PATH" initdb -D "$PWD/runtime/postgres17-local" --encoding=UTF8 --locale=C --auth=trust
PATH="$PWD/.conda-det-dashboard/bin:$PATH" pg_ctl \
  -D "$PWD/runtime/postgres17-local" \
  -l "$PWD/runtime/postgres17-local.log" \
  -o "-p 55434 -k $PWD/runtime/pg-run-local -c listen_addresses=127.0.0.1" \
  start
```

创建本地数据库并导入 schema：

```bash
PATH="$PWD/.conda-det-dashboard/bin:$PATH" psql -h 127.0.0.1 -p 55434 -d postgres \
  -c "CREATE ROLE det LOGIN PASSWORD 'det_password';" \
  -c "CREATE DATABASE det_dashboard OWNER det;"

PATH="$PWD/.conda-det-dashboard/bin:$PATH" psql -h 127.0.0.1 -p 55434 -U det -d det_dashboard -f db/schema.sql
```

启动 API：

```bash
PATH="$PWD/.conda-det-dashboard/bin:$PATH" \
PORT=4177 \
DATA_ROOT="$PWD/runtime/data-root" \
STORAGE_ROOT="$PWD/runtime" \
DATABASE_URL="postgres://det:det_password@127.0.0.1:55434/det_dashboard" \
MINIO_DATA_DIR="$PWD/runtime/minio" \
MINIO_ENDPOINT=127.0.0.1 \
MINIO_PORT=9000 \
MINIO_USE_SSL=false \
MINIO_ACCESS_KEY=minioadmin \
MINIO_SECRET_KEY=minioadmin \
MINIO_BUCKET=zbh-datasets \
TRAINING_WORKER_ENABLED=false \
npm run api:pg
```

启动前端：

```bash
PATH="$PWD/.conda-det-dashboard/bin:$PATH" npm run dev -- --host 0.0.0.0
```

已验证地址：

- 前端：`http://localhost:5173/`
- API：`http://localhost:4177/api/projects`

如果 MinIO 服务未启动，API 会打印 `MinIO unavailable, using local object files for reads and fallback for new objects`。读取时会直接查找 `runtime/minio/zbh-datasets/<object_key>` 和 `object-store-fallback/`；新写入对象会进入 `runtime/object-store-fallback/`。如果 MinIO 服务可用但单次读写失败，例如触发 MinIO 最低空闲磁盘阈值，API 也会退回本地 fallback。

真实数据模式下，`scripts/start-real-data-api.sh` 默认设置 `OBJECT_STORE_WRITE_FALLBACK=true`。导入本机已有图片时，fallback 会优先创建硬链接；如果系统策略不允许硬链接，会创建符号链接，避免把 `/home/barry/图片` 下的大图再复制一份到项目目录。

如果导入中途因为磁盘空间失败，可以先查看最近导入批次：

```bash
PATH="$PWD/.conda-det-dashboard/bin:$PATH" \
psql "postgres://det:det_password@127.0.0.1:55432/det_dashboard" \
  -c "select id, source_path, status, total_files, processed_files, message from import_batches order by created_at desc limit 5;"
```

确认某个失败批次只需要清理半成品后，可先 dry-run：

```bash
PATH="$PWD/.conda-det-dashboard/bin:$PATH" node scripts/cleanup-failed-import.js <import_batch_id>
```

再执行清理：

```bash
PATH="$PWD/.conda-det-dashboard/bin:$PATH" node scripts/cleanup-failed-import.js <import_batch_id> --apply
```

## 不使用 MinIO 的本地 fallback 模式

`server/object-store.js` 会在 MinIO 服务不可用时先读取复制来的 MinIO 磁盘布局：

```text
runtime/minio/zbh-datasets/<object_key>
```

它同时兼容 MinIO 的 `part.1` 对象布局。新对象会写入：

```text
<STORAGE_ROOT>/object-store-fallback/
```

这适合本地开发和抢救启动。已经写入数据库的对象 key 必须能在 MinIO、`runtime/minio/zbh-datasets` 或 fallback 目录中找到，否则预览会出现对象缺失错误。

## 数据导入流程

1. 新建项目。
2. 打开项目，点击“导入数据”。
3. 输入服务端可访问的目录，例如 `F:\ZBH\统计用\山地` 或 Linux 下的 `$DATA_ROOT/统计用/山地`。
4. 后端递归扫描图片、JSON 和视频。
5. JSON 优先按 `imagePath`、同名文件、`images/` 子目录等规则匹配图片。
6. 场景属性优先使用 JSON 的 `scene`；缺失时从图片目录向上推断，自动跳过 `images`、`jsons`、`annotations`、`train`、`val`、`visible`、`infrared` 等结构目录，采用最近的场景/日期分类目录。
7. 启动时会对结构明确的历史 `UnknownScene` 批次做保守回填；多场景且无法无歧义定位的旧批次不会被猜测性覆盖。
8. 每次导入生成新的 `label_versions`，并设置为项目 active label version。

支持的 LabelMe JSON 关键字段：

```json
{
  "shapes": [
    {
      "label": "gaoshepao",
      "points": [[1914, 770], [2251, 770], [2251, 903], [1914, 903]],
      "shape_type": "rectangle"
    }
  ],
  "imagePath": "../images/example.jpg",
  "imageHeight": 2160,
  "imageWidth": 3840,
  "view": "Aerial View",
  "scene": "Grassland",
  "keyword": ""
}
```

## 训练队列说明

训练任务由 `server/postgres-app.js` 内置 worker 轮询执行，默认启用：

```bash
TRAINING_WORKER_ENABLED=true npm run api:pg
```

如果只想启动 API，不自动执行训练：

```bash
TRAINING_WORKER_ENABLED=false npm run api:pg
```

训练目前按 Ultralytics YOLO 路径生成 YOLO 格式快照，并调用配置的 Python 解释器执行训练。要真正跑训练，Python 环境需要能导入 `ultralytics` 和 `torch`。

## 已知接手风险

- `README` 旧版描述的是 `server.js` 原型，不是当前正式主线；本文件已按当前代码更新。
- `db/schema.sql` 不是完整迁移系统，很多新表由后端启动时动态创建。
- 当前没有认证、租户隔离和 TLS，发布配置因此默认只监听 `127.0.0.1`；公网部署前必须增加反向代理认证与授权。
- 导入、导出和训练仍由 API 进程内后台任务执行；本次已支持重启失败收敛，但尚不是可跨节点恢复的持久任务队列。
- 当前日志里出现过 MinIO `NoSuchKey` 和 `XMinioStorageFull`，需要检查对象存储是否缺对象或底层磁盘是否已满。
- `server/postgres-app.js` 很大，聚合了导入、导出、基线、训练、推理和静态文件服务，后续建议拆分模块。
- `docker-compose.yml` 默认使用本仓库下的 `runtime/minio`；生产或大数据集场景应改到容量充足的磁盘。

## 快速排障

后端启动失败，先确认：

```bash
node --version
npm --version
psql "$DATABASE_URL" -c "select 1"
```

图片预览报 `NoSuchKey`：

- 检查 MinIO bucket `zbh-datasets` 是否存在。
- 检查数据库里的 `image_assets.object_key` 是否在 MinIO 或 `<STORAGE_ROOT>/object-store-fallback/` 中有对应文件。
- 如果导入时 MinIO 报 `XMinioStorageFull`，先清理或迁移 MinIO 数据目录，再重新导入缺失批次。

前端空白或 API 404：

- 确认运行的是 `npm run api:pg`，不是早期的 `node server.js`。
- 确认 Vite 代理端口和 `PORT` 一致，默认都是 `4177`。
