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

echo ==== start %date% %time% ==== > run-web.log
node server\postgres-app.js >> run-web.log 2>&1
echo ==== node exited %errorlevel% %date% %time% ==== >> run-web.log
pause
endlocal
