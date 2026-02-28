#!/usr/bin/env bash
set -euo pipefail

# Open ports for Oracle VM Ubuntu instance.
# Usage:
#   bash scripts/oracle_free_open_ports.sh
#
# This configures OS firewall (ufw). You also need Oracle VCN Security List
# inbound rules for 22/tcp and 8787/tcp.

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required."
  exit 1
fi

sudo apt-get update -y
sudo apt-get install -y ufw

sudo ufw allow 22/tcp
sudo ufw allow 8787/tcp
sudo ufw --force enable
sudo ufw status verbose

echo
echo "OS firewall configured."
echo "Also set Oracle VCN ingress rule for 8787/tcp from your allowed source."
