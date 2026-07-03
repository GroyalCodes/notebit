#!/usr/bin/env bash
# NoteBit installer
#   curl -fsSL https://notebit.org/install.sh | bash
#
# What it does: checks Docker, fetches NoteBit, starts it with docker compose,
# and waits until it answers. Your data lives in the notebit-data Docker volume.
# Re-running is safe: an existing install is updated in place.
set -euo pipefail

DIR="${NOTEBIT_DIR:-notebit}"
REPO="https://github.com/GroyalCodes/notebit"
BOLD=$(tput bold 2>/dev/null || true); DIM=$(tput dim 2>/dev/null || true); RESET=$(tput sgr0 2>/dev/null || true)

say()  { printf '%s\n' "$*"; }
fail() { printf '\n%s\n' "ERROR: $*" >&2; exit 1; }

say ""
say "${BOLD}  NoteBit installer${RESET}"
say "${DIM}  Notes without the bloat. Or the bill.${RESET}"
say ""

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Linux" ] && [ -r /dev/tty ]; then
    say "  Docker is required and was not found."
    printf '  Install it now with the official Docker script? (y/n) '
    read -r ans < /dev/tty || ans=n
    case "$ans" in
      y|Y)
        curl -fsSL https://get.docker.com | sh
        say "  Docker installed. If you were added to the docker group, log out and back in, then re-run this installer."
        command -v docker >/dev/null 2>&1 || exit 0
        ;;
      *) fail "Install Docker from https://docs.docker.com/get-docker/ and re-run." ;;
    esac
  else
    fail "Docker is required. Install Docker Desktop from https://docs.docker.com/get-docker/ and re-run this script."
  fi
fi
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (the 'docker compose' command). Update Docker Desktop or install the compose plugin: https://docs.docker.com/compose/install/"
docker info >/dev/null 2>&1 || fail "Docker is installed but not running (or you lack permission). Start Docker, or add your user to the docker group."

# 2. Fetch or update the source
if [ -d "$DIR/.git" ]; then
  say "  Existing install found in ./$DIR, updating..."
  git -C "$DIR" pull --ff-only || say "  (could not fast-forward, continuing with current version)"
elif [ -d "$DIR" ]; then
  fail "./$DIR exists but is not a NoteBit checkout. Set NOTEBIT_DIR to another folder and re-run."
elif command -v git >/dev/null 2>&1; then
  say "  Fetching NoteBit..."
  git clone --depth 1 "$REPO.git" "$DIR"
else
  say "  Fetching NoteBit (no git found, using tarball)..."
  mkdir -p "$DIR"
  curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" | tar xz --strip-components=1 -C "$DIR"
fi

# 3. Build and start
say "  Building and starting (first build takes a few minutes)..."
cd "$DIR"
docker compose up -d --build

# 4. Wait until it answers
say "  Waiting for NoteBit to come up..."
for i in $(seq 1 45); do
  if curl -fsS http://localhost:8200/api/version >/dev/null 2>&1; then
    VERSION=$(curl -fsS http://localhost:8200/api/version | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
    say ""
    say "${BOLD}  NoteBit v${VERSION} is running.${RESET}"
    say ""
    say "  Open:      http://localhost:8200"
    say "  First account created becomes the admin."
    say ""
    say "  Update:    cd $DIR && ./update.sh   (your data is kept)"
    say "  Stop:      cd $DIR && docker compose down"
    say "  Data:      Docker volume 'notebit-data' (back it up to back up everything)"
    say ""
    say "${DIM}  Prefer managed hosting? https://notebit.org${RESET}"
    say ""
    exit 0
  fi
  sleep 2
done
fail "NoteBit did not respond on http://localhost:8200 after 90s. Check logs with: cd $DIR && docker compose logs"
