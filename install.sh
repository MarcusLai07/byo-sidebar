#!/usr/bin/env bash
# Lumen installer for macOS. One command installs, the same command updates:
#
#   curl -fsSL https://raw.githubusercontent.com/MarcusLai07/lumen/main/install.sh | bash
#
# Options (after `bash -s --` when piped):
#   --uninstall      remove Lumen's router and files (your browser keeps the extension until you remove it)
#   --with-video     also install yt-dlp + ffmpeg for video timestamps/transcripts, without asking
#   --no-video       skip the video tools question
#   --dir PATH       where to put Lumen (default ~/Lumen, or LUMEN_DIR)
set -euo pipefail

REPO="MarcusLai07/lumen"
DEST="${LUMEN_DIR:-$HOME/Lumen}"
VIDEO="ask"
UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    --with-video) VIDEO="yes" ;;
    --no-video) VIDEO="no" ;;
    --dir) DEST="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

bold=$'\033[1m'; dim=$'\033[2m'; accent=$'\033[38;5;173m'; ok=$'\033[32m'; reset=$'\033[0m'
say() { printf '%s\n' "$*"; }
step() { printf '\n%s›%s %s\n' "$accent" "$reset" "$*"; }
done_() { printf '  %s✓%s %s\n' "$ok" "$reset" "$*"; }

# Questions read from the terminal even when this script arrives through `curl | bash`.
ask() {
  local prompt="$1" default="$2" answer=""
  if [[ -r /dev/tty ]]; then
    printf '  %s %s ' "$prompt" "$([[ $default == y ]] && echo "[Y/n]" || echo "[y/N]")" > /dev/tty
    read -r answer < /dev/tty || true
  fi
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

[[ "$(uname -s)" == "Darwin" ]] || { echo "Lumen's installer supports macOS for now." >&2; exit 1; }

say ""
say "${bold}${accent}✦ Lumen${reset}${bold}: your own AI in the browser sidebar${reset}"

# ---------- uninstall ----------
if [[ $UNINSTALL == 1 ]]; then
  step "Removing Lumen"
  if [[ -x "$DEST/host/uninstall.sh" ]]; then "$DEST/host/uninstall.sh" | sed 's/^/  /'; fi
  if [[ -d "$DEST" ]] && ask "Delete $DEST too?" n; then rm -rf "$DEST"; done_ "Deleted $DEST"; fi
  say ""
  say "  Last step: remove Lumen from your browser's extensions page."
  exit 0
fi

# ---------- Node.js (runs the local router) ----------
step "Checking Node.js"
if ! command -v node >/dev/null; then
  if command -v brew >/dev/null && ask "Node.js is needed. Install it with Homebrew?" y; then
    brew install node
  else
    say "  Lumen needs Node.js 18 or newer: https://nodejs.org (or: brew install node). Then run this again."
    exit 1
  fi
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 18 )) || { say "  Node.js $NODE_MAJOR is too old; Lumen needs 18 or newer."; exit 1; }
done_ "Node.js $(node -v)"

# ---------- get or update the code ----------
# Piped through `curl | bash` there's no script file; run from a clone there is.
SELF_DIR=""
if [[ -f "${BASH_SOURCE[0]:-}" ]]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
if [[ -n "$SELF_DIR" && -f "$SELF_DIR/extension/manifest.json" && -z "${LUMEN_DIR:-}" ]]; then
  # Run from a clone: use it where it is.
  DEST="$SELF_DIR"
  step "Using this folder: $DEST"
elif [[ -d "$DEST/.git" ]]; then
  step "Updating $DEST"
  git -C "$DEST" pull --ff-only --quiet
  done_ "Up to date ($(git -C "$DEST" log -1 --format=%h))"
elif command -v git >/dev/null && [[ ! -e "$DEST" ]]; then
  step "Downloading Lumen to $DEST"
  git clone --quiet --depth 1 "https://github.com/$REPO.git" "$DEST"
  done_ "Downloaded"
else
  step "Downloading Lumen to $DEST"
  TMP="$(mktemp -d)"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" | tar -xz -C "$TMP"
  mkdir -p "$DEST"
  rsync -a --delete "$TMP"/*/ "$DEST/"
  rm -rf "$TMP"
  done_ "Downloaded"
fi

# ---------- optional video tools ----------
if ! command -v yt-dlp >/dev/null; then
  want=0
  if [[ $VIDEO == yes ]]; then want=1
  elif [[ $VIDEO == ask ]] && command -v brew >/dev/null; then
    say ""
    say "  ${dim}Optional: video transcripts & timestamps for videos without chapters need${reset}"
    say "  ${dim}yt-dlp + ffmpeg (Homebrew, about 0.5 GB). Everything else works without them.${reset}"
    ask "Install them now?" n && want=1
  fi
  if [[ $want == 1 ]]; then
    step "Installing yt-dlp and ffmpeg"
    brew install yt-dlp ffmpeg
  fi
fi

# ---------- router ----------
step "Setting up the local router"
"$DEST/host/install.sh" > /tmp/lumen-install.log 2>&1 || { cat /tmp/lumen-install.log; exit 1; }
grep -E "^✓ " /tmp/lumen-install.log | sed "s/^✓ /  ${ok}✓${reset} Registered with /"
claude_line="$(grep -E "^  Claude Code:" /tmp/lumen-install.log || true)"
if [[ "$claude_line" == *"not installed"* ]]; then
  say "  ${dim}No Claude Code found: add an API key in Lumen's ⓘ screen, or install Claude Code to use your login.${reset}"
else
  done_ "Claude Code login available (connect it in Lumen's ⓘ screen)"
fi

# ---------- load the extension ----------
EXT="$DEST/extension"
BROWSER="${LUMEN_BROWSER:-}" # set to "none" to skip opening a browser (and the clipboard)
[[ "$BROWSER" == none ]] || printf '%s' "$EXT" | pbcopy
if [[ -z "$BROWSER" ]]; then
  for b in "Dia" "Google Chrome" "Arc" "Brave Browser" "Microsoft Edge" "Chromium"; do
    [[ -d "/Applications/$b.app" ]] && { BROWSER="$b"; break; }
  done
fi
if [[ -n "$BROWSER" && "$BROWSER" != none ]]; then open -a "$BROWSER" "chrome://extensions" 2>/dev/null || true; fi

say ""
say "${bold}${ok}✓ Installed.${reset}${bold} One last step in $([[ -z "$BROWSER" || "$BROWSER" == none ]] && echo "your browser" || echo "$BROWSER")${reset} (the extensions page should be open):"
say ""
say "  ${bold}1${reset}  Turn on ${bold}Developer mode${reset} (top right)"
say "  ${bold}2${reset}  Click ${bold}Load unpacked${reset}, press ${bold}⌘⇧G${reset}, paste ${bold}⌘V${reset}, press Return, then ${bold}Select${reset}"
say "     ${dim}(the folder path is on your clipboard: $EXT)${reset}"
say "  ${bold}3${reset}  Click the Lumen icon in the toolbar (pin it from the puzzle menu)"
say ""
say "  ${dim}Already loaded? Just click ↻ on Lumen in the extensions page.${reset}"
say "  ${dim}Update anytime by running the same command again.${reset}"
say ""
