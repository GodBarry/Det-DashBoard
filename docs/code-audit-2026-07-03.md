# Det-DashBoard 全量代码与发布审查（2026-07-03）

## 结论

面向“单机、单用户、Ubuntu、Docker Compose、离线压缩包”的目标，最合适的架构不是微服务，而是边界清晰的模块化单体：一个无状态 Web/API 容器，PostgreSQL 保存事务元数据，MinIO 保存不可变资产，宿主目录只读挂载，专用目录承担持久化写入。

现有业务功能和自动化测试基础较好。最高风险不在算法，而在发布闭环：源码构建依赖网络、没有离线镜像、备份不是一致性备份、GPU 没有标准 Compose 覆盖、数据库迁移仍嵌在启动代码、大型前后端文件增加改动风险。

## 已在本次修复的发布问题

| 等级 | 问题 | 处理 |
| --- | --- | --- |
| 高 | 目标机器首次启动仍需联网构建/拉镜像 | 发布包内置 `docker save` 镜像归档，启动时自动 `docker load` |
| 高 | 备份直接打包运行中的 PostgreSQL/MinIO，存在不一致风险 | PostgreSQL 使用 `pg_dump -Fc`；停止写入方并静默 MinIO 后归档对象与应用数据 |
| 高 | 恢复没有安全回退 | 恢复前把现有数据移入 `backups/pre-restore-*`，再执行 `pg_restore` |
| 高 | 发布物不可校验 | 压缩包和内部文件均生成 SHA-256 清单，提供独立验证脚本 |
| 中 | GPU 运行没有正式配置 | 增加 Compose GPU override，按官方 device reservation 声明 GPU |
| 中 | 宿主模型/Python 环境路径进入容器后失真 | 以相同绝对路径只读挂载模型和 Linux Python 环境根目录 |
| 中 | 运行镜像没有 Python 基线 | 增加 Python 3/venv；大型 ML/CUDA 环境仍作为独立资产挂载 |
| 中 | 发布和开发 Compose 混在一起 | `deploy/` 成为发布契约，源码 portable Compose 保留开发/测试用途 |
| 中 | 默认密码写死 | 发布包首次启动自动生成随机数据库和 MinIO 密码，配置权限设为 600 |
| 低 | 缺少统一状态和诊断入口 | 增加 `status.sh`、`logs.sh`、`diagnose.sh` |

## 代码逻辑梳理

### 前端

`src/main.jsx` 负责项目目录、导入、筛选、预览、标注、基准集、训练、推理与评估；`src/styles.css` 承担全站样式。React 状态直接调用 REST API，后台任务通过轮询刷新。

主要风险：两个文件分别超过两千和三千行，功能之间共享状态过多，局部改动容易产生回归。建议按业务页面拆成 `features/projects`、`features/assets`、`features/annotations`、`features/ml`，公共 API 调用进入 `lib/api`。拆分必须分 PR 进行，并保持现有 E2E 先行，不应与发布改造混在一次大提交中。

### 后端

`server/postgres-app.js` 同时承担 HTTP 路由、schema 补齐、项目/资产/标注、导入导出、基准集和 ML worker；格式适配、对象存储、数据库连接与通用文件逻辑已拆到独立模块。

主要风险：路由和事务边界集中在约 3600 行文件中；启动时 DDL 不是正式迁移系统；导入、训练、推理 worker 与 API 同进程。建议下一阶段先引入 `db/migrations` 和迁移表，再按领域抽取 service/router；单机版本不需要拆成网络微服务。

### 数据与路径

- PostgreSQL：项目关系、标注、任务、引用和状态。
- MinIO：图片、视频、原始标注、模型与算法资产。
- `portable-data/storage`：缓存、临时文件和运行目录。
- `exports`：用户可直接访问的导出结果。
- `HOST_BROWSE_ROOT`：只读宿主文件树；页面显示真实 Ubuntu 绝对路径。

默认独立对象模式会把导入资产复制到 MinIO，因此原文件移动后核心资产仍可用。宿主浏览根应尽量收窄到当前用户主目录或数据盘，而不是默认挂载 `/`。

## 保留的架构债务与优先级

1. **P0：版本化数据库迁移。** 当前启动 DDL 能兼容迭代，但缺少不可变版本、升级审计和回滚说明。
2. **P1：拆分 `postgres-app.js`。** 先抽项目/资产/导入导出，再抽 ML worker；保持单进程部署。
3. **P1：拆分 `main.jsx`。** 以现有页面边界拆 feature，不引入新的全局状态框架，除非跨模块状态已无法控制。
4. **P1：真实 GPU 训练验收。** 当前只验证 GPU 容器配置和任务编排；每个算法环境仍需固定 CUDA、PyTorch 和模型版本。
5. **P2：独立 worker。** 只有当单机长任务影响 API 响应时，再把 worker 作为同一 Compose 内的独立进程，而非远程微服务。
6. **P2：可观测性。** 增加结构化日志、任务耗时和磁盘容量告警；单机版暂不需要复杂监控集群。

## 官方实践对照

- Docker 建议用健康检查和 `depends_on: condition: service_healthy` 消除依赖启动竞态：<https://docs.docker.com/compose/how-tos/startup-order/>
- Docker 明确区分持久卷、bind mount 与临时 `tmpfs`：<https://docs.docker.com/engine/storage>
- 离线镜像通过 `docker image save` 与 `docker load` 迁移：<https://docs.docker.com/reference/cli/docker/image/save/>
- Compose GPU 使用 device reservations 且必须声明 `capabilities: [gpu]`：<https://docs.docker.com/compose/how-tos/gpu-support/>
- NVIDIA GPU 需要宿主驱动、Container Toolkit 和 Docker runtime 配置：<https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html>
- PostgreSQL 一致性逻辑备份使用 `pg_dump`，自定义格式通过 `pg_restore` 恢复：<https://www.postgresql.org/docs/current/backup-dump.html>

## 发布验收门禁

发布前必须全部通过：

1. Node 单元测试与生产构建。
2. Docker API + Playwright E2E。
3. 离线包内部 SHA-256 校验。
4. 在无源码目录中解压、载入镜像并冷启动。
5. 创建数据后重启，验证持久化。
6. 逻辑备份、破坏测试数据、恢复并核对数据。
7. `diagnose.sh` 无配置或健康错误。

GPU 属于条件验收：没有 NVIDIA GPU 的构建机只能验证 Compose 配置；正式 GPU 发布必须在目标 GPU 机器上额外执行 `nvidia-smi` 和真实算法最小任务。
