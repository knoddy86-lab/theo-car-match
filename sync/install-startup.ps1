$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$vbs = Join-Path $dir "start-hidden.vbs"
if (-not (Test-Path (Join-Path $dir "node\node.exe"))) {
  Write-Host "Run get-node.ps1 first, then start.bat once, then this script."
  exit 1
}
# Starts the server when you sign in to Windows, without a visible window.
# Logs go to the logs\server.log file in this folder.
schtasks /Create /TN "Theo Car Match Sync" /TR "wscript.exe `"$vbs`"" /SC ONLOGON /RL LIMITED /F
Write-Host "Startup task created: Theo Car Match Sync"
Write-Host "It will start when you sign in to this PC. The family key is in data\family-key.txt"
Write-Host "To remove it later: schtasks /Delete /TN `"Theo Car Match Sync`" /F"
