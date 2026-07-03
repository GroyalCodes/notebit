# NoteBit uninstaller for Windows (PowerShell)
#   irm https://notebit.org/uninstall.ps1 | iex     (from where you installed)
#
# Handles both native and Docker installs. Your notes are KEPT unless you say
# otherwise, so a reinstall brings everything back.
$ErrorActionPreference = "Continue"

$dir = if ($env:NOTEBIT_DIR) { $env:NOTEBIT_DIR } else { "notebit" }
$mode = $null
if ((Test-Path "app") -and (Test-Path "data")) { $mode = "native" }
elseif (Test-Path "docker-compose.yml") { $mode = "docker" }
elseif (Test-Path $dir) {
  Set-Location $dir
  if ((Test-Path "app") -and (Test-Path "data")) { $mode = "native" }
  elseif (Test-Path "docker-compose.yml") { $mode = "docker" }
}
if (-not $mode) { Write-Host ""; Write-Host "ERROR: could not find a NoteBit install here. Run this from the folder you installed in." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  NoteBit uninstaller ($mode install)" -ForegroundColor White
Write-Host ""
Write-Host "  Your notes live in $(if ($mode -eq 'native') { 'the data folder here' } else { 'the notebit-data Docker volume' })."
Write-Host "  If you keep them, reinstalling later brings every page back exactly as it was."
$wipe = Read-Host "  Delete your notes too? (y/N)"

if ($mode -eq "native") {
  if (Test-Path "notebit.pid") {
    $p = Get-Content "notebit.pid" -ErrorAction SilentlyContinue
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item app, runtime, notebit.pid, notebit.log, notebit.err.log, "Start NoteBit.bat", "Stop NoteBit.bat" -Recurse -Force -ErrorAction SilentlyContinue
  if ($wipe -match '^[Yy]') {
    Remove-Item data -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Everything is gone, notes included. It was nice hosting with you."
    Write-Host "  This folder is empty now; delete it whenever."
  } else {
    Write-Host "  Done. Your notes are safe in $(Get-Location)\data." -ForegroundColor Green
    Write-Host "  Reinstall any time and they will be right where you left them:"
    Write-Host ""
    Write-Host "    irm https://notebit.org/install.ps1 | iex" -ForegroundColor White
  }
} else {
  if ($wipe -match '^[Yy]') {
    docker compose down -v --rmi local --remove-orphans
    Write-Host "  Everything is gone, notes included. It was nice hosting with you."
  } else {
    docker compose down --rmi local --remove-orphans
    Write-Host "  Done. Your notes are safe in the notebit-data volume." -ForegroundColor Green
  }
  Write-Host "  This folder is just source code now; delete it whenever."
}
Write-Host ""
