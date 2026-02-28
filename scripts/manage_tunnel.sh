#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT_DIR/bin/cloudflared"
PID_FILE="$ROOT_DIR/.cloudflared.pid"
LOG_FILE="$ROOT_DIR/.cloudflared.log"
TARGET_URL="${TUNNEL_TARGET_URL:-http://localhost:8787}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") start|status|stop|url
  start  : Start Cloudflare quick tunnel to ${TARGET_URL}
  status : Show process and tunnel URL if available
  stop   : Stop running tunnel
  url    : Print tunnel URL from log
USAGE
}

ensure_bin() {
  if [[ ! -x "$BIN" ]]; then
    echo "cloudflared binary not found: $BIN" >&2
    echo "Install step: curl -fL -o bin/cloudflared.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz && tar -xzf bin/cloudflared.tgz -C bin && chmod +x bin/cloudflared" >&2
    exit 1
  fi
}

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

print_url() {
  if [[ -f "$LOG_FILE" ]]; then
    grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$LOG_FILE" | tail -n 1 || true
  fi
}

start() {
  ensure_bin
  if is_running; then
    echo "Tunnel already running (pid=$(cat "$PID_FILE"))"
    local existing
    existing="$(print_url)"
    [[ -n "$existing" ]] && echo "URL: $existing"
    exit 0
  fi

  : > "$LOG_FILE"
  nohup "$BIN" tunnel --no-autoupdate --url "$TARGET_URL" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  for _ in $(seq 1 40); do
    sleep 0.5
    local url
    url="$(print_url)"
    if [[ -n "$url" ]]; then
      echo "Tunnel started"
      echo "URL: $url"
      return 0
    fi
  done

  echo "Tunnel started but URL not detected yet. Check log: $LOG_FILE"
}

status() {
  if is_running; then
    echo "running (pid=$(cat "$PID_FILE"))"
  else
    echo "stopped"
  fi
  local url
  url="$(print_url)"
  [[ -n "$url" ]] && echo "URL: $url"
}

stop() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid" || true
    rm -f "$PID_FILE"
    echo "stopped"
  else
    echo "already stopped"
  fi
}

case "${1:-}" in
  start) start ;;
  status) status ;;
  stop) stop ;;
  url) print_url ;;
  *) usage; exit 1 ;;
esac
