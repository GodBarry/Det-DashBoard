@echo off
setlocal EnableExtensions EnableDelayedExpansion
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"

cd /d "%~dp0"
set "ROOT=%CD%"
if "%DET_DASHBOARD_RUNTIME%"=="" (
  set "RUNTIME_ROOT=E:\projects\DD-runtime"
) else (
  set "RUNTIME_ROOT=%DET_DASHBOARD_RUNTIME%"
)
set "ENV_FILE=%ROOT%\.env"
set "PODMAN=C:\Users\14226\AppData\Local\Programs\Podman\podman.exe"
set "NPM=%RUNTIME_ROOT%\node\npm.cmd"
set "PATH=%RUNTIME_ROOT%\node;%PATH%"
set "POSTGRES_CONTAINER=det-dashboard-postgres"
set "MINIO_CONTAINER=det-dashboard-minio"
set "POSTGRES_DB=det_dashboard"
set "POSTGRES_USER=det"
set "POSTGRES_PASSWORD=det_password"
set "POSTGRES_PORT=55432"
set "MINIO_PORT=9000"
set "MINIO_CONSOLE_PORT=9001"
set "MINIO_ACCESS_KEY=minioadmin"
set "MINIO_SECRET_KEY=minioadmin"
set "MINIO_BUCKET=zbh-datasets"
set "PORT=4177"
set "VITE_PORT=5173"

if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /r /v "^[ ]*$ ^[ ]*#" "%ENV_FILE%"`) do set "%%A=%%B"
)

if not exist "%PODMAN%" set "PODMAN=podman"
if exist "%RUNTIME_ROOT%\node\npm.cmd" set "NPM=%RUNTIME_ROOT%\node\npm.cmd"
set "PATH=%RUNTIME_ROOT%\node;%PATH%"
if not exist "%NPM%" (
  echo Missing runtime node: %NPM%
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

if not exist "%RUNTIME_ROOT%" mkdir "%RUNTIME_ROOT%"
if not exist "%RUNTIME_ROOT%\logs" mkdir "%RUNTIME_ROOT%\logs"
if not exist "%RUNTIME_ROOT%\postgres" mkdir "%RUNTIME_ROOT%\postgres"
if not exist "%RUNTIME_ROOT%\minio" mkdir "%RUNTIME_ROOT%\minio"
if not exist "%RUNTIME_ROOT%\data-root" mkdir "%RUNTIME_ROOT%\data-root"
if not exist "%RUNTIME_ROOT%\cache" mkdir "%RUNTIME_ROOT%\cache"
if not exist "%ROOT%\exports" mkdir "%ROOT%\exports"

if "%MINIO_DATA_DIR%"=="" set "MINIO_DATA_DIR=%RUNTIME_ROOT%\minio"
if "%POSTGRES_DATA_DIR%"=="" set "POSTGRES_DATA_DIR=%RUNTIME_ROOT%\postgres"
if /i "%MINIO_DATA_DIR%"=="./runtime/minio" set "MINIO_DATA_DIR=%RUNTIME_ROOT%\minio"
if /i "%POSTGRES_DATA_DIR%"=="./runtime/postgres" set "POSTGRES_DATA_DIR=%RUNTIME_ROOT%\postgres"
if not exist "%POSTGRES_DATA_DIR%" mkdir "%POSTGRES_DATA_DIR%"
if not exist "%MINIO_DATA_DIR%" mkdir "%MINIO_DATA_DIR%"

set "DATABASE_URL=postgres://%POSTGRES_USER%:%POSTGRES_PASSWORD%@127.0.0.1:%POSTGRES_PORT%/%POSTGRES_DB%"
set "MINIO_ENDPOINT=127.0.0.1"
set "MINIO_USE_SSL=false"
if "%DATA_ROOT%"=="" set "DATA_ROOT=%RUNTIME_ROOT%\data-root"
if "%DATA_ROOT_DISPLAY%"=="" set "DATA_ROOT_DISPLAY=%RUNTIME_ROOT%\data-root"
if "%BROWSE_ROOT%"=="" set "BROWSE_ROOT=%RUNTIME_ROOT%\data-root"
if "%BROWSE_ROOT_DISPLAY%"=="" set "BROWSE_ROOT_DISPLAY=%RUNTIME_ROOT%\data-root"
if "%STORAGE_ROOT%"=="" set "STORAGE_ROOT=%RUNTIME_ROOT%\cache"
if /i "%DATA_ROOT%"=="./runtime/data-root" set "DATA_ROOT=%RUNTIME_ROOT%\data-root"
if /i "%DATA_ROOT%"=="%ROOT%\runtime\data-root" set "DATA_ROOT=%RUNTIME_ROOT%\data-root"
if /i "%DATA_ROOT_DISPLAY%"=="./runtime/data-root" set "DATA_ROOT_DISPLAY=%RUNTIME_ROOT%\data-root"
if /i "%DATA_ROOT_DISPLAY%"=="%ROOT%\runtime\data-root" set "DATA_ROOT_DISPLAY=%RUNTIME_ROOT%\data-root"
if /i "%BROWSE_ROOT%"=="./runtime/data-root" set "BROWSE_ROOT=%RUNTIME_ROOT%\data-root"
if /i "%BROWSE_ROOT%"=="%ROOT%\runtime\data-root" set "BROWSE_ROOT=%RUNTIME_ROOT%\data-root"
if /i "%BROWSE_ROOT_DISPLAY%"=="./runtime/data-root" set "BROWSE_ROOT_DISPLAY=%RUNTIME_ROOT%\data-root"
if /i "%BROWSE_ROOT_DISPLAY%"=="%ROOT%\runtime\data-root" set "BROWSE_ROOT_DISPLAY=%RUNTIME_ROOT%\data-root"
if /i "%STORAGE_ROOT%"=="./runtime/cache" set "STORAGE_ROOT=%RUNTIME_ROOT%\cache"
if /i "%STORAGE_ROOT%"=="%ROOT%\runtime\cache" set "STORAGE_ROOT=%RUNTIME_ROOT%\cache"
set "API_LOG=%RUNTIME_ROOT%\logs\api.log"
set "WEB_LOG=%RUNTIME_ROOT%\logs\web.log"
set "TUNNEL_LOG=%RUNTIME_ROOT%\logs\podman-tunnel.log"

echo [1/7] Stop Windows services and stale Podman tunnels...
call :kill_port %PORT%
call :kill_port %VITE_PORT%
call :kill_port %POSTGRES_PORT%
call :kill_port %MINIO_PORT%
call :kill_port %MINIO_CONSOLE_PORT%

echo [2/7] Start Podman machine if needed...
"%PODMAN%" machine start >nul 2>nul
"%PODMAN%" info >nul 2>nul
if errorlevel 1 (
  echo Podman is not reachable. Try: podman machine init ^&^& podman machine start
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

echo Recreate data containers so moved Windows volumes are remounted correctly...
"%PODMAN%" stop %POSTGRES_CONTAINER% >nul 2>nul
"%PODMAN%" rm %POSTGRES_CONTAINER% >nul 2>nul
"%PODMAN%" stop %MINIO_CONTAINER% >nul 2>nul
"%PODMAN%" rm %MINIO_CONTAINER% >nul 2>nul
echo [3/7] Ensure PostgreSQL container with Windows data volume...
"%PODMAN%" container exists %POSTGRES_CONTAINER% >nul 2>nul
if errorlevel 1 (
  "%PODMAN%" run -d ^
    --name %POSTGRES_CONTAINER% ^
    -e POSTGRES_DB=%POSTGRES_DB% ^
    -e POSTGRES_USER=%POSTGRES_USER% ^
    -e POSTGRES_PASSWORD=%POSTGRES_PASSWORD% ^
    -p %POSTGRES_PORT%:5432 ^
    -v "%POSTGRES_DATA_DIR%:/var/lib/postgresql/data:Z,U" ^
    -v "%ROOT%\db\schema.sql:/docker-entrypoint-initdb.d/001_schema.sql:ro,Z" ^
    docker.io/library/postgres:16
) else (
  "%PODMAN%" start %POSTGRES_CONTAINER% >nul
)
if errorlevel 1 (
  echo PostgreSQL container failed to start.
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

echo [4/7] Ensure MinIO container with Windows data volume...
"%PODMAN%" container exists %MINIO_CONTAINER% >nul 2>nul
if errorlevel 1 (
  "%PODMAN%" run -d ^
    --name %MINIO_CONTAINER% ^
    -e MINIO_ROOT_USER=%MINIO_ACCESS_KEY% ^
    -e MINIO_ROOT_PASSWORD=%MINIO_SECRET_KEY% ^
    -p %MINIO_PORT%:9000 ^
    -p %MINIO_CONSOLE_PORT%:9001 ^
    -v "%MINIO_DATA_DIR%:/data:Z,U" ^
    docker.io/minio/minio:latest server /data --console-address ":9001"
) else (
  "%PODMAN%" start %MINIO_CONTAINER% >nul
)
if errorlevel 1 (
  echo MinIO container failed to start.
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

echo [5/7] Wait for containers and establish Windows tunnels...
for /l %%I in (1,1,60) do (
  "%PODMAN%" exec %POSTGRES_CONTAINER% pg_isready -U %POSTGRES_USER% -d %POSTGRES_DB% >nul 2>nul
  if not errorlevel 1 goto postgres_ready
  call :sleep 2
)
echo PostgreSQL did not become ready in Podman.
if not "%NO_PAUSE%"=="1" pause
exit /b 1

:postgres_ready
call :start_tunnel
if errorlevel 1 exit /b 1

for /l %%I in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-NetConnection 127.0.0.1 -Port %POSTGRES_PORT% -InformationLevel Quiet) { exit 0 } else { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto postgres_tunnel_ready
  call :sleep 1
)
echo PostgreSQL tunnel did not become ready on 127.0.0.1:%POSTGRES_PORT%.
if not "%NO_PAUSE%"=="1" pause
exit /b 1

:postgres_tunnel_ready
for /l %%I in (1,1,60) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%MINIO_PORT%/minio/health/live -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto minio_ready
  call :sleep 2
)
echo MinIO tunnel did not become ready on 127.0.0.1:%MINIO_PORT%.
if not "%NO_PAUSE%"=="1" pause
exit /b 1

:minio_ready
echo [6/7] Start Det Dashboard backend on http://127.0.0.1:%PORT% ...
start "det-dashboard-api" /D "%ROOT%" /min cmd /c ""%NPM%" run api:pg > "%API_LOG%" 2>&1"
for /l %%I in (1,1,45) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%PORT%/api/health/ready -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto api_ready
  call :sleep 2
)
echo Backend did not become ready. Last log:
type "%API_LOG%"
if not "%NO_PAUSE%"=="1" pause
exit /b 1

:api_ready
echo [7/7] Start Vite frontend on http://127.0.0.1:%VITE_PORT% ...
start "det-dashboard-web" /D "%ROOT%" /min cmd /c ""%NPM%" run dev -- --host 127.0.0.1 --port %VITE_PORT% > "%WEB_LOG%" 2>&1"
for /l %%I in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%VITE_PORT%/ -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto web_ready
  call :sleep 1
)
echo Frontend did not become ready. Last log:
type "%WEB_LOG%"
if not "%NO_PAUSE%"=="1" pause
exit /b 1

:web_ready
echo.
echo Det Dashboard is ready.
echo Frontend: http://127.0.0.1:%VITE_PORT%/
echo Backend : http://127.0.0.1:%PORT%/
echo MinIO   : http://127.0.0.1:%MINIO_CONSOLE_PORT%/  user=%MINIO_ACCESS_KEY% password=%MINIO_SECRET_KEY%
echo Data directories:
echo   PostgreSQL: %POSTGRES_DATA_DIR%
echo   MinIO     : %MINIO_DATA_DIR%
echo Logs:
echo   %API_LOG%
echo   %WEB_LOG%
echo   %TUNNEL_LOG%
echo.
if not "%NO_PAUSE%"=="1" pause
exit /b 0

:start_tunnel
for /f "tokens=1,2,* delims=|" %%A in ('%PODMAN% machine inspect --format "{{.SSHConfig.RemoteUsername}}|{{.SSHConfig.Port}}|{{.SSHConfig.IdentityPath}}"') do (
  set "PODMAN_SSH_USER=%%A"
  set "PODMAN_SSH_PORT=%%B"
  set "PODMAN_SSH_KEY=%%C"
)
if "%PODMAN_SSH_PORT%"=="" (
  echo Failed to read Podman machine SSH config.
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)
echo Establish SSH tunnel: Windows %POSTGRES_PORT%/%MINIO_PORT%/%MINIO_CONSOLE_PORT% -^> Podman machine %PODMAN_SSH_PORT% ...
start "det-dashboard-podman-tunnel" /min cmd /c ""ssh.exe" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -i "%PODMAN_SSH_KEY%" -p %PODMAN_SSH_PORT% -N -L %POSTGRES_PORT%:127.0.0.1:%POSTGRES_PORT% -L %MINIO_PORT%:127.0.0.1:%MINIO_PORT% -L %MINIO_CONSOLE_PORT%:127.0.0.1:%MINIO_CONSOLE_PORT% %PODMAN_SSH_USER%@127.0.0.1"
call :sleep 2
exit /b 0

:sleep
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds %~1" >nul
exit /b 0

:kill_port
set "TARGET_PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%TARGET_PORT% .*LISTENING"') do taskkill /F /PID %%P >nul 2>nul
exit /b 0

