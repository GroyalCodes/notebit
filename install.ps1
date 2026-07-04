# NoteBit installer for Windows (PowerShell)
#   irm https://notebit.org/install.ps1 | iex
#
# No Docker needed: this sets up NoteBit natively with its own private Node runtime.
# Everything lives in one folder; your notes are in .\notebit\data.
# Re-running is safe: it updates the app and keeps your data.
#
# Prefer Docker? Set $env:NOTEBIT_DOCKER = "1" first.
$ErrorActionPreference = "Continue"  # PS 5.1 turns native stderr into fatal errors under Stop

$dir = if ($env:NOTEBIT_DIR) { $env:NOTEBIT_DIR } else { "notebit" }
$port = if ($env:NOTEBIT_PORT) { $env:NOTEBIT_PORT } else { "8200" }
$repo = "https://github.com/GroyalCodes/notebit"
$nodeV = "v22.14.0"

Write-Host ""
Write-Host "  NoteBit installer" -ForegroundColor White
Write-Host "  Notes without the bloat. Or the bill." -ForegroundColor DarkGray
Write-Host ""

# ---------- optional Docker path ----------
if ($env:NOTEBIT_DOCKER -eq "1") {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Host "ERROR: Docker not found. Install Docker Desktop or run without NOTEBIT_DOCKER for the native install." -ForegroundColor Red; exit 1 }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Docker is not running. Start Docker Desktop first." -ForegroundColor Red; exit 1 }
  Write-Host "  [1/3] Docker found. Good whale."
  if (Test-Path (Join-Path $dir ".git")) { Write-Host "  [2/3] Updating existing checkout..."; git -C $dir pull --ff-only }
  else { Write-Host "  [2/3] Fetching NoteBit..."; git clone --depth 1 "$repo.git" $dir }
  Write-Host "  [3/3] Building and starting the container..."
  Push-Location $dir; docker compose up -d --build; Pop-Location
  Write-Host ""
  Write-Host "  NoteBit (Docker) is starting on http://localhost:8200" -ForegroundColor Green
  exit 0
}

# ---------- native install (default) ----------
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location $dir

# [1/4] a Node to call our own
$node = $null; $npm = $null
$sysNode = Get-Command node -ErrorAction SilentlyContinue
if ($sysNode) {
  $maj = [int]((node -p "process.versions.node.split('.')[0]") 2>$null)
  if ($maj -ge 20) { $node = "node"; $npm = "npm"; Write-Host "  [1/4] Found Node $(node -v) on your system. It will do nicely." }
}
if (-not $node) {
  if (Test-Path "runtime\node.exe") {
    Write-Host "  [1/4] Using the private Node runtime from last time."
  } else {
    Write-Host "  [1/4] No Node found. Fetching a private runtime (it stays in this folder, touches nothing else)..."
    $zip = "node-portable.zip"
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$nodeV/node-$nodeV-win-x64.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath . -Force
    if (Test-Path runtime) { Remove-Item runtime -Recurse -Force }
    Rename-Item "node-$nodeV-win-x64" runtime
    Remove-Item $zip
  }
  $env:Path = "$PWD\runtime;$env:Path"
  $node = "$PWD\runtime\node.exe"; $npm = "$PWD\runtime\npm.cmd"
}

# stop anything already running from this folder BEFORE replacing files
# (Windows cannot delete a .node binary that a live process has loaded)
function Stop-NoteBit {
  if (Test-Path "notebit.pid") {
    $p = Get-Content "notebit.pid" -ErrorAction SilentlyContinue
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    Remove-Item "notebit.pid" -ErrorAction SilentlyContinue
  }
  $here = [regex]::Escape("$PWD")
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $here } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Stop-NoteBit
Start-Sleep 1

# [2/4] the app itself, prebuilt
Write-Host "  [2/4] Fetching NoteBit... a few megabytes of honest code."
Invoke-WebRequest -UseBasicParsing "$repo/releases/latest/download/notebit-app.zip" -OutFile "app.zip"
if (Test-Path ".app.new") { Remove-Item ".app.new" -Recurse -Force }
Expand-Archive "app.zip" -DestinationPath ".app.new" -Force
if (Test-Path "app") {
  $gone = $false
  for ($i = 0; $i -lt 6; $i++) {
    Remove-Item "app" -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path "app")) { $gone = $true; break }
    Stop-NoteBit; Start-Sleep 2
  }
  if (-not $gone) { Write-Host "ERROR: could not replace the app folder; something still has it open. Close programs using $PWD (or reboot) and re-run." -ForegroundColor Red; exit 1 }
}
Move-Item ".app.new\notebit-app" "app"
Remove-Item ".app.new" -Recurse -Force
Remove-Item "app.zip"

# [3/4] server dependencies (prebuilt binaries, no compiler needed)
Write-Host "  [3/4] Installing server dependencies. The database engine arrives precompiled."
Push-Location "app\server"
& $npm ci --omit=dev --no-audit --no-fund --loglevel=error
$npmOk = $LASTEXITCODE
Pop-Location
if ($npmOk -ne 0) { Write-Host "ERROR: dependency install failed. Check your connection and re-run." -ForegroundColor Red; exit 1 }

# [4/4] run it
New-Item -ItemType Directory -Force -Path "data" | Out-Null
Write-Host "  [4/4] First heartbeat coming up..."

$env:WIKI_DB = "$PWD\data\notebit.db"; $env:PORT = $port; $env:HOST = "127.0.0.1"; $env:APP_URL = "http://localhost:$port"
$proc = Start-Process -FilePath $node -ArgumentList "app\server\server.js" -WorkingDirectory $PWD -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "notebit.log" -RedirectStandardError "notebit.err.log"
$proc.Id | Out-File "notebit.pid" -Encoding ascii

# helper scripts
@"
@echo off
cd /d "%~dp0"
set PATH=%~dp0runtime;%PATH%
set WIKI_DB=%~dp0data\notebit.db
set PORT=$port
set HOST=127.0.0.1
set APP_URL=http://localhost:$port
start "" /b node app\server\server.js >> notebit.log 2>&1
echo NoteBit is running: http://localhost:$port
"@ | Out-File "Start NoteBit.bat" -Encoding ascii
@"
@echo off
taskkill /f /im node.exe /fi "WINDOWTITLE eq NoteBit*" >nul 2>&1
for /f %%p in (%~dp0notebit.pid) do taskkill /f /pid %%p >nul 2>&1
del "%~dp0notebit.pid" >nul 2>&1
echo NoteBit stopped.
"@ | Out-File "Stop NoteBit.bat" -Encoding ascii
@"
@echo off
call "%~dp0Stop NoteBit.bat"
timeout /t 2 /nobreak >nul
call "%~dp0Start NoteBit.bat"
"@ | Out-File "Restart NoteBit.bat" -Encoding ascii

$up = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep 1
  try {
    $v = Invoke-RestMethod "http://localhost:$port/api/version" -TimeoutSec 2
    if ($v.version) {
      Write-Host ""
      Write-Host "  NoteBit v$($v.version) is alive: http://localhost:$port" -ForegroundColor Green
      Write-Host ""
      Write-Host "  First account created becomes the admin. Choose wisely."
      Write-Host ""
      Write-Host "  Start:   'Start NoteBit.bat'      Stop: 'Stop NoteBit.bat'   (in the $dir folder)"
      Write-Host "  Update:  re-run this installer (your data always stays)"
      Write-Host "  Data:    everything lives in $dir\data."
      Write-Host "           Back that folder up and you can walk away from a burning laptop."
      Write-Host ""
      Write-Host "  Prefer managed hosting? https://notebit.org" -ForegroundColor DarkGray
      Write-Host ""
      Start-Process "http://localhost:$port"
      $up = $true; break
    }
  } catch {}
}
if (-not $up) {
  Write-Host ""
  Write-Host "ERROR: NoteBit did not respond on http://localhost:$port after 30s." -ForegroundColor Red
  $err = Get-Content "notebit.err.log" -Tail 15 -ErrorAction SilentlyContinue
  if ($err) { Write-Host ""; Write-Host "  Last lines of notebit.err.log:" -ForegroundColor Yellow; $err | ForEach-Object { Write-Host "    $_" } }
  if ($err -and ($err -join " ") -match "EADDRINUSE") {
    Write-Host ""
    Write-Host "  Port $port is taken by another program. Re-run on a different port:" -ForegroundColor Yellow
    Write-Host "    `$env:NOTEBIT_PORT=8300; irm https://notebit.org/install.ps1 | iex" -ForegroundColor White
  }
  exit 1
}
