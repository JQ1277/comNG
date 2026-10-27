@echo off
setlocal
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\comNG-runtime\node-v16.20.2-win-x64;%PATH%"
set "ELECTRON_RUN_AS_NODE="
node scripts\build-dev.js
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
