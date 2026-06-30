@echo off
cd /d E:\projects\det-dashboard
set PORT=18083
set DATA_ROOT=F:\ZBH
set STORAGE_ROOT=F:\ZBH\zhuji
set DATABASE_URL=postgres://det:det_password@localhost:5432/det_dashboard
set MINIO_ENDPOINT=localhost
set MINIO_PORT=9000
set MINIO_USE_SSL=false
set MINIO_ACCESS_KEY=minioadmin
set MINIO_SECRET_KEY=minioadmin
set MINIO_BUCKET=zbh-datasets
"D:\Program Files\nodejs\node.exe" server\stable-app.js
