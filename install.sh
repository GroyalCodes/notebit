#!/usr/bin/env bash
# NoteBit installer
#   curl -fsSL https://notebit.org/install.sh | bash
#
# No Docker needed: this sets up NoteBit natively with its own private Node runtime.
# Everything lives in one folder; your notes are in ./notebit/data.
# Re-running is safe: it updates the app and keeps your data.
#
# Prefer Docker? NOTEBIT_DOCKER=1 curl -fsSL https://notebit.org/install.sh | bash
set -euo pipefail

DIR="${NOTEBIT_DIR:-notebit}"
PORT="${NOTEBIT_PORT:-8200}"
REPO="https://github.com/GroyalCodes/notebit"
NODE_V="v22.14.0"
BOLD=$(tput bold 2>/dev/null || true); DIM=$(tput dim 2>/dev/null || true); RESET=$(tput sgr0 2>/dev/null || true)

say()  { printf '%s\n' "$*"; }
fail() { printf '\n%s\n' "ERROR: $*" >&2; exit 1; }

say ""
say "${BOLD}  NoteBit installer${RESET}"
say "${DIM}  Notes without the bloat. Or the bill.${RESET}"
say ""

# ---------- optional Docker path ----------
if [ "${NOTEBIT_DOCKER:-}" = "1" ]; then
  command -v docker >/dev/null 2>&1 || fail "Docker not found. Install it from https://docs.docker.com/get-docker/ or run without NOTEBIT_DOCKER=1 for the native install."
  docker info >/dev/null 2>&1 || fail "Docker is not running."
  say "  [1/3] Docker found. Good whale."
  if [ -d "$DIR/.git" ]; then say "  [2/3] Updating existing checkout..."; git -C "$DIR" pull --ff-only || true
  else say "  [2/3] Fetching NoteBit..."; git clone --depth 1 "$REPO.git" "$DIR"; fi
  say "  [3/3] Building and starting the container..."
  (cd "$DIR" && docker compose up -d --build)
  say ""
  say "${BOLD}  NoteBit (Docker) is starting on http://localhost:8200${RESET}"
  exit 0
fi

# ---------- native install (default) ----------
mkdir -p "$DIR"; cd "$DIR"

# [1/4] a Node to call our own
NODE=""; NPM=""
if command -v node >/dev/null 2>&1; then
  MAJ=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$MAJ" -ge 20 ]; then NODE=$(command -v node); NPM=$(command -v npm); say "  [1/4] Found Node $(node -v) on your system. It will do nicely."; fi
fi
if [ -z "$NODE" ]; then
  if [ -x runtime/bin/node ]; then
    say "  [1/4] Using the private Node runtime from last time."
  else
    OS=$(uname -s); ARCH=$(uname -m)
    case "$OS" in Linux) P=linux ;; Darwin) P=darwin ;; *) fail "Unsupported OS: $OS" ;; esac
    case "$ARCH" in x86_64|amd64) A=x64 ;; aarch64|arm64) A=arm64 ;; *) fail "Unsupported CPU: $ARCH" ;; esac
    say "  [1/4] No Node found. Fetching a private runtime (it stays in this folder, touches nothing else)..."
    curl -fsSL "https://nodejs.org/dist/$NODE_V/node-$NODE_V-$P-$A.tar.gz" | tar xz
    rm -rf runtime && mv "node-$NODE_V-$P-$A" runtime
  fi
  NODE="$PWD/runtime/bin/node"; NPM="$PWD/runtime/bin/npm"
  export PATH="$PWD/runtime/bin:$PATH"
fi

# stop anything already running from this folder before replacing files
[ -f notebit.pid ] && kill "$(cat notebit.pid)" 2>/dev/null || true
pkill -f "$PWD/app/server/server.js" 2>/dev/null || true
rm -f notebit.pid

# [2/4] the app itself, prebuilt
say "  [2/4] Fetching NoteBit... a few megabytes of honest code."
rm -rf .app.new && mkdir .app.new
curl -fsSL "$REPO/releases/latest/download/notebit-app.tar.gz" | tar xz -C .app.new
rm -rf app && mv .app.new/notebit-app app && rm -rf .app.new

# [3/4] server dependencies (prebuilt binaries, no compiler needed)
say "  [3/4] Installing server dependencies. The database engine arrives precompiled."
(cd app/server && "$NPM" ci --omit=dev --no-audit --no-fund --loglevel=error)

# [4/4] run it
mkdir -p data
say "  [4/4] First heartbeat coming up..."
WIKI_DB="$PWD/data/notebit.db" PORT="$PORT" HOST=127.0.0.1 APP_URL="http://localhost:$PORT" \
  nohup "$NODE" app/server/server.js >> notebit.log 2>&1 &
echo $! > notebit.pid

# helper scripts
cat > start.sh << EOS
#!/usr/bin/env bash
cd "\$(dirname "\$0")"
[ -x runtime/bin/node ] && export PATH="\$PWD/runtime/bin:\$PATH"
if [ -f notebit.pid ] && kill -0 "\$(cat notebit.pid)" 2>/dev/null; then echo "NoteBit is already running: http://localhost:$PORT"; exit 0; fi
WIKI_DB="\$PWD/data/notebit.db" PORT=$PORT HOST=127.0.0.1 APP_URL="http://localhost:$PORT" nohup node app/server/server.js >> notebit.log 2>&1 &
echo \$! > notebit.pid
echo "NoteBit is running: http://localhost:$PORT"
EOS
cat > stop.sh << 'EOS'
#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f notebit.pid ] && kill "$(cat notebit.pid)" 2>/dev/null && rm -f notebit.pid && echo "NoteBit stopped." || echo "NoteBit was not running."
EOS
cat > restart.sh << 'EOS'
#!/usr/bin/env bash
cd "$(dirname "$0")"
./stop.sh; sleep 1; ./start.sh
EOS
chmod +x start.sh stop.sh restart.sh

# start on boot by default (best effort; systemd user service on Linux, launchd on macOS)
WIKI_DB="$PWD/data/notebit.db" PORT="$PORT" HOST=127.0.0.1 APP_URL="http://localhost:$PORT" "$NODE" app/server/server.js autostart enable >/dev/null 2>&1 || true

for i in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$PORT/api/version" >/dev/null 2>&1; then
    VERSION=$(curl -fsS "http://127.0.0.1:$PORT/api/version" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
    say ""
    say "${DIM}  ================================================${RESET}"
    say ""
    say "${BOLD}   Install complete. NoteBit v${VERSION} is running.${RESET}"
    say ""
    say "   Open here:      http://localhost:$PORT"
    say "   Your notes:     $DIR/data  (back it up, own it forever)"
    say "   Daily driving:  ./start.sh  ./stop.sh  ./restart.sh  in the $DIR folder"
    say "   Updating:       re-run this installer, data always stays"
    say "   On boot:        starts automatically (toggle in Settings, Workspace)"
    say ""
    say "   First account created becomes the admin. Choose wisely."
    say ""
    say "${DIM}  ================================================${RESET}"
    say "${DIM}  Enjoying it? https://ko-fi.com/V7V81I89ME keeps the dev caffeinated.${RESET}"
    say ""
    exit 0
  fi
  sleep 1
done
say ""
say "ERROR: NoteBit did not respond on http://localhost:$PORT after 30s."
say ""
say "  Last lines of the log:"
tail -15 notebit.log 2>/dev/null | sed "s/^/    /"
if tail -15 notebit.log 2>/dev/null | grep -q EADDRINUSE; then
  say ""
  say "  Port $PORT is taken by another program. Re-run on a different port:"
  say "    NOTEBIT_PORT=8300 bash -c \"\$(curl -fsSL https://notebit.org/install.sh)\""
fi
exit 1
