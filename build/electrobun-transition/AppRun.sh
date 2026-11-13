#!/usr/bin/env bash
# OpenWaggle transition AppImage (docs/electrobun-transition.md).
#
# Existing Linux installs run OpenWaggle from an Electron AppImage that electron-updater replaces
# in place. When the newest release offers this AppImage, electron-updater swaps it in and starts
# it. This AppRun installs the Electrobun app with its own embedded installer, points the desktop
# entry and Session links at the new launcher, and from then on simply starts the installed app,
# so the old AppImage path and the `openwaggle` CLI shim that runs it keep working.
# User data in ~/.config/openwaggle is never touched here; the new app migrates it on first launch.
set -uo pipefail

IDENTIFIER='@IDENTIFIER@'
CHANNEL='@CHANNEL@'
VERSION='@VERSION@'
DOWNLOAD_URL='https://github.com/OpenWaggle/OpenWaggle/releases/latest'

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
LAUNCHER="${DATA_HOME}/${IDENTIFIER}/${CHANNEL}/app/bin/launcher"
STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/openwaggle"
LOG="${STATE_DIR}/electrobun-transition.log"
DESKTOP_DIR="${DATA_HOME}/applications"
LEGACY_DESKTOP_ENTRY="${DESKTOP_DIR}/openwaggle.desktop"

mkdir -p "${STATE_DIR}"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "${LOG}"; }

fail() {
  log "failed: $*"
  local message="OpenWaggle could not finish updating ($*). Your sessions and settings are unchanged. Install the new version from ${DOWNLOAD_URL}"
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --title='OpenWaggle update' --text="${message}" >/dev/null 2>&1 || true
  elif command -v kdialog >/dev/null 2>&1; then
    kdialog --title 'OpenWaggle update' --error "${message}" >/dev/null 2>&1 || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send 'OpenWaggle update' "${message}" >/dev/null 2>&1 || true
  fi
  printf '%s\n' "${message}" >&2
  command -v xdg-open >/dev/null 2>&1 && xdg-open "${DOWNLOAD_URL}" >/dev/null 2>&1 &
  exit 1
}

# Points install.sh's desktop entry, which also claims openwaggle: links, at the new launcher. When
# the Electrobun installer wrote its own visible entry, ours stays only as the link handler.
rewrite_desktop_entry() {
  [ -f "${LEGACY_DESKTOP_ENTRY}" ] || return 0
  local own_entry hidden=''
  own_entry="$(grep -l -F "${LAUNCHER}" "${DESKTOP_DIR}"/*.desktop 2>/dev/null | grep -v -F "${LEGACY_DESKTOP_ENTRY}" | head -1)"
  [ -n "${own_entry}" ] && hidden='NoDisplay=true'
  local temporary="${LEGACY_DESKTOP_ENTRY}.transition.$$"
  {
    grep -v -E '^(Exec|TryExec|NoDisplay)=' "${LEGACY_DESKTOP_ENTRY}"
    printf 'Exec="%s" %%U\n' "${LAUNCHER}"
    [ -n "${hidden}" ] && printf '%s\n' "${hidden}"
  } > "${temporary}" && mv -f "${temporary}" "${LEGACY_DESKTOP_ENTRY}"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${DESKTOP_DIR}" >/dev/null 2>&1
  command -v xdg-mime >/dev/null 2>&1 && xdg-mime default openwaggle.desktop x-scheme-handler/openwaggle >/dev/null 2>&1
  log "desktop entry now starts ${LAUNCHER}${hidden:+ (hidden: ${own_entry} is visible)}"
}

installed_now=0
# Never reinstall over an existing app: it may already have updated itself past this version.
if [ ! -x "${LAUNCHER}" ]; then
  log "installing OpenWaggle ${VERSION} (Electrobun ${CHANNEL}) from ${APPIMAGE:-${HERE}}"
  # The Electrobun installer extracts the app and starts it when it finishes.
  "${HERE}/usr/lib/openwaggle-transition/installer" >> "${LOG}" 2>&1 || fail "the installer exited with $?"
  [ -x "${LAUNCHER}" ] || fail "the installer did not create ${LAUNCHER}"
  installed_now=1
  log "installed ${LAUNCHER}"
fi
rewrite_desktop_entry || log "desktop entry rewrite failed"

# electron-updater sets this when the update should install without starting the app.
[ -n "${APPIMAGE_EXIT_AFTER_INSTALL:-}" ] && exit 0
# The installer already started the app; start it again only to hand it arguments.
[ "${installed_now}" = 1 ] && [ "$#" -eq 0 ] && exit 0
exec "${LAUNCHER}" "$@"
