# NoteBit installer for Windows (PowerShell)
#   irm https://notebit.org/install.ps1 | iex
#
# Checks Docker Desktop, fetches NoteBit, starts it with docker compose, and waits
# until it answers. Your data lives in the notebit-data Docker volume.
# Re-running is safe: an existing install is updated in place.
$ErrorActionPreference = "Stop"
$dir = if ($env:NOTEBIT_DIR) { $env:NOTEBIT_DIR } else { "notebit" }
$repo = "https://github.com/GroyalCodes/notebit"

Write-Host ""
Write-Host "  NoteBit installer" -ForegroundColor White
Write-Host "  Notes without the bloat. Or the bill." -ForegroundColor DarkGray
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "  Docker Desktop is required and was not found." -ForegroundColor Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $r = Read-Host "  Install Docker Desktop now with winget? (y/n)"
    if ($r -match '^[Yy]') {
      winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
      Write-Host ""
      Write-Host "  Docker Desktop installed." -ForegroundColor Green
      Write-Host "  Start it from the Start menu, wait for it to say 'running' (first start can take a few minutes and may ask to enable WSL 2), then re-run:"
      Write-Host ""
      Write-Host "    irm https://notebit.org/install.ps1 | iex" -ForegroundColor White
      Write-Host ""
      exit 0
    }
  }
  Write-Host "ERROR: Install Docker Desktop from https://docs.docker.com/desktop/ then re-run this installer." -ForegroundColor Red; exit 1
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Docker Compose v2 is required. Update Docker Desktop." -ForegroundColor Red; exit 1 }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Docker is installed but not running. Start Docker Desktop, wait for the whale to settle, and re-run." -ForegroundColor Red; exit 1 }
Write-Host "  [1/4] Docker found. Good whale."

if (Test-Path (Join-Path $dir ".git")) {
  Write-Host "  [2/4] Existing install found in .\$dir, pulling the latest..."
  git -C $dir pull --ff-only
} elseif (Test-Path $dir) {
  Write-Host "ERROR: .\$dir exists but is not a NoteBit checkout. Set NOTEBIT_DIR to another folder." -ForegroundColor Red; exit 1
} elseif (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Host "  [2/4] Fetching NoteBit... a few megabytes of honest code."
  git clone --depth 1 "$repo.git" $dir
} else {
  Write-Host "  [2/4] Fetching NoteBit (no git found, zip it is)..."
  $zip = Join-Path $env:TEMP "notebit.zip"
  Invoke-WebRequest -UseBasicParsing "$repo/archive/refs/heads/main.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath $env:TEMP -Force
  Move-Item (Join-Path $env:TEMP "notebit-main") $dir
  Remove-Item $zip
}

Set-Location $dir
Write-Host "  [3/4] Building your container. The first build is the slow one; every update after is quick. Stretch your legs."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: docker compose failed. Check the output above." -ForegroundColor Red; exit 1 }

Write-Host "  [4/4] Waiting for the first heartbeat..."
for ($i = 0; $i -lt 45; $i++) {
  try {
    $v = Invoke-RestMethod "http://localhost:8200/api/version" -TimeoutSec 2
    if ($v.version) {
      Write-Host ""
      Write-Host "  NoteBit v$($v.version) is alive: http://localhost:8200" -ForegroundColor Green
      Write-Host ""
      Write-Host "  First account created becomes the admin. Choose wisely."
      Write-Host ""
      Write-Host "  Update:  re-run this installer (your data always stays)"
      Write-Host "  Stop:    docker compose down   (inside the $dir folder)"
      Write-Host "  Data:    everything lives in the notebit-data volume."
      Write-Host "           Back that up and you can walk away from a burning server."
      Write-Host ""
      Write-Host "  Prefer managed hosting? https://notebit.org" -ForegroundColor DarkGray
      exit 0
    }
  } catch {}
  Start-Sleep 2
}
Write-Host "ERROR: NoteBit did not respond on http://localhost:8200 after 90s. Check logs with: docker compose logs" -ForegroundColor Red
exit 1
