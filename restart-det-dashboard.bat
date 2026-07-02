@echo off
setlocal

cd /d E:\projects\det-dashboard

set "CONFIG_FILE=det-dashboard.env"
if not exist "%CONFIG_FILE%" (
  echo Missing %CONFIG_FILE%. Please create it from .env.example.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in (`findstr /r /v "^[ ]*$ ^[ ]*#" "%CONFIG_FILE%"`) do (
  set "%%a=%%b"
)

echo [1/5] Stopping existing Node service on port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul
)
taskkill /F /IM node.exe >nul 2>nul

echo [2/5] Starting Docker Desktop service if available...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Service com.docker.service -ErrorAction SilentlyContinue"

echo [3/5] Starting PostgreSQL and MinIO containers...
docker start %POSTGRES_CONTAINER% %MINIO_CONTAINER%
if errorlevel 1 (
  echo Docker containers failed to start. Please make sure Docker Desktop is running.
  pause
  exit /b 1
)

echo Waiting for PostgreSQL to accept connections...
for /l %%i in (1,1,60) do (
  docker exec %POSTGRES_CONTAINER% pg_isready -U det -d det_dashboard >nul 2>nul
  if not errorlevel 1 goto postgres_ready
  timeout /t 2 /nobreak >nul
)
echo PostgreSQL did not become ready in time.
pause
exit /b 1

:postgres_ready
echo PostgreSQL is ready.

echo [4/5] Runtime config loaded from %CONFIG_FILE%...
echo PORT=%PORT%
echo DATA_ROOT=%DATA_ROOT%
echo STORAGE_ROOT=%STORAGE_ROOT%
echo POSTGRES_CONTAINER=%POSTGRES_CONTAINER%
echo MINIO_CONTAINER=%MINIO_CONTAINER%

echo [5/5] Starting det-dashboard at http://127.0.0.1:%PORT%/
echo Logs: api-run.out.log and api-run.err.log
npm.cmd run api:pg

endlocal
