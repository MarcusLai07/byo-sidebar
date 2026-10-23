#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.byo_sidebar.router"

find "$HOME/Library/Application Support" -maxdepth 4 -path "*NativeMessagingHosts/$HOST_NAME.json" -print -delete
rm -rf "$HOME/Library/Application Support/byo-sidebar"
echo "Removed. Your API keys in ~/.config/byo-sidebar were kept; delete that folder too to remove them."
