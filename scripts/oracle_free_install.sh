#!/usr/bin/env bash
set -euo pipefail

# Oracle Always Free (Ubuntu) VM bootstrap for this Discord bot.
# Usage:
#   bash scripts/oracle_free_install.sh <GIT_REPO_URL> [APP_DIR]
#
# Example:
#   bash scripts/oracle_free_install.sh https://github.com/you/discord-work-bot.git /opt/discord-work-bot

if [[ "${1:-}" == "" ]]; then
  echo "Usage: bash scripts/oracle_free_install.sh <GIT_REPO_URL> [APP_DIR]"
  exit 1
fi

REPO_URL="$1"
APP_DIR="${2:-/opt/discord-work-bot}"
SERVICE_NAME="discord-work-bot"
BOT_DIR="$APP_DIR/discord-bot"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required."
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script is intended for Ubuntu/Debian (apt-get required)."
  exit 1
fi

echo "[1/7] Install base packages"
sudo apt-get update -y
sudo apt-get install -y curl git ca-certificates build-essential

echo "[2/7] Install Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v20\\."; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "[3/7] Clone or update repository"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  sudo mkdir -p "$(dirname "$APP_DIR")"
  sudo chown -R "$USER":"$USER" "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
fi

if [[ ! -d "$BOT_DIR" ]]; then
  echo "Cannot find $BOT_DIR. Ensure repo has discord-bot directory."
  exit 1
fi

echo "[4/7] Install dependencies"
cd "$BOT_DIR"
npm ci

echo "[5/7] Prepare .env if missing"
if [[ ! -f .env ]]; then
  cat > .env <<'EOF'
DISCORD_TOKEN=PUT_NEW_DISCORD_TOKEN_HERE
DASHBOARD_TOKEN=PUT_STRONG_DASHBOARD_TOKEN_HERE
DASHBOARD_PORT=8787
PREFIX=!
OWNER_USER_ID=
SLASH_GUILD_ID=
ENABLE_GUILD_MEMBERS_INTENT=false
ENABLE_MESSAGE_CONTENT_INTENT=false
GOOGLE_SHEET_ID=
GOOGLE_SHEET_RANGE=JobList!A:Z
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_SERVICE_ACCOUNT_FILE=
EOF
  chmod 600 .env
  echo ".env created at $BOT_DIR/.env (fill DISCORD_TOKEN and DASHBOARD_TOKEN first)"
fi

echo "[6/7] Create systemd service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Discord Work Ticket Bot
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$BOT_DIR
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

echo "[7/7] Enable service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo
echo "Done."
echo "Service status: sudo systemctl status $SERVICE_NAME --no-pager"
echo "Live logs:      sudo journalctl -u $SERVICE_NAME -f"
echo "Dashboard URL:  http://<VM_PUBLIC_IP>:8787"
