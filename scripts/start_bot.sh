#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting bot"
  node index.js
  code=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] bot exited with code $code; restarting in 5s"
  sleep 5
done
