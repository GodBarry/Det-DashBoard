# Det Dashboard PostgreSQL + MinIO 迁移包

本目录提供 Ubuntu 24.04 上由 Podman 管理的 PostgreSQL 16 和 MinIO 镜像及启动文件。

## 1. 安装 Podman

```bash
sudo apt-get update
sudo apt-get install -y podman podman-compose curl
```

将整个迁移目录复制到服务器，例如 `/opt/det-dashboard/db-backup`，并准备运行时目录：

```bash
sudo mkdir -p /opt/det-dashboard/runtime/{postgres,minio}
sudo chown -R "$USER":"$USER" /opt/det-dashboard
```

## 2. 恢复 Windows 运行时数据

把 Windows 端 `DD-runtime/postgres` 的完整目录复制到 Ubuntu 的 `runtime/postgres`，把 `DD-runtime/minio` 的完整目录复制到 `runtime/minio`。必须保持 PostgreSQL 主版本为 16，并保持 MinIO 数据目录的全部层级和 `xl.meta` 文件，不要把 MinIO 对象目录当普通文件拆分或重命名。

## 3. 导入镜像并启动

```bash
cd /opt/det-dashboard/db-backup/ubuntu24.04
cp .env.example .env
chmod +x *.sh
./load-images.sh
./start.sh
./verify.sh
```

默认端口为 PostgreSQL `5432`、MinIO API `9000`、MinIO Console `9001`。生产环境请修改 `.env` 中的密码，并在防火墙中只开放需要的端口。

## 4. 校验数据

```bash
podman logs det-dashboard-postgres --tail 100
podman logs det-dashboard-minio --tail 100
podman exec det-dashboard-postgres psql -U det -d det_dashboard -c 'select now();'
```

如果使用逻辑备份而不是直接复制 PostgreSQL 数据目录，可在 Windows 端执行 `pg_dumpall` 后，在 Ubuntu PostgreSQL 容器中导入。MinIO 推荐复制完整数据目录或使用 `mc mirror`，不要只复制某个对象的内部目录。

## 5. 停止和迁移回滚

```bash
./stop.sh
```

停止容器不会删除运行时数据。迁移前应保留 Windows 端 `postgres` 和 `minio` 的只读备份，确认 `verify.sh` 和业务 API 均正常后再切换访问地址。
