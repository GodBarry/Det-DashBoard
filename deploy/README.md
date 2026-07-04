# Det-DashBoard 离线发布包

目标机器只需要 Ubuntu、Docker Engine 和 Docker Compose Plugin。

## 启动

```bash
./start.sh
```

首次启动会自动生成数据库和 MinIO 密码、载入离线镜像、创建持久化目录，并等待全部服务健康。访问 `http://localhost:5173`。

默认只允许应用浏览当前用户主目录，且为只读。需要浏览其他磁盘时，编辑 `.env`：

```dotenv
HOST_BROWSE_ROOT=/mnt/data
```

## GPU

目标机器需先安装 NVIDIA 驱动和 NVIDIA Container Toolkit。然后修改：

```dotenv
ENABLE_GPU=true
HOST_MODEL_ROOT=/absolute/path/to/models
HOST_PYTHON_ROOT=/absolute/path/to/linux/python-envs
```

宿主 Python 环境必须是 Linux 环境，并与容器的 Debian glibc 兼容；推荐使用 conda-pack 环境资产。

## 运维

```bash
./status.sh
./logs.sh
./backup.sh
./restore.sh backups/det-dashboard-backup-YYYYMMDD-HHMMSS.tar.gz
./stop.sh
./diagnose.sh
```

备份包含 PostgreSQL 逻辑转储、MinIO 对象、应用存储、导出结果、运行环境目录和配置。恢复前的现有文件会保存在 `backups/pre-restore-*`。
