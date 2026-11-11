#!/usr/bin/env bash
# Runtime packages, an X server, a window manager and a session bus for launching Electrobun apps
# on a GitHub Ubuntu runner (22.04 or 24.04). Exports DISPLAY's bus address into $GITHUB_ENV.
set -euo pipefail
. /etc/os-release
gtk=libgtk-3-0
if [ "${VERSION_ID}" != "22.04" ]; then gtk=libgtk-3-0t64; fi
sudo apt-get update -q
sudo apt-get install -y -q xvfb openbox imagemagick dbus-x11 zstd "$gtk" libwebkit2gtk-4.1-0 \
  libayatana-appindicator3-1 librsvg2-2 libnss3 libxss1 libasound2t64 2>/dev/null \
  || sudo apt-get install -y -q xvfb openbox imagemagick dbus-x11 zstd "$gtk" libwebkit2gtk-4.1-0 \
    libayatana-appindicator3-1 librsvg2-2 libnss3 libxss1 libasound2
# Ubuntu 24.04 blocks unprivileged user namespaces, which the Chromium and WebKitGTK sandboxes use.
# Allow them rather than turning either sandbox off.
if [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
fi
Xvfb "${DISPLAY:-:99}" -screen 0 1440x900x24 >/dev/null 2>&1 &
sleep 1
eval "$(dbus-launch --sh-syntax)"
echo "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS" >> "$GITHUB_ENV"
DISPLAY="${DISPLAY:-:99}" openbox >/dev/null 2>&1 &
