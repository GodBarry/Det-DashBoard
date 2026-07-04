# Det-DashBoard 离线发布包

目标机器需要 Ubuntu、Docker Engine 和 Docker Compose Plugin。要弹出部署机原生文件选择器，还需要桌面会话、Python 3 和 Zenity：

```bash
sudo apt install -y python3 zenity
```

无桌面环境时应用仍可运行，并会保留手动绝对路径和网页文件夹浏览作为降级方式。

## 启动

```bash
./start.sh
```

首次启动会自动生成数据库和 MinIO 密码、载入离线镜像、创建持久化目录，并等待全部服务健康。访问 `http://localhost:5173`。

点击“导入数据”会在部署本应用的 Ubuntu 机器上打开系统选择器，支持文件夹、单文件和多文件。局域网客户端访问时，窗口仍弹在服务器桌面，不会弹在客户端电脑。

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
