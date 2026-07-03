#!/usr/bin/env bash
# NoteBit uninstaller
#   curl -fsSL https://notebit.org/uninstall.sh | bash     (from where you installed)
#   or: ./uninstall.sh                                     (inside the notebit folder)
#
# Removes the container and image. Your notes (the notebit-data volume) are KEPT
# unless you say otherwise, so a reinstall brings everything back.
set -euo pipefail
say() { printf '%s\n' "$*"; }

# find the install: current dir, or ./notebit, or NOTEBIT_DIR
if [ -f docker-compose.yml ] && grep -q notebit docker-compose.yml 2>/dev/null; then :
elif [ -d "${NOTEBIT_DIR:-notebit}" ] && [ -f "${NOTEBIT_DIR:-notebit}/docker-compose.yml" ]; then cd "${NOTEBIT_DIR:-notebit}"
else say ""; say "ERROR: could not find a NoteBit install here. Run this from the folder you installed in (the one containing docker-compose.yml)."; exit 1
fi

say ""
say "  NoteBit uninstaller"
say ""

wipe=n
if [ -r /dev/tty ]; then
  say "  Your notes live in the notebit-data volume. If you keep it, reinstalling"
  say "  later brings every page back exactly as it was."
  printf '  Delete your notes too? (y/N) '
  read -r wipe < /dev/tty 2>/dev/null || wipe=n
fi

if [ "$wipe" = "y" ] || [ "$wipe" = "Y" ]; then
  say "  Removing container, image, and data..."
  docker compose down -v --rmi local --remove-orphans
  say ""
  say "  Everything is gone, notes included. It was nice hosting with you."
else
  say "  Removing container and image, keeping your data..."
  docker compose down --rmi local --remove-orphans
  say ""
  say "  Done. Your notes are safe in the notebit-data volume."
  say "  Reinstall any time and they will be right where you left them:"
  say ""
  say "    curl -fsSL https://notebit.org/install.sh | bash"
fi
say ""
say "  This folder ($(pwd)) is just source code now; delete it whenever."
say ""
