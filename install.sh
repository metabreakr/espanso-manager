#!/bin/bash
# Espanso Manager — Copyright (C) 2026 Jonathan Ruzek
# SPDX-License-Identifier: GPL-3.0-only
#
# Installer for Espanso Manager. Safe to re-run any time (e.g. after updating).
# Works from wherever this folder lives — an iCloud Drive sync, a git clone, anywhere.
set -uo pipefail

APP_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_BUNDLE="$HOME/Applications/Espanso Manager.app"

echo "Espanso Manager installer"
echo "Source: $APP_SRC"
echo ""

# --- 1. Find Node.js, installing it via nvm only if it's genuinely missing. ---
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if ! command -v node >/dev/null 2>&1; then
  for cand in /opt/homebrew/bin /usr/local/bin; do
    [ -x "$cand/node" ] && export PATH="$cand:$PATH"
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found — installing it via nvm (no admin password required)..."
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
fi
NODE_BIN="$(command -v node)"
export PATH="$(dirname "$NODE_BIN"):$PATH"
echo "Using Node $(node --version)"

# --- 2. Install the one runtime dependency (yaml). No build step, no native code. ---
if [ ! -f "$APP_SRC/node_modules/yaml/package.json" ]; then
  echo "Installing dependencies..."
  (cd "$APP_SRC" && npm install --omit=dev)
fi

# --- 3. Build the .app bundle fresh on THIS Mac. Because it's created locally (never
#        downloaded or copied from another machine), macOS doesn't quarantine it, so
#        there's no "unidentified developer" Gatekeeper prompt. ---
echo "Creating $APP_BUNDLE"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
[ -f "$APP_SRC/AppIcon.icns" ] && cp "$APP_SRC/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"

cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Espanso Manager</string>
  <key>CFBundleDisplayName</key>
  <string>Espanso Manager</string>
  <key>CFBundleIdentifier</key>
  <string>ca.ruzek.espansomanager</string>
  <key>CFBundleVersion</key>
  <string>1.2.3</string>
  <key>CFBundleShortVersionString</key>
  <string>1.2.3</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>EspansoManager</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon.icns</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.productivity</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
PLIST

EXE="$APP_BUNDLE/Contents/MacOS/EspansoManager"

# Find a Swift compiler (Command Line Tools or full Xcode). If present, we build a real
# native window app; otherwise we fall back to a launcher that opens the UI in the browser.
SWIFTC=""
if command -v swiftc >/dev/null 2>&1; then
  SWIFTC="swiftc"
elif xcrun -f swiftc >/dev/null 2>&1; then
  SWIFTC="xcrun swiftc"
fi

if [ -n "$SWIFTC" ] && [ -f "$APP_SRC/EspansoManagerApp.swift" ]; then
  echo "Building native window app with Swift..."
  swift_src="$(cat "$APP_SRC/EspansoManagerApp.swift")"
  swift_src="${swift_src//__APP_DIR__/$APP_SRC}"
  swift_src="${swift_src//__NODE_BIN__/$NODE_BIN}"
  tmp_swift="$(mktemp -t EspansoManagerApp).swift"
  printf '%s\n' "$swift_src" > "$tmp_swift"
  if $SWIFTC -O -o "$EXE" "$tmp_swift"; then
    rm -f "$tmp_swift"
    echo "Built native app (standalone window)."
  else
    rm -f "$tmp_swift"
    echo "Swift build failed — falling back to the browser launcher."
    SWIFTC=""
  fi
fi

if [ -z "$SWIFTC" ] || [ ! -x "$EXE" ]; then
  # Fallback: shell launcher that starts the server and opens the UI in the default browser.
  launcher="$(cat "$APP_SRC/EspansoManager.launcher.sh")"
  launcher="${launcher//__APP_DIR__/$APP_SRC}"
  launcher="${launcher//__NODE_BIN__/$NODE_BIN}"
  printf '%s\n' "$launcher" > "$EXE"
  echo "Installed the browser-based launcher (no Swift compiler found)."
fi

chmod +x "$EXE"

# Nudge Launchpad/Finder to notice the (re)built app.
touch "$APP_BUNDLE"

echo ""
echo "Done! \"Espanso Manager\" is in ~/Applications."
echo "Open it from Launchpad, Spotlight (Cmd-Space), or the Applications folder."
