#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.lumen.router"

find "$HOME/Library/Application Support" -maxdepth 4 -path "*NativeMessagingHosts/$HOST_NAME.json" -print -delete
rm -rf "$HOME/Library/Application Support/lumen"
echo "Removed. Your API keys in ~/.config/lumen were kept; delete that folder too to remove them."
