#!/bin/bash
# Espanso Manager — Copyright (C) 2026 Jonathan Ruzek
# SPDX-License-Identifier: GPL-3.0-only
#
# Espanso Manager launcher — installed into the .app bundle by install.sh.
# install.sh fills in the two absolute paths below at install time, so this works no
# matter where the app source lives (an iCloud folder, a git clone, anywhere) and
# regardless of how the GUI app's PATH is set up.

APP_DIR="__APP_DIR__"
NODE_BIN="__NODE_BIN__"
PORT="${ESPANSO_MANAGER_PORT:-8934}"
URL="http://127.0.0.1:$PORT"

alert() { osascript -e "display alert \"Espanso Manager\" message \"$1\"" >/dev/null 2>&1; }

# If our server is already running, just bring the browser tab up and exit.
if curl -sf -o /dev/null "$URL/api/meta"; then
  open "$URL"
  exit 0
fi

# Locate Node. Prefer the path recorded at install time; if that's gone (e.g. an nvm
# version was removed), fall back to nvm, then Homebrew, then whatever is on PATH.
if [ ! -x "$NODE_BIN" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
for cand in /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -x "$NODE_BIN" ] && break
  [ -x "$cand" ] && NODE_BIN="$cand"
done
if [ ! -x "$NODE_BIN" ]; then
  alert "Node.js could not be found. Open the app source folder and double-click install.command to set things up."
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

cd "$APP_DIR" || { alert "App folder not found:\n$APP_DIR"; exit 1; }

# Self-heal: reinstall the one dependency if it's missing (e.g. iCloud hasn't finished
# syncing yet, or "Optimize Mac Storage" evicted it).
if [ ! -f "node_modules/yaml/package.json" ]; then
  npm install --omit=dev >/tmp/espanso-manager-npm-install.log 2>&1
fi

"$NODE_BIN" server.mjs >/tmp/espanso-manager-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM

# Wait up to ~10s for the server to answer; bail early if it died (e.g. port in use).
UP=0
for _ in $(seq 1 50); do
  if curl -sf -o /dev/null "$URL/api/meta"; then UP=1; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.2
done

if [ "$UP" != "1" ]; then
  alert "The Espanso Manager server didn't start. Details: /tmp/espanso-manager-server.log"
  exit 1
fi

open "$URL"
wait "$SERVER_PID"
