#!/usr/bin/env bash
# Registers the local router as a native messaging host for every
# Chromium browser found on this Mac (Dia, Chrome, Arc, Brave, Edge, ...).
set -euo pipefail

HOST_NAME="com.byo_sidebar.router"
EXTENSION_ID="fndhgaclkabpgpmigidbibafjaijeglj" # fixed by the "key" in extension/manifest.json
SRC="$(cd "$(dirname "$0")" && pwd)"

# Run the router from ~/Library, not from the clone: macOS blocks browsers from
# launching programs inside ~/Documents, ~/Desktop or ~/Downloads unless they've
# been granted access to those folders. Re-run this script after pulling updates.
DIR="$HOME/Library/Application Support/byo-sidebar/host"
LOG_DIR="$HOME/Library/Logs/byo-sidebar"
LAUNCHER="$DIR/byo-sidebar-host"
mkdir -p "$DIR" "$LOG_DIR"
rsync -a --delete --exclude byo-sidebar-host --exclude '*.sh' --exclude test-host.js "$SRC/" "$DIR/"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is required (https://nodejs.org)." >&2
  exit 1
fi
CLAUDE_BIN="$(command -v claude || true)"
CODEX_BIN="$(command -v codex || true)"
GEMINI_BIN="$(command -v gemini || true)"
# Optional, for video transcripts: yt-dlp (+ ffmpeg) and a local transcriber.
YTDLP_BIN="$(command -v yt-dlp || true)"
PARAKEET_BIN="$(command -v parakeet-mlx || true)"
WHISPER_BIN="$(command -v whisper-cli || true)"

# Browsers launch hosts with a bare environment, so bake absolute paths in.
EXTRA_PATH=""
for b in "$CLAUDE_BIN" "$CODEX_BIN" "$GEMINI_BIN" "$YTDLP_BIN" "$PARAKEET_BIN" "$WHISPER_BIN" "$(command -v ffmpeg || true)"; do
  [[ -n "$b" ]] && EXTRA_PATH="$EXTRA_PATH$(dirname "$b"):"
done
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
export PATH="$(dirname "$NODE_BIN"):$EXTRA_PATH/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
export BYO_CLAUDE_BIN="${CLAUDE_BIN:-claude}"
export BYO_CODEX_BIN="${CODEX_BIN:-codex}"
export BYO_GEMINI_BIN="${GEMINI_BIN:-gemini}"
export BYO_YTDLP_BIN="${YTDLP_BIN:-yt-dlp}"
export BYO_PARAKEET_BIN="${PARAKEET_BIN:-parakeet-mlx}"
export BYO_WHISPER_BIN="${WHISPER_BIN:-whisper-cli}"
${BYO_WHISPER_MODEL:+export BYO_WHISPER_MODEL="$BYO_WHISPER_MODEL"}
exec "$NODE_BIN" "$DIR/router.js" 2>>"$LOG_DIR/host.log"
EOF
chmod +x "$LAUNCHER"

SUPPORT="$HOME/Library/Application Support"
BROWSERS=(
  "Dia/User Data"
  "Google/Chrome"
  "Google/Chrome Beta"
  "Google/Chrome Canary"
  "Arc/User Data"
  "BraveSoftware/Brave-Browser"
  "Microsoft Edge"
  "Chromium"
)

installed=0
for b in "${BROWSERS[@]}"; do
  [[ -d "$SUPPORT/$b" ]] || continue
  mkdir -p "$SUPPORT/$b/NativeMessagingHosts"
  cat > "$SUPPORT/$b/NativeMessagingHosts/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "BYO Sidebar local model router",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "✓ $b"
  installed=$((installed + 1))
done

if [[ $installed -eq 0 ]]; then
  echo "No supported browser profile folders found." >&2
  exit 1
fi

echo
echo "Login providers found:"
echo "  Claude Code: ${CLAUDE_BIN:-not installed}"
echo "  Codex:       ${CODEX_BIN:-not installed (npm i -g @openai/codex, then: codex login)}"
echo "  Gemini CLI:  ${GEMINI_BIN:-not installed (npm i -g @google/gemini-cli, then run: gemini)}"
echo
echo "Video transcripts (optional):"
echo "  yt-dlp:      ${YTDLP_BIN:-not installed (brew install yt-dlp ffmpeg)}"
echo "  Parakeet:    ${PARAKEET_BIN:-not installed (uv tool install parakeet-mlx; English/European audio)}"
echo "  whisper.cpp: ${WHISPER_BIN:-not installed (brew install whisper.cpp; any language)}"
echo
echo "API keys can be added from the panel's ⓘ screen. Re-run this script after installing anything above."
echo "Router installed to: $DIR"
echo "Errors are logged to: $LOG_DIR/host.log"
echo "Done. Reload the extension and reopen the panel."
