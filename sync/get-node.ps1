$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "node"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$out = Join-Path $dir "node.exe"
if (Test-Path $out) {
  Write-Host "Already have node.exe at $out"
  exit 0
}
$url = "https://nodejs.org/dist/v26.13.0/win-x64/node.exe"
Write-Host "Downloading official Node.js LTS for Windows from nodejs.org..."
Write-Host $url
Invoke-WebRequest -Uri $url -OutFile $out
Write-Host "Saved $out"
