#!/usr/bin/env bash
# Update NoteBit to the latest version. Your data is safe: it lives in the
# Docker volume (notebit-data), separate from the app image, and schema
# migrations run automatically on startup.
set -e
cd "$(dirname "$0")"
echo "→ fetching the latest NoteBit…"
git pull --ff-only
echo "→ rebuilding and restarting…"
docker compose up -d --build
echo
echo "✅ NoteBit is up to date. Your pages, boards, and members are untouched."
