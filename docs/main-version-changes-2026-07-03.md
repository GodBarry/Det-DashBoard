# 2026-07-03 版本相对 main 的变化

## 对比基线

- 主线基线：`e3fcd92`（Merge pull request #6 from GodBarry/lidong）
- 本版本定位：单机、单用户、可离线交付的 Docker 发布版本
- 目标系统：Ubuntu，安装 Docker 与 Docker Compose 后即可启动

## 用户能直接感受到的变化

### 项目和文件夹

- 新建项目后只显示删除入口，双击项目或文件夹进入。
- 项目计为第 1 级，最多创建到第 3 级；到达第 3 级后“新建文件夹”自动禁用。
- 每一级都有清楚的“返回上一级”和“根目录”入口。
- 页面上半部分固定显示下级文件夹，下半部分固定显示本级数据；没有数据时显示“该级文件夹无数据”。
- 根目录不直接导入数据，进入项目或下级文件夹后再导入。
- 数据预览显示当前文件在宿主机上的绝对路径。

### 部署和交付

- 新增完整离线发布包，内含应用、PostgreSQL 和 MinIO 镜像，不依赖目标机器联网拉取镜像。
- 解压后运行 `./start.sh` 即可启动，另有 `stop.sh`、`status.sh`、`logs.sh` 和 `diagnose.sh`。
- 默认只把 Web 端口绑定到 `127.0.0.1`，数据库和对象存储不对外暴露。
- 数据库、对象存储、导出结果和应用文件使用宿主机持久化目录，容器重建后数据仍保留。
- 应用可以只读浏览部署机器上的本地目录；默认映射当前用户主目录，也可在 `.env` 中修改。
- 新增一致性备份和恢复脚本：`backup.sh` 会备份 PostgreSQL、MinIO、应用存储和配置，`restore.sh` 可恢复到备份时状态。

### GPU、模型和 Python 环境

- 新增 `compose.gpu.yml`，启用后向应用容器申请 NVIDIA GPU。
- 支持把宿主机模型目录和 Python 环境目录按原绝对路径只读挂载到容器。
- 应用镜像内置 Python 3.11，CPU 基础流程无需额外安装 Python。
- GPU 模式要求宿主机同时具备可工作的 NVIDIA 驱动和 NVIDIA Container Toolkit。

## 代码和架构变化

- 保留“React 前端 + Node 模块化单体 + PostgreSQL + MinIO”，没有为单用户场景引入不必要的微服务。
- Docker 镜像改为多阶段构建，并在构建过程中执行单元测试和前端构建。
- 应用容器默认非 root、只读根文件系统、删除 Linux capabilities，并启用 `no-new-privileges`。
- PostgreSQL、MinIO 和应用均配置健康检查与依赖顺序。
- 基础镜像使用固定版本或 digest，减少不同机器构建结果漂移。
- 新增离线包构建、结构校验、冷启动和备份恢复自动化测试脚本。
- CI 在版本标签构建并发布离线压缩包。

## 已完成的验证

- 单元测试、前端生产构建和依赖安全检查通过。
- Docker API 集成测试通过。
- 浏览器端完整流程通过：三级目录、返回、YOLO 导入、筛选、绝对路径预览和 COCO 导出。
- 离线包镜像加载、冷启动、容器重启持久化、备份和恢复通过。
- CPU 与 GPU Compose 配置解析通过。
- 发布镜像内 Python 3.11 验证通过。

## 当前机器的 GPU 验证状态

当前机器检测到 NVIDIA 设备节点和 580.159.03 驱动模块，但仍存在两个宿主机问题：

1. 宿主机执行 `nvidia-smi` 时无法与驱动通信。
2. 未安装 `nvidia-container-toolkit`，Docker runtime 中没有 NVIDIA runtime。

因此 GPU Compose 配置已经验证，但真实 CUDA 任务尚不能标记为通过。修复宿主机后使用以下命令复验：

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi
```

两条命令通过后，在发布包 `.env` 中设置：

```dotenv
ENABLE_GPU=true
TRAINING_WORKER_ENABLED=true
INFERENCE_WORKER_ENABLED=true
```

然后执行 `./start.sh` 和 `./diagnose.sh`。

## 发布包

- 文件：`det-dashboard-0.1.0-20260703-linux-amd64.tar.gz`
- 大小：约 329 MB
- SHA256：`ba318fcda32659987b97c56c9fb4dc4eaa035ca5f862ede69e2c361e9aa8fdbe`

目标机器启动：

```bash
tar -xzf det-dashboard-0.1.0-20260703-linux-amd64.tar.gz
cd det-dashboard-0.1.0-20260703-linux-amd64
./start.sh
```
