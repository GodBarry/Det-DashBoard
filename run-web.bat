@echo off
cd /d E:\projects\det-dashboard
set "PORT=5173"
set "DATABASE_URL=postgres://det:det_password@127.0.0.1:5432/det_dashboard"
set "STORAGE_ROOT=F:\ZBH\zhuji"
set "DATA_ROOT=F:\ZBH"
node server\postgres-app.js
pause
