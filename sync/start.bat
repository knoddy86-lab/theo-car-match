@echo off
cd /d "%~dp0"
title Theo's Car Match sync
if not exist "node\node.exe" (
  echo node.exe is missing.
  echo Right-click get-node.ps1, choose "Run with PowerShell", then try start.bat again.
  pause
  exit /b 1
)
if not exist "game\index.html" (
  echo The game files are missing from the game folder.
  echo Copy index.html and the sounds folder from the theo-car-match project into game\
  pause
  exit /b 1
)
if not exist "data" mkdir data
echo.
echo  Starting Theo's Car Match family sync...
echo  Leave this window open while you play.
echo.
"node\node.exe" server.js
echo.
echo  Server stopped.
pause
