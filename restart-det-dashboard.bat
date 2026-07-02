@echo off
setlocal

cd /d E:\projects\det-dashboard

echo [1/5] Stopping existing Node service on port 4177...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4177" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul
)
taskkill /F /IM node.exe >nul 2>nul

echo [2/5] Starting Docker Desktop service if available...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Service com.docker.service -ErrorAction SilentlyContinue"

echo [3/5] Starting PostgreSQL and MinIO containers...
docker start det-dashboard-postgres det-dashboard-minio
if errorlevel 1 (
  echo Docker containers failed to start. Please make sure Docker Desktop is running.
  pause
  exit /b 1
)

echo [4/5] Setting runtime environment...
set PORT=4177
set DATA_ROOT=F:\ZBH
set STORAGE_ROOT=F:\ZBH\zhuji
set DATABASE_URL=postgres://det:det_password@localhost:5432/det_dashboard
set MINIO_ENDPOINT=localhost
set MINIO_PORT=9000
set MINIO_USE_SSL=false
set MINIO_ACCESS_KEY=minioadmin
set MINIO_SECRET_KEY=minioadmin
set MINIO_BUCKET=zbh-datasets

echo [5/5] Starting det-dashboard at http://127.0.0.1:4177/
echo Logs: api-run.out.log and api-run.err.log
npm.cmd run api:pg

endlocal
