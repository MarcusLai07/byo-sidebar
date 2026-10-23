#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.byo_sidebar.router"
DIR="$(cd "$(dirname "$0")" && pwd)"

find "$HOME/Library/Application Support" -maxdepth 4 -path "*NativeMessagingHosts/$HOST_NAME.json" -print -delete
rm -f "$DIR/byo-sidebar-host"
echo "Removed."
