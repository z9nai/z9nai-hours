#!/bin/sh
# Runs the bexio proxy as a macOS LaunchAgent: starts at login, restarts if it stops.
# Usage: scripts/bexio-proxy-agent.sh install | uninstall | status | setup
set -e

LABEL="ch.z9nai.hours.bexio-proxy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/bexio-proxy.mjs"
LOG="$HOME/Library/Logs/z9nai-hours-bexio-proxy.log"
NODE="$(command -v node || true)"

case "$1" in
  install)
    [ -n "$NODE" ] || { echo "node nicht gefunden"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$SCRIPT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installiert: bexio-Proxy startet ab jetzt automatisch (Log: $LOG)"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Entfernt: bexio-Proxy startet nicht mehr automatisch"
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "LaunchAgent aktiv"; else echo "LaunchAgent nicht installiert"; fi
    curl -s http://localhost:${BEXIO_PROXY_PORT:-8787}/health && echo || echo "Proxy antwortet nicht"
    ;;
  setup)
    # Client ID / secret of the registered bexio app (OAuth); the secret is not echoed
    printf "Client ID: "; read -r CID
    printf "Client Secret (Eingabe unsichtbar): "; stty -echo; read -r CSECRET; stty echo; echo
    [ -n "$CID" ] && [ -n "$CSECRET" ] || { echo "Abgebrochen: beide Werte nötig"; exit 1; }
    mkdir -p "$HOME/.config/z9nai-hours"
    CID="$CID" CSECRET="$CSECRET" node -e '
      const fs = require("fs"), f = require("os").homedir() + "/.config/z9nai-hours/bexio-oauth.json";
      fs.writeFileSync(f, JSON.stringify({ clientId: process.env.CID.trim(), clientSecret: process.env.CSECRET.trim() }, null, 2), { mode: 0o600 });
      fs.chmodSync(f, 0o600);'
    echo "Gespeichert in ~/.config/z9nai-hours/bexio-oauth.json – jetzt in der App unter Admin «Mit bexio verbinden» klicken."
    ;;
  *)
    echo "Verwendung: $0 install | uninstall | status | setup"; exit 1 ;;
esac
