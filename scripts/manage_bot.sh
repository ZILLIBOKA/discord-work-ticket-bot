#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT_DIR/.bot.pid"
LOG_FILE="$ROOT_DIR/bot.log"

use_node() {
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.nvm/nvm.sh"
    if [[ -f "$ROOT_DIR/.nvmrc" ]]; then
      nvm use >/dev/null 2>&1 || true
    fi
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

start() {
  if is_running; then
    echo "bot already running (pid=$(cat "$PID_FILE"))"
    return 0
  fi

  # Clean stale node index.js in this project
  pgrep -f "$ROOT_DIR/index.js" >/dev/null 2>&1 && pkill -f "$ROOT_DIR/index.js" || true

  cd "$ROOT_DIR"
  use_node
  nohup node index.js >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1

  if is_running; then
    echo "bot started (pid=$(cat "$PID_FILE"))"
    echo "log: $LOG_FILE"
  else
    echo "failed to start bot; check log: $LOG_FILE" >&2
    return 1
  fi
}

stop() {
  if ! is_running; then
    echo "bot already stopped"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  sleep 1
  kill -9 "$pid" 2>/dev/null || true
  unlink "$PID_FILE" 2>/dev/null || true
  echo "bot stopped"
  return 0
}

status() {
  if is_running; then
    echo "running (pid=$(cat "$PID_FILE"))"
  else
    echo "stopped"
  fi
}

logs() {
  tail -n 80 "$LOG_FILE" 2>/dev/null || true
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart)
    stop || true
    start
    ;;
  status) status ;;
  logs) logs ;;
  *)
    echo "Usage: $(basename "$0") {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
