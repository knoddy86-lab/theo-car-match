@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Please right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Theo Car Match Sync" >nul 2>&1
netsh advfirewall firewall add rule name="Theo Car Match Sync" dir=in action=allow protocol=TCP localport=8787 profile=private
echo.
echo Firewall rule added: TCP port 8787, Private profile only (home/work Wi-Fi).
echo It is not opened on Public networks.
echo.
pause
