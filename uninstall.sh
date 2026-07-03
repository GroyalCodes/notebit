#!/usr/bin/env bash
# NoteBit uninstaller
#   curl -fsSL https://notebit.org/uninstall.sh | bash     (from where you installed)
#   or: ./uninstall.sh                                     (inside the notebit folder)
#
# Handles both native and Docker installs. Your notes are KEPT unless you say
# otherwise, so a reinstall brings everything back.
set -euo pipefail
say() { printf '%s\n' "$*"; }

# find the install
if [ -d app ] && [ -d data ]; then MODE=native
elif [ -f docker-compose.yml ] && grep -q notebit docker-compose.yml 2>/dev/null; then MODE=docker
elif [ -d "${NOTEBIT_DIR:-notebit}" ]; then
  cd "${NOTEBIT_DIR:-notebit}"
  if [ -d app ] && [ -d data ]; then MODE=native
  elif [ -f docker-compose.yml ]; then MODE=docker
  else say ""; say "ERROR: ${NOTEBIT_DIR:-notebit} does not look like a NoteBit install."; exit 1; fi
else say ""; say "ERROR: could not find a NoteBit install here. Run this from the folder you installed in."; exit 1
fi

say ""
say "  NoteBit uninstaller ($MODE install)"
say ""

wipe=n
if [ -r /dev/tty ]; then
  say "  Your notes live in $([ "$MODE" = native ] && echo "the data folder here" || echo "the notebit-data Docker volume")."
  say "  If you keep them, reinstalling later brings every page back exactly as it was."
  printf '  Delete your notes too? (y/N) '
  read -r wipe < /dev/tty 2>/dev/null || wipe=n
fi

if [ "$MODE" = native ]; then
  [ -f notebit.pid ] && kill "$(cat notebit.pid)" 2>/dev/null || true
  rm -rf app runtime notebit.pid notebit.log notebit.err.log start.sh stop.sh .app.new
  if [ "$wipe" = "y" ] || [ "$wipe" = "Y" ]; then
    rm -rf data
    say "  Everything is gone, notes included. It was nice hosting with you."
    say "  This folder is empty now; delete it whenever."
  else
    say "  Done. Your notes are safe in $(pwd)/data."
    say "  Reinstall any time and they will be right where you left them:"
    say ""
    say "    curl -fsSL https://notebit.org/install.sh | bash"
  fi
else
  if [ "$wipe" = "y" ] || [ "$wipe" = "Y" ]; then
    docker compose down -v --rmi local --remove-orphans
    say "  Everything is gone, notes included. It was nice hosting with you."
  else
    docker compose down --rmi local --remove-orphans
    say "  Done. Your notes are safe in the notebit-data volume."
  fi
  say "  This folder is just source code now; delete it whenever."
fi
say ""
