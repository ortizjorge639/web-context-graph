param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8000 })
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Url = "http://${HostName}:${Port}"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

foreach ($Command in @("git", "python", "npm", "copilot")) {
  Require-Command $Command
}

python -c "import sys; sys.exit('Python 3.11 or newer is required') if sys.version_info < (3, 11) else None"

copilot --version | Out-Null

$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
$VenvPip = Join-Path $Backend ".venv\Scripts\pip.exe"

if (-not (Test-Path $VenvPython)) {
  python -m venv (Join-Path $Backend ".venv")
}

& $VenvPython -m pip install --disable-pip-version-check --quiet -r (Join-Path $Backend "requirements.txt")

if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
  npm --prefix $Frontend ci --silent
}
npm --prefix $Frontend run build

$Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($HostName), $Port)
try {
  $Listener.Start()
} catch {
  throw "Port $Port is already in use. Set PORT to another local port."
} finally {
  $Listener.Stop()
}

if (-not $env:WCG_VAULT_ROOT) {
  $env:WCG_VAULT_ROOT = Join-Path $env:USERPROFILE "web-context-graph-data"
}
$env:WCG_FRONTEND_DIST = Join-Path $Frontend "dist"

Write-Host "Starting Lineage App at $Url"
Write-Host "Vault: $env:WCG_VAULT_ROOT"

$OpenBrowser = -not ($env:WCG_NO_OPEN -eq "1")
$ReadyUrl = "$Url/healthz"
$ReadyJob = Start-Job -ScriptBlock {
  param($ReadyUrl, $Url, $OpenBrowser)
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest -Uri $ReadyUrl -UseBasicParsing -TimeoutSec 1 | Out-Null
      if ($OpenBrowser) {
        Start-Process $Url
      }
      return
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  Write-Error "The local server did not become ready at $Url"
} -ArgumentList $ReadyUrl, $Url, $OpenBrowser

try {
  Set-Location $Backend
  & $VenvPython -m uvicorn main:app --host $HostName --port $Port
} finally {
  Remove-Job $ReadyJob -Force -ErrorAction SilentlyContinue
}
