@echo off
setlocal

cd /d E:\projects\det-dashboard

set "PODMAN=C:\Users\14226\AppData\Local\Programs\Podman\podman.exe"
if not exist "%PODMAN%" set "PODMAN=podman"

set "CONFIG_FILE=det-dashboard.env"
if not exist "%CONFIG_FILE%" (
  echo Missing %CONFIG_FILE%. Please create it from .env.example.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in (`findstr /r /v "^[ ]*$ ^[ ]*#" "%CONFIG_FILE%"`) do (
  set "%%a=%%b"
)

echo [1/7] Stopping existing Node service on port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul
)

echo [2/7] Ensuring Podman machine and connection are ready...
"%PODMAN%" machine start >nul 2>nul
"%PODMAN%" info >nul 2>nul
if errorlevel 1 (
  echo Podman connection is not ready. Restarting Podman machine...
  "%PODMAN%" machine stop >nul 2>nul
  "%PODMAN%" machine start
  if errorlevel 1 (
    echo Podman machine failed to start.
    pause
    exit /b 1
  )
)

"%PODMAN%" info >nul 2>nul
if errorlevel 1 (
  echo Podman is still not reachable after machine restart.
  pause
  exit /b 1
)

"%PODMAN%" network exists det-network >nul 2>nul
if errorlevel 1 (
  "%PODMAN%" network create det-network
)

echo [3/7] Starting PostgreSQL and MinIO containers using Podman...
"%PODMAN%" start %POSTGRES_CONTAINER% %MINIO_CONTAINER%
if errorlevel 1 (
  echo Podman containers failed to start. Please make sure they exist.
  echo Expected containers: %POSTGRES_CONTAINER% %MINIO_CONTAINER%
  pause
  exit /b 1
)
"%PODMAN%" network connect det-network %POSTGRES_CONTAINER% >nul 2>nul
"%PODMAN%" network connect det-network %MINIO_CONTAINER% >nul 2>nul

echo Waiting for PostgreSQL to accept connections...
for /l %%i in (1,1,60) do (
  "%PODMAN%" exec %POSTGRES_CONTAINER% pg_isready -U det -d det_dashboard >nul 2>nul
  if not errorlevel 1 goto postgres_ready
  timeout /t 2 /nobreak >nul
)
echo PostgreSQL did not become ready in time.
pause
exit /b 1

:postgres_ready
echo PostgreSQL is ready.

echo [4/7] Runtime config loaded from %CONFIG_FILE%...
echo PORT=%PORT%
echo DATA_ROOT=%DATA_ROOT%
echo STORAGE_ROOT=%STORAGE_ROOT%
echo POSTGRES_CONTAINER=%POSTGRES_CONTAINER%
echo MINIO_CONTAINER=%MINIO_CONTAINER%

echo [5/7] Building the current det-dashboard application image...
"%PODMAN%" build -t localhost/det-dashboard:local .
if errorlevel 1 (
  echo det-dashboard application image build failed.
  pause
  exit /b 1
)

echo [6/7] Starting det-dashboard app container at http://127.0.0.1:%PORT%/
"%PODMAN%" stop det-dashboard-app >nul 2>nul
"%PODMAN%" rm det-dashboard-app >nul 2>nul
"%PODMAN%" run -d --name det-dashboard-app --network det-network -p %PORT%:4177 -v "%CD%\runtime\data-root:/data/datasets:ro" -v "%CD%\runtime\cache:/data/storage" -v "%CD%\exports:/data/exports" -e PORT=4177 -e DATA_ROOT=/data/datasets -e STORAGE_ROOT=/data/storage -e EXPORT_ROOT=/data/exports -e DATABASE_URL=postgres://det:det_password@det-dashboard-postgres:5432/det_dashboard -e MINIO_ENDPOINT=det-dashboard-minio -e MINIO_PORT=9000 -e MINIO_ACCESS_KEY=minioadmin -e MINIO_SECRET_KEY=minioadmin -e MINIO_BUCKET=zbh-datasets localhost/det-dashboard:local
if errorlevel 1 (
  echo det-dashboard app container failed to start.
  pause
  exit /b 1
)

echo [7/7] Establishing SSH Port-Forwarding Tunnel to Windows Host.
echo Keep this window open while using Det-DashBoard. Press Ctrl+C to stop the tunnel.
echo Open: http://127.0.0.1:%PORT%/
ssh.exe -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i C:\Users\14226\.local\share\containers\podman\machine\machine -p 64829 -N -L %PORT%:localhost:%PORT% root@127.0.0.1

endlocal

