@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=%PORT%
if "%PORT%"=="" set PORT=8765
if exist "node\node.exe" (set NODE=node\node.exe) else (set NODE=node)
start "AlphaSun 北海极端气候全景系统" cmd /k "%NODE% server.js"
timeout /t 3 >nul
start "" http://localhost:%PORT%
