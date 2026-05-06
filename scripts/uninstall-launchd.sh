#!/bin/bash
# Uninstall all Straxis launchd agents
set -e

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

echo "Uninstalling Straxis launchd agents..."
echo ""

for plist in "$LAUNCH_AGENTS_DIR"/com.claudeclaw.*.plist; do
  [ -f "$plist" ] || continue
  label=$(basename "$plist" .plist)
  echo "Unloading $label..."
  launchctl unload "$plist" 2>/dev/null || true
  rm "$plist"
  echo "  Removed $plist"
done

echo ""
echo "All Straxis agents uninstalled."
echo "Processes will stop within a few seconds."
