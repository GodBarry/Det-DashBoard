# 离线 Docker 发布架构

```text
Ubuntu browser :5173
        │
        ▼
Det-DashBoard app (read-only rootfs, non-root)
   ├── PostgreSQL (private Compose network, persistent bind mount)
   ├── MinIO      (private Compose network, persistent bind mount)
   ├── host browse root (read-only, real Ubuntu paths)
   ├── app storage / exports (dedicated writable mounts)
   └── optional NVIDIA GPU + same-path model/Python mounts
```

## 设计原则

- 单机单用户采用模块化单体，不引入服务发现、消息集群或反向代理。
- 只发布应用端口；PostgreSQL 和 MinIO 不暴露宿主端口。
- 应用容器无 root 权限、根文件系统只读、移除 capabilities。
- 数据独立于容器生命周期；升级只替换镜像和部署文件。
- 压缩包包含固定版本的全部镜像，目标机不需要互联网。
- 数据库用逻辑备份，MinIO 在停止写入后做文件级归档。

## 发布包

```text
det-dashboard-<version>-linux-<arch>/
├── start.sh / stop.sh / status.sh / logs.sh
├── backup.sh / restore.sh / diagnose.sh
├── compose.yml / compose.gpu.yml
├── env.example
├── images/offline-images.tar.gz
├── db/schema.sql
├── VERSION / SOURCE_COMMIT / SHA256SUMS
├── portable-data/                 # 首次运行后持久化
├── exports/
├── runtime-assets/models/
└── runtime-assets/python-envs/
```

`start.sh` 是唯一必要入口：自动配置、载入镜像、创建目录、校验 GPU 前提并等待健康状态。

## GPU 与运行环境

基础应用镜像仅包含 Python 3。CUDA、PyTorch、Ultralytics 等大型环境不固化进通用镜像，因为它们与 GPU 驱动、CUDA 版本和算法高度耦合。发布配置将宿主 Linux Python/conda-pack 环境和模型根目录以相同绝对路径只读挂载，任务元数据可直接引用真实路径。

启用 GPU 前，宿主机必须配置 NVIDIA 驱动和 NVIDIA Container Toolkit。无 GPU 机器继续使用相同发布包，保持 `ENABLE_GPU=false`。

## 升级规则

1. 先执行 `backup.sh`。
2. 解压新版本到新目录。
3. 复制旧 `.env` 与持久化目录，或恢复备份。
4. 执行新版本 `start.sh`。
5. 验证 `status.sh` 后再保留或删除旧目录。

不要直接覆盖唯一一份发布目录；使用并列版本目录可以快速回退应用镜像和部署脚本。
