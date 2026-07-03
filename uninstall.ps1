# NoteBit uninstaller for Windows (PowerShell)
#   irm https://notebit.org/uninstall.ps1 | iex     (from where you installed)
#
# Removes the container and image. Your notes (the notebit-data volume) are KEPT
# unless you say otherwise, so a reinstall brings everything back.
$ErrorActionPreference = "Stop"

# find the install: current dir, or .\notebit, or NOTEBIT_DIR
$dir = if ($env:NOTEBIT_DIR) { $env:NOTEBIT_DIR } else { "notebit" }
if ((Test-Path "docker-compose.yml") -and (Select-String -Path "docker-compose.yml" -Pattern "notebit" -Quiet)) { }
elseif (Test-Path (Join-Path $dir "docker-compose.yml")) { Set-Location $dir }
else { Write-Host ""; Write-Host "ERROR: could not find a NoteBit install here. Run this from the folder you installed in (the one containing docker-compose.yml)." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  NoteBit uninstaller" -ForegroundColor White
Write-Host ""
Write-Host "  Your notes live in the notebit-data volume. If you keep it, reinstalling"
Write-Host "  later brings every page back exactly as it was."
$wipe = Read-Host "  Delete your notes too? (y/N)"

if ($wipe -match '^[Yy]') {
  Write-Host "  Removing container, image, and data..."
  docker compose down -v --rmi local --remove-orphans
  Write-Host ""
  Write-Host "  Everything is gone, notes included. It was nice hosting with you."
} else {
  Write-Host "  Removing container and image, keeping your data..."
  docker compose down --rmi local --remove-orphans
  Write-Host ""
  Write-Host "  Done. Your notes are safe in the notebit-data volume." -ForegroundColor Green
  Write-Host "  Reinstall any time and they will be right where you left them:"
  Write-Host ""
  Write-Host "    irm https://notebit.org/install.ps1 | iex" -ForegroundColor White
}
Write-Host ""
Write-Host "  This folder ($(Get-Location)) is just source code now; delete it whenever."
Write-Host ""
