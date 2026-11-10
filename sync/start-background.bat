@echo off
cd /d "%~dp0"
if not exist "node\node.exe" exit /b 1
if not exist "logs" mkdir logs
if not exist "data" mkdir data
"node\node.exe" server.js >> "logs\server.log" 2>&1
