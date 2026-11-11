#!/usr/bin/env bash
# OpenWaggle installer — downloads the latest release for your platform.
# Usage: curl -fsSL https://openwaggle.ai/install | bash
# openwaggle.ai/install redirects to this file on main:
# https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh
# Opens the app when it finishes. Pass --no-launch (`bash -s -- --no-launch`) or set
# OPENWAGGLE_NO_LAUNCH=1 to skip that; it is also skipped over SSH, in CI, and without a display.
set -euo pipefail

NO_LAUNCH_ARGUMENT=""
for installer_argument in "$@"; do
  case "${installer_argument}" in
    --no-launch) NO_LAUNCH_ARGUMENT="1" ;;
    *) printf '\033[1;31merror:\033[0m Unknown option: %s\n' "${installer_argument}" >&2; exit 1 ;;
  esac
done

DEFAULT_REPO="OpenWaggle/OpenWaggle"
REPO="${OPENWAGGLE_INSTALL_REPO:-${DEFAULT_REPO}}"
RELEASE_TAG="${OPENWAGGLE_RELEASE_TAG:-}"
REQUESTED_CHANNEL="${OPENWAGGLE_CHANNEL:-}"
CHANNEL=""
# Set when a re-run keeps the channel the installed app has saved.
KEEP_INSTALLED_CHANNEL=""
RELEASES_API_URL="${OPENWAGGLE_RELEASES_API_URL:-https://api.github.com/repos/${REPO}/releases}"
RELEASE_API_URL="${OPENWAGGLE_RELEASE_API_URL:-}"
READY_MESSAGE="Ready to waggle"
READY_TYPE_DELAY_SECONDS="0.045"
READY_CURSOR_BLINK_DELAY_SECONDS="0.12"
READY_CURSOR_BLINK_CYCLES=2
MAC_APP_ID="com.openwaggle.app"
APP_QUIT_WAIT_SECONDS=30
QUIT_MAC_APP=""

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
error() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# BEGIN TESTABLE RELEASE RESOLUTION
# GitHub's API and release-asset storage occasionally answer with a transient
# 5xx. curl's --retry covers timeouts and HTTP 408/429/5xx with exponential
# backoff (1s, 2s, 4s, 8s, 16s), so one bad response no longer aborts the
# install. Permanent errors such as 404 still fail on the first response.
CURL_RETRY_ATTEMPTS=5

curl_with_retry() {
  curl --retry "${CURL_RETRY_ATTEMPTS}" "$@"
}

extract_release_tags() {
  { printf '%s' "$1" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' || true; } | \
    sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
}

release_page_url() {
  local base_url="$1"
  local page="$2"
  case "${base_url}" in
    *\?*) printf '%s&per_page=100&page=%s\n' "${base_url}" "${page}" ;;
    *) printf '%s?per_page=100&page=%s\n' "${base_url}" "${page}" ;;
  esac
}

fetch_release_pages() {
  local base_url="$1"
  local page=1
  local page_json
  local tag_count
  while true; do
    page_json="$(curl_with_retry -fsSL "$(release_page_url "${base_url}" "${page}")")" || return 1
    printf '%s\n' "${page_json}"
    tag_count="$(extract_release_tags "${page_json}" | wc -l | tr -d '[:space:]')"
    [ "${tag_count}" -lt 100 ] && return 0
    page=$((page + 1))
  done
}

release_matches_channel() {
  local tag="$1"
  local channel="$2"
  case "${channel}" in
    stable) printf '%s\n' "${tag}" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+$' ;;
    beta) printf '%s\n' "${tag}" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-(beta|rc)\.[0-9]+)?$' ;;
    alpha) printf '%s\n' "${tag}" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$' ;;
    *) return 1 ;;
  esac
}

release_tag_is_supported() {
  printf '%s\n' "$1" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$'
}

# Stable once it exists. Before that, Beta: the 1.0.0 line has no Alpha stage and a release
# candidate build follows Beta, so an install during Beta or RC never saves Alpha.
resolve_default_channel() {
  local releases_json="$1"
  local tag
  while IFS= read -r tag; do
    if release_matches_channel "${tag}" stable; then
      printf '%s\n' stable
      return 0
    fi
  done < <(extract_release_tags "${releases_json}")
  printf '%s\n' beta
}

release_is_newer() {
  local candidate="$1"
  local current="$2"
  local pattern='^v?([0-9]+)\.([0-9]+)\.([0-9]+)(-(alpha|beta|rc)\.([0-9]+))?$'
  local candidate_major candidate_minor candidate_patch candidate_channel candidate_sequence
  local current_major current_minor current_patch current_channel current_sequence
  [[ "${candidate}" =~ ${pattern} ]] || return 1
  candidate_major="${BASH_REMATCH[1]}"
  candidate_minor="${BASH_REMATCH[2]}"
  candidate_patch="${BASH_REMATCH[3]}"
  candidate_channel="${BASH_REMATCH[5]:-stable}"
  candidate_sequence="${BASH_REMATCH[6]:-0}"
  [[ "${current}" =~ ${pattern} ]] || return 0
  current_major="${BASH_REMATCH[1]}"
  current_minor="${BASH_REMATCH[2]}"
  current_patch="${BASH_REMATCH[3]}"
  current_channel="${BASH_REMATCH[5]:-stable}"
  current_sequence="${BASH_REMATCH[6]:-0}"

  [ "${candidate_major}" -gt "${current_major}" ] && return 0
  [ "${candidate_major}" -lt "${current_major}" ] && return 1
  [ "${candidate_minor}" -gt "${current_minor}" ] && return 0
  [ "${candidate_minor}" -lt "${current_minor}" ] && return 1
  [ "${candidate_patch}" -gt "${current_patch}" ] && return 0
  [ "${candidate_patch}" -lt "${current_patch}" ] && return 1

  local candidate_rank current_rank
  case "${candidate_channel}" in stable) candidate_rank=3 ;; rc) candidate_rank=2 ;; beta) candidate_rank=1 ;; *) candidate_rank=0 ;; esac
  case "${current_channel}" in stable) current_rank=3 ;; rc) current_rank=2 ;; beta) current_rank=1 ;; *) current_rank=0 ;; esac
  [ "${candidate_rank}" -gt "${current_rank}" ] && return 0
  [ "${candidate_rank}" -lt "${current_rank}" ] && return 1
  [ "${candidate_sequence}" -gt "${current_sequence}" ]
}

resolve_release_tag() {
  local releases_json="$1"
  local channel="$2"
  local tag selected=''
  while IFS= read -r tag; do
    if release_matches_channel "${tag}" "${channel}" && \
      { [ -z "${selected}" ] || release_is_newer "${tag}" "${selected}"; }; then
      selected="${tag}"
    fi
  done < <(extract_release_tags "${releases_json}")
  [ -n "${selected}" ] || return 1
  printf '%s\n' "${selected}"
}

# Releases also publish a `.blockmap` beside each installer for differential updates, and its
# name extends the installer's. Both lookups below therefore match whole names, never substrings.
select_asset_url() {
  local release_json="$1"
  local asset_pattern="$2"
  printf '%s' "${release_json}" | grep '"browser_download_url"' | \
    sed -n "s/.*\"browser_download_url\": *\"\([^\"]*\)\".*/\1/p" | \
    grep -E "/${asset_pattern}\$" | head -1
}

# Prints the SHA-256 that `sha256sum`-format SHA256SUMS.txt lists for exactly this file name.
expected_checksum() {
  local checksum_file="$1"
  local file_name="$2"
  awk -v name="${file_name}" '{ entry = $2; sub(/^\*/, "", entry) } entry == name { print $1; exit }' \
    "${checksum_file}"
}
# END TESTABLE RELEASE RESOLUTION

# BEGIN TESTABLE UPDATE CHANNEL PREFERENCE
update_channel_intent_path() {
  local config_root
  if [ "${PLATFORM}" = "mac" ]; then
    config_root="${HOME}/Library/Application Support"
  else
    config_root="${XDG_CONFIG_HOME:-${HOME}/.config}"
  fi
  printf '%s/openwaggle/install-update-channel\n' "${config_root}"
}

# A re-run keeps the channel the installed app has saved, so it writes nothing then.
persist_selected_channel() {
  [ -n "${CHANNEL}" ] || return 0
  [ "${KEEP_INSTALLED_CHANNEL:-}" = "1" ] && return 0
  local intent_path intent_directory temporary_path
  intent_path="$(update_channel_intent_path)"
  intent_directory="$(dirname "${intent_path}")"
  mkdir -p "${intent_directory}" || return 1
  temporary_path="$(mktemp "${intent_directory}/.install-update-channel.XXXXXX")" || return 1
  if ! chmod 600 "${temporary_path}"; then
    rm -f "${temporary_path}"
    return 1
  fi
  if ! printf '%s\n' "${CHANNEL}" > "${temporary_path}" || \
    ! mv -f "${temporary_path}" "${intent_path}"; then
    rm -f "${temporary_path}"
    return 1
  fi
}
# END TESTABLE UPDATE CHANNEL PREFERENCE

install_executable_atomically() {
  local source_path="$1"
  local destination_path="$2"
  local destination_directory
  local temporary_path
  destination_directory="$(dirname "${destination_path}")"
  temporary_path="$(mktemp "${destination_directory}/.openwaggle-install.XXXXXX")"
  if ! cp "${source_path}" "${temporary_path}" || ! chmod +x "${temporary_path}"; then
    rm -f "${temporary_path}"
    return 1
  fi
  if command -v sync >/dev/null 2>&1; then
    sync -f "${temporary_path}" 2>/dev/null || true
  fi
  mv -f "${temporary_path}" "${destination_path}"
}

# BEGIN TESTABLE CLI TARGET GUARD
CLI_SHIM_MARKER='# Managed by OpenWaggle. Bundled CLI command.'
LEGACY_CLI_SHIM_MARKER='# Managed by OpenWaggle. Configure from Settings > Agent access.'

has_linux_appimage_magic() {
  local target="$1"
  local elf_magic
  local appimage_magic
  elf_magic="$(LC_ALL=C od -An -tx1 -N4 "${target}" 2>/dev/null | tr -d '[:space:]')"
  appimage_magic="$(LC_ALL=C od -An -tx1 -j8 -N3 "${target}" 2>/dev/null | tr -d '[:space:]')"
  [ "${elf_magic}" = '7f454c46' ] && \
    { [ "${appimage_magic}" = '414901' ] || [ "${appimage_magic}" = '414902' ]; }
}

has_managed_cli_shim_marker() {
  local header
  header="$(LC_ALL=C dd if="$1" bs=512 count=1 2>/dev/null | sed -n '1,2p')" || return 1
  case "${header}" in
    $'#!/bin/sh\n'"${CLI_SHIM_MARKER}" | $'#!/bin/sh\n'"${LEGACY_CLI_SHIM_MARKER}") return 0 ;;
  esac
  return 1
}

cli_target_is_replaceable() {
  local target="$1"
  local platform="$2"
  local legacy_reference="$3"
  local logical_target="${4:-${target}}"

  if [ ! -e "${target}" ] && [ ! -L "${target}" ]; then
    return 0
  fi
  if [ -f "${target}" ] && [ ! -L "${target}" ] && \
    has_managed_cli_shim_marker "${target}"; then
    return 0
  fi
  if [ "${platform}" = "mac" ] && [ -L "${target}" ] && \
    [ "$(readlink "${target}")" = "${legacy_reference}" ]; then
    return 0
  fi
  if [ "${platform}" = "linux" ] && [ -f "${target}" ] && [ ! -L "${target}" ] && \
    [ -x "${target}" ] && has_linux_appimage_magic "${target}" && \
    [ -f "${legacy_reference}" ] && [ ! -L "${legacy_reference}" ] && \
    grep -Fqx -- 'Name=OpenWaggle' "${legacy_reference}" && \
    grep -Fqx -- "Exec=${logical_target} %U" "${legacy_reference}"; then
    return 0
  fi
  return 1
}

restore_preserved_cli_target() {
  local backup_path="$1"
  local install_path="$2"
  local link_target

  if [ -L "${backup_path}" ]; then
    if ! link_target="$(readlink "${backup_path}")"; then
      return 1
    fi
    if ln -s "${link_target}" "${install_path}" 2>/dev/null && \
      rm -f "${backup_path}"; then
      return 0
    fi
  elif [ -f "${backup_path}" ] && ln "${backup_path}" "${install_path}" 2>/dev/null && \
    rm -f "${backup_path}"; then
    return 0
  fi
  return 1
}

install_cli_shim_atomically() {
  local shim_temp_path="$1"
  local install_path="$2"
  local platform="$3"
  local legacy_reference="$4"
  local backup_path=''
  local backup_directory=''

  if ! cli_target_is_replaceable "${install_path}" "${platform}" "${legacy_reference}"; then
    rm -f "${shim_temp_path}"
    return 1
  fi
  if [ -e "${install_path}" ] || [ -L "${install_path}" ]; then
    if ! backup_directory="$(mktemp -d "${install_path}.openwaggle-backup.XXXXXX")"; then
      rm -f "${shim_temp_path}"
      return 1
    fi
    backup_path="${backup_directory}/original"
    if ! mv "${install_path}" "${backup_path}"; then
      rm -f "${shim_temp_path}"
      rmdir "${backup_directory}"
      return 1
    fi
    if ! cli_target_is_replaceable \
      "${backup_path}" "${platform}" "${legacy_reference}" "${install_path}"; then
      rm -f "${shim_temp_path}"
      if restore_preserved_cli_target "${backup_path}" "${install_path}"; then
        rmdir "${backup_directory}"
      else
        printf 'CLI target changed during installation; preserved it at %s\n' \
          "${backup_path}" >&2
      fi
      return 1
    fi
  fi
  if ! ln "${shim_temp_path}" "${install_path}" 2>/dev/null; then
    rm -f "${shim_temp_path}"
    if [ -n "${backup_path}" ] && \
      restore_preserved_cli_target "${backup_path}" "${install_path}"; then
      rmdir "${backup_directory}"
    elif [ -n "${backup_path}" ]; then
      printf 'Preserved the previous OpenWaggle CLI target at %s\n' "${backup_path}" >&2
    fi
    return 1
  fi
  rm -f "${shim_temp_path}"
  if [ -n "${backup_path}" ]; then
    rm -f "${backup_path}"
    rmdir "${backup_directory}"
  fi
}
# END TESTABLE CLI TARGET GUARD

# BEGIN TESTABLE LINUX DESKTOP ENTRY
# The desktop entry also claims Session links (openwaggle://sessions/<id>, ADR 0056): the
# AppImage's own entry, which declares the scheme, is never integrated. Making
# OpenWaggle the default handler is best effort; a desktop without xdg-utils still gets the entry.
write_linux_desktop_entry() {
  local desktop_dir="$1"
  local appimage_path="$2"
  mkdir -p "${desktop_dir}"
  cat > "${desktop_dir}/openwaggle.desktop" <<DESKTOP
[Desktop Entry]
Name=OpenWaggle
Comment=Desktop coding agent with multi-model support
Exec=${appimage_path} %U
Terminal=false
Type=Application
Categories=Development;IDE;
MimeType=x-scheme-handler/openwaggle;
DESKTOP
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${desktop_dir}" >/dev/null 2>&1 || true
  fi
  if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default openwaggle.desktop x-scheme-handler/openwaggle >/dev/null 2>&1 || true
  fi
}
# END TESTABLE LINUX DESKTOP ENTRY

# BEGIN TESTABLE LAUNCH POLICY
# Prints why the installer must not open the app, or nothing when it may.
launch_skip_reason() {
  local platform="$1"
  if [ "${NO_LAUNCH_ARGUMENT:-}" = "1" ] || [ "${OPENWAGGLE_NO_LAUNCH:-}" = "1" ]; then
    printf '%s\n' "launch was disabled"
  elif [ -n "${CI:-}" ]; then
    printf '%s\n' "running in CI"
  elif [ -n "${SSH_CONNECTION:-}" ] || [ -n "${SSH_TTY:-}" ]; then
    printf '%s\n' "running over SSH"
  elif [ "${platform}" = "linux" ] && [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    printf '%s\n' "no graphical session is available"
  fi
}
# END TESTABLE LAUNCH POLICY

# BEGIN TESTABLE MAC APP QUIT
# The desktop window process is the app's only Foreground process. The detached Session Host and
# CLI invocations share its bundle id but register as UIElement, so they are never matched here.
# Only the app at the bundle path being replaced counts: an install into
# OPENWAGGLE_APPLICATIONS_DIR leaves an OpenWaggle running from anywhere else open. Both paths are
# compared physically, so a symlinked directory (/var is /private/var) still matches.
running_mac_gui_pids() {
  local bundle_path="$1" asn record pid type running_path physical_path
  for asn in $(lsappinfo find "bundleid=${MAC_APP_ID}" 2>/dev/null); do
    record="$(lsappinfo info -only pid,applicationtype,bundlepath "${asn}" 2>/dev/null)" || continue
    pid="$(printf '%s\n' "${record}" | sed -n 's/^"pid"=\([0-9][0-9]*\)$/\1/p')"
    type="$(printf '%s\n' "${record}" | sed -n 's/^"ApplicationType"="\(.*\)"$/\1/p')"
    running_path="$(printf '%s\n' "${record}" | sed -n 's/^"LSBundlePath"="\(.*\)"$/\1/p')"
    [ -n "${pid}" ] && [ "${type}" = "Foreground" ] && [ -n "${running_path}" ] || continue
    physical_path="$(cd "${running_path}" 2>/dev/null && pwd -P)" || physical_path="${running_path}"
    [ "${physical_path}" = "${bundle_path}" ] && printf '%s\n' "${pid}"
  done
  return 0
}

# Quit the running desktop app with SIGTERM, its normal quit path, so it saves state before its
# bundle is replaced. Its Session Host keeps running; the installer stops
# it next, after asking about active agent runs.
quit_running_mac_app() {
  local bundle_path="$1" pids pid waited
  pids="$(running_mac_gui_pids "${bundle_path}")"
  [ -n "${pids}" ] || return 0
  QUIT_MAC_APP="1"
  info "Quitting the running OpenWaggle…"
  for pid in ${pids}; do kill -TERM "${pid}" 2>/dev/null || true; done
  for ((waited = 0; waited < APP_QUIT_WAIT_SECONDS; waited++)); do
    [ -n "$(running_mac_gui_pids "${bundle_path}")" ] || return 0
    sleep 1
  done
  error "OpenWaggle is still running. Quit it, then run the installer again."
}
# END TESTABLE MAC APP QUIT

# BEGIN TESTABLE SESSION HOST STOP
HOST_STOP_FALLBACK_TIMEOUT_MS=20000

# Runs the installed CLI without letting it read stdin: under `curl … | bash` that is the rest of
# this script. Questions go to the terminal. The AppImage writes noise to stdout, so its CLI output
# uses a separate descriptor, as the `openwaggle` shim does.
run_installed_cli() {
  local platform="$1" executable="$2"
  shift 2
  if [ "${platform}" = "linux" ]; then
    env OPENWAGGLE_CLI_OUTPUT_FD=3 "${executable}" "$@" 3>&1 1>/dev/null </dev/null
  else
    "${executable}" "$@" </dev/null
  fi
}

# The version of an installed AppImage, from the desktop entry inside it
# (scripts/electrobun-transition/linux-transition-appimage.ts writes X-AppImage-Version).
# Extracting one file runs nothing from the app.
appimage_version() {
  local appimage="$1" scratch
  [ -x "${appimage}" ] || return 0
  scratch="$(mktemp -d "${TMPDIR:-/tmp}/openwaggle-appimage.XXXXXX")" || return 0
  (cd "${scratch}" && "${appimage}" --appimage-extract '*.desktop' >/dev/null 2>&1 </dev/null) || true
  sed -n 's/^X-AppImage-Version=//p' "${scratch}"/squashfs-root/*.desktop 2>/dev/null | head -1
  rm -rf "${scratch}"
}

# Prints the help of the installed `host` command, or nothing when the version predates it or is
# unknown. A version before 1.0.0-beta.1 has no `host` command and opens its window for any
# command it does not know, so it is never run.
installed_host_help() {
  local platform="$1" executable="$2" version="$3"
  case "${version}" in
    ''|0.*) return 0 ;;
  esac
  run_installed_cli "${platform}" "${executable}" host --help 2>/dev/null || true
}

# Stops the installed version's Session Host before its app is replaced, as Restart to update does
# (ADR 0047). If agent runs are active the CLI asks whether to wait for them, stop them, or cancel.
# Prints the outcome state, or nothing when it is unknown. An older CLI without `host stop --update`
# gets a plain stop, which waits up to 20 seconds for active work instead of asking.
session_host_update_stop_state() {
  local platform="$1" executable="$2" version="$3" help output
  [ -x "${executable}" ] || { printf '%s\n' "not-installed"; return 0; }
  help="$(installed_host_help "${platform}" "${executable}" "${version}")"
  case "${help}" in
    *--update*)
      output="$(run_installed_cli "${platform}" "${executable}" host stop --update --json || true)"
      ;;
    *"host stop"*)
      output="$(run_installed_cli "${platform}" "${executable}" host stop --wait \
        --timeout-ms "${HOST_STOP_FALLBACK_TIMEOUT_MS}" --json || true)"
      ;;
    *) printf '%s\n' "unsupported"; return 0 ;;
  esac
  printf '%s\n' "${output}" | sed -n 's/.*"state": *"\([a-z-]*\)".*/\1/p' | head -1
}

# Leaves the installed app as it was: the mounted image detached, the window reopened if the
# installer quit it.
restore_installed_app() {
  if [ -n "${MOUNT_POINT:-}" ]; then hdiutil detach "${MOUNT_POINT}" -quiet 2>/dev/null || true; fi
  rm -f "${DOWNLOAD_PATH:-}"
  # Reopened even with --no-launch: the installer quit it, so this puts it back as it was.
  if [ "${QUIT_MAC_APP:-}" = "1" ]; then open "${INSTALLED_APP_PATH}" 2>/dev/null || true; fi
}

stop_session_host_for_update() {
  local state
  info "Stopping the OpenWaggle Session Host…"
  # Ctrl-C while it waits for agent runs cancels the update, not the installed app.
  trap 'restore_installed_app; error "Update cancelled. OpenWaggle was not updated."' INT TERM
  state="$(session_host_update_stop_state "${PLATFORM}" "$1" "$2")"
  trap - INT TERM
  case "${state}" in
    stopped|not-running|not-installed) ;;
    cancelled)
      restore_installed_app
      error "Update cancelled. OpenWaggle was not updated."
      ;;
    desktop-open)
      if [ "${PLATFORM}" = "mac" ]; then
        restore_installed_app
        # The installer quits only the app it replaces, but every installed copy shares one Host.
        [ "${QUIT_MAC_APP:-}" = "1" ] || \
          error "OpenWaggle is open and uses the Session Host this install must stop. Quit it, then run the installer again."
        error "OpenWaggle was opened again while the installer waited, or another copy of it is open. Quit it, then run the installer again."
      fi
      info "OpenWaggle is open, so it keeps its Session Host. Quit it, then run \`openwaggle host stop --update\`."
      ;;
    replaced)
      # macOS would replace the bundle under a running Host; an AppImage is replaced as one file.
      if [ "${PLATFORM}" = "mac" ]; then
        restore_installed_app
        error "Another OpenWaggle process, such as \`openwaggle mcp serve\`, keeps starting a Session Host. Close it, then run the installer again."
      fi
      info "Another OpenWaggle process keeps a Session Host running. Close it, then run \`openwaggle host stop --update\`."
      ;;
    timed-out) info "The Session Host is still stopping. Restart OpenWaggle once its work ends." ;;
    unsupported) info "This OpenWaggle version cannot stop its Session Host. Run \`openwaggle host stop --update\` after the install." ;;
    *) info "Could not stop the Session Host. Run \`openwaggle host stop --wait\` before you reopen OpenWaggle." ;;
  esac
}
# END TESTABLE SESSION HOST STOP

# BEGIN TESTABLE DOWNGRADE GUARD
# The exit status of a refused downgrade, the status `openwaggle update --version` uses for it.
DOWNGRADE_REFUSED_EXIT_CODE=2
MAC_APP_BUNDLE_NAME="OpenWaggle.app"

# The version of the macOS app at a bundle path, or nothing when none is installed there.
# PlistBuddy reports a missing file on stdout, so it is only asked about a file that exists.
mac_app_version() {
  [ -f "$1/Contents/Info.plist" ] || return 0
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$1/Contents/Info.plist" \
    2>/dev/null || true
}

# The newer of two versions, either of which may be empty or unknown. On Linux the downgrade guard
# compares with the newer of the version file a previous install wrote beside the AppImage and the
# AppImage's own desktop entry: an update from the app or from `openwaggle update` replaces the
# AppImage in place and leaves the file behind, and an AppImage from before the file has only its
# desktop entry.
newer_release_version() {
  local first="$1" second="$2"
  if [ -n "${first}" ] && { [ -z "${second}" ] || release_is_newer "${first}" "${second}"; }; then
    printf '%s\n' "${first}"
  else
    printf '%s\n' "${second}"
  fi
}

# Prints why the target must not replace the installed version, or nothing when it may. Downgrades
# are unsupported (docs/release-and-versioning.md): the older Session Host refuses a database a
# newer one has migrated, so the app would not open. The installed version reinstalls, and an
# unknown installed version, such as a build from before the version file, installs as before.
downgrade_refusal() {
  local installed="${1#v}" target="$2"
  release_tag_is_supported "${installed}" || return 0
  if ! release_tag_is_supported "${target}"; then
    printf '%s\n' "OpenWaggle cannot compare ${target} with the installed version ${installed}, so it does not install it."
  elif release_is_newer "${installed}" "${target}"; then
    printf '%s\n' "OpenWaggle ${target} is older than the installed ${installed}. Downgrades are unsupported: an older version may not open the data this version has already migrated."
  fi
}

# Exits before anything is quit, stopped or replaced when the target would be a downgrade. A third
# argument, when given, says how to pick another release.
refuse_downgrade() {
  local refusal
  refusal="$(downgrade_refusal "$1" "$2")"
  [ -n "${refusal}" ] || return 0
  restore_installed_app
  printf '\033[1;31merror:\033[0m %s OpenWaggle was not changed.%s\n' "${refusal}" "${3:+ $3}" >&2
  exit "${DOWNGRADE_REFUSED_EXIT_CODE}"
}
# END TESTABLE DOWNGRADE GUARD

# BEGIN TESTABLE INSTALLED UPDATE CHANNEL
# The newest release without `openwaggle update --check --json`, which reports the saved channel.
LAST_VERSION_WITHOUT_CHANNEL_CHECK="1.0.0-beta.37"
# The check may start the installed version's Session Host and asks GitHub for releases.
INSTALLED_CHANNEL_READ_TIMEOUT_SECONDS=60
# How long a stopped check may take to quit before it is killed.
CHANNEL_READ_STOP_GRACE_SECONDS=3

# Whether the installed app can report its saved channel: it exists and is newer than the last
# version without `update --check --json`. Older and unknown versions are never run.
installed_reports_update_channel() {
  local executable="$1" version="$2"
  [ -x "${executable}" ] && release_tag_is_supported "${version}" && \
    release_is_newer "${version}" "${LAST_VERSION_WITHOUT_CHANNEL_CHECK}"
}

# Stops a channel read that is still running: a normal quit first, then a kill.
stop_channel_read() {
  local pid="$1" waited
  kill -TERM "${pid}" 2>/dev/null || return 0
  for ((waited = 0; waited < CHANNEL_READ_STOP_GRACE_SECONDS; waited++)); do
    kill -0 "${pid}" 2>/dev/null || return 0
    sleep 1
  done
  kill -KILL "${pid}" 2>/dev/null || true
}

# Sets INSTALLED_CHANNEL to the update channel the installed app has saved, or to nothing when it
# cannot tell: nothing is installed, the version of its executable is unknown or too old to report
# it, or the Session Host cannot read it in time. `--check` only reads, so asking never changes the
# channel. The saved channel is in the response, or in the error envelope when only the release
# check failed. The output goes to a file, not a pipe, so a CLI that is still running at the
# deadline cannot keep the installer waiting. It runs in the installer's own shell, not in a
# command substitution, so its traps see every signal the installer gets.
installed_update_channel() {
  local platform="$1" executable="$2" version="$3" output pid waited finished=""
  INSTALLED_CHANNEL=""
  installed_reports_update_channel "${executable}" "${version}" || return 0
  output="$(mktemp "${TMPDIR:-/tmp}/openwaggle-channel.XXXXXX")" || return 0
  info "Reading the update channel of the installed OpenWaggle…"
  # As run_installed_cli: stdin closed, and the AppImage's CLI output on descriptor 3.
  if [ "${platform}" = "linux" ]; then
    env OPENWAGGLE_CLI_OUTPUT_FD=3 "${executable}" update --check --json \
      3>"${output}" 1>/dev/null 2>&3 </dev/null &
  else
    "${executable}" update --check --json >"${output}" 2>&1 </dev/null &
  fi
  pid=$!
  # A background command ignores Ctrl-C, so the installer stops it and removes its file itself.
  trap 'stop_channel_read "${pid}"; rm -f "${output}"; exit 130' INT
  trap 'stop_channel_read "${pid}"; rm -f "${output}"; exit 143' TERM
  for ((waited = 0; waited < INSTALLED_CHANNEL_READ_TIMEOUT_SECONDS; waited++)); do
    if ! kill -0 "${pid}" 2>/dev/null; then finished="1"; break; fi
    sleep 1
  done
  # Only a CLI that is still ours: once it exited, its pid may belong to another process.
  [ -n "${finished}" ] || stop_channel_read "${pid}"
  wait "${pid}" 2>/dev/null || true
  trap - INT TERM
  INSTALLED_CHANNEL="$(sed -En 's/.*"savedChannel":[[:space:]]*"(stable|beta|alpha)".*/\1/p' \
    "${output}" | head -1)"
  rm -f "${output}"
}
# END TESTABLE INSTALLED UPDATE CHANNEL

launch_installed_app() {
  local skip_reason
  skip_reason="$(launch_skip_reason "${PLATFORM}")"
  if [ -n "${skip_reason}" ]; then
    info "Not opening OpenWaggle (${skip_reason}). Run \`openwaggle\` or open the app to start it."
    return
  fi
  info "Opening OpenWaggle…"
  if [ "${PLATFORM}" = "mac" ]; then
    open "${INSTALLED_APP_PATH}" || info "Could not open OpenWaggle; open it from Applications."
  else
    if command -v setsid >/dev/null 2>&1; then
      setsid "${APPIMAGE_PATH}" >/dev/null 2>&1 < /dev/null &
    else
      nohup "${APPIMAGE_PATH}" >/dev/null 2>&1 < /dev/null &
    fi
    info "If OpenWaggle was already open, quit it, run \`openwaggle host stop --update\`, then open it to use ${VERSION}."
  fi
}

animate_ready() {
  if [ ! -t 1 ]; then
    info "${READY_MESSAGE}"
    return
  fi

  local message_length
  message_length="${#READY_MESSAGE}"
  local index

  printf '\033[1;34m==>\033[0m '
  for ((index = 1; index <= message_length; index++)); do
    printf '\r\033[1;34m==>\033[0m \033[1;33m%s▌\033[0m' "${READY_MESSAGE:0:index}"
    sleep "${READY_TYPE_DELAY_SECONDS}"
  done

  for ((index = 0; index < READY_CURSOR_BLINK_CYCLES; index++)); do
    printf '\r\033[1;34m==>\033[0m \033[1;33m%s \033[0m' "${READY_MESSAGE}"
    sleep "${READY_CURSOR_BLINK_DELAY_SECONDS}"
    printf '\r\033[1;34m==>\033[0m \033[1;33m%s▌\033[0m' "${READY_MESSAGE}"
    sleep "${READY_CURSOR_BLINK_DELAY_SECONDS}"
  done

  printf '\r\033[1;34m==>\033[0m \033[1;33m%s ✨\033[0m\n' "${READY_MESSAGE}"
}

# --- Detect OS and architecture ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}" in
  Darwin) PLATFORM="mac" ;;
  Linux)  PLATFORM="linux" ;;
  *)      error "Unsupported OS: ${OS}" ;;
esac

case "${ARCH}" in
  x86_64|amd64)
    if [ "${PLATFORM}" = "linux" ]; then
      ARCH_LABEL="x86_64"
    else
      ARCH_LABEL="x64"
    fi
    ;;
  arm64|aarch64) ARCH_LABEL="arm64" ;;
  *)             error "Unsupported architecture: ${ARCH}" ;;
esac

# --- Find the installed app ---
# INSTALLED_VERSION is what the downgrade guard compares with. INSTALLED_CLI_VERSION is the version
# of the executable itself, which decides whether it may be run.
if [ "${PLATFORM}" = "mac" ]; then
  APPLICATIONS_DIR="${OPENWAGGLE_APPLICATIONS_DIR:-/Applications}"
  INSTALLED_EXECUTABLE="${APPLICATIONS_DIR}/${MAC_APP_BUNDLE_NAME}/Contents/MacOS/OpenWaggle"
  INSTALLED_VERSION="$(mac_app_version "${APPLICATIONS_DIR}/${MAC_APP_BUNDLE_NAME}")"
  INSTALLED_CLI_VERSION="${INSTALLED_VERSION}"
else
  APP_DIR="${HOME}/.local/lib/openwaggle"
  INSTALLED_EXECUTABLE="${APP_DIR}/OpenWaggle.AppImage"
  RECORDED_APPIMAGE_VERSION="$(cat "${APP_DIR}/version" 2>/dev/null || true)"
  EMBEDDED_APPIMAGE_VERSION="$(appimage_version "${INSTALLED_EXECUTABLE}")"
  INSTALLED_VERSION="$(newer_release_version \
    "${EMBEDDED_APPIMAGE_VERSION}" "${RECORDED_APPIMAGE_VERSION}")"
  INSTALLED_CLI_VERSION="${EMBEDDED_APPIMAGE_VERSION:-${RECORDED_APPIMAGE_VERSION}}"
fi
# Set when the target comes from a channel, to say how to pick another one if it is a downgrade.
DOWNGRADE_HINT=""

# --- Resolve and fetch release info ---
if [ -n "${RELEASE_API_URL}" ]; then
  info "Fetching release metadata…"
  RELEASE_JSON="$(curl_with_retry -fsSL "${RELEASE_API_URL}")" || error "Failed to fetch release info. Is the repo public?"
elif [ -n "${RELEASE_TAG}" ]; then
  case "${RELEASE_TAG}" in
    v*) ;;
    *) RELEASE_TAG="v${RELEASE_TAG}" ;;
  esac
  release_tag_is_supported "${RELEASE_TAG}" || error "Invalid release version: ${RELEASE_TAG}"
  info "Fetching release metadata…"
  RELEASE_JSON="$(curl_with_retry -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}")" || \
    error "Failed to fetch release ${RELEASE_TAG}."
else
  case "${REQUESTED_CHANNEL}" in
    ''|stable|beta|alpha) ;;
    *) error "Invalid channel '${REQUESTED_CHANNEL}'. Use stable, beta, or alpha." ;;
  esac
  # Only OPENWAGGLE_CHANNEL changes the channel, as `openwaggle update --channel` does. Without it a
  # re-run keeps the installed app's channel, and a first install saves the default.
  CHANNEL="${REQUESTED_CHANNEL}"
  DEFAULT_CHANNEL_REASON=""
  if [ -z "${CHANNEL}" ]; then
    # Asks only an installed version that can answer, so a first install asks nothing.
    installed_update_channel "${PLATFORM}" "${INSTALLED_EXECUTABLE}" "${INSTALLED_CLI_VERSION}"
    CHANNEL="${INSTALLED_CHANNEL}"
    if [ -n "${CHANNEL}" ]; then
      KEEP_INSTALLED_CHANNEL="1"
    elif installed_reports_update_channel "${INSTALLED_EXECUTABLE}" "${INSTALLED_CLI_VERSION}"; then
      DEFAULT_CHANNEL_REASON="Could not read the update channel of the installed OpenWaggle"
    elif [ -x "${INSTALLED_EXECUTABLE}" ] && [ -n "${INSTALLED_CLI_VERSION}" ]; then
      DEFAULT_CHANNEL_REASON="OpenWaggle ${INSTALLED_CLI_VERSION} cannot report its update channel"
    elif [ -x "${INSTALLED_EXECUTABLE}" ]; then
      DEFAULT_CHANNEL_REASON="OpenWaggle is installed, but its version is unknown"
    fi
  fi
  info "Fetching release metadata…"
  RELEASES_JSON="$(fetch_release_pages "${RELEASES_API_URL}")" || \
    error "Failed to list releases. Is the repo public?"
  [ -n "${CHANNEL}" ] || CHANNEL="$(resolve_default_channel "${RELEASES_JSON}")"
  if ! RELEASE_TAG="$(resolve_release_tag "${RELEASES_JSON}" "${CHANNEL}")"; then
    # As `openwaggle update` reports it: up to date, not a failure, and nothing changes.
    if [ "${KEEP_INSTALLED_CHANNEL:-}" = "1" ]; then
      info "OpenWaggle is up to date on the ${CHANNEL} channel: no release is available on it yet. Set OPENWAGGLE_CHANNEL to install from another channel."
      exit 0
    fi
    error "No ${CHANNEL} release is available."
  fi
  if [ "${KEEP_INSTALLED_CHANNEL:-}" = "1" ]; then
    info "Update channel: ${CHANNEL}, kept from the installed OpenWaggle"
  elif [ -n "${DEFAULT_CHANNEL_REASON}" ]; then
    # Saving the default changes the channel of an existing install, so say so.
    info "${DEFAULT_CHANNEL_REASON}, so the installer will save the default channel, ${CHANNEL}. Set OPENWAGGLE_CHANNEL to choose another."
  else
    info "Update channel: ${CHANNEL}"
  fi
  DOWNGRADE_HINT="It is ahead of the ${CHANNEL} channel; set OPENWAGGLE_CHANNEL or OPENWAGGLE_RELEASE_TAG to install another release."
  RELEASE_JSON="$(curl_with_retry -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}")" || \
    error "Failed to fetch release ${RELEASE_TAG}."
fi
VERSION="$(printf '%s' "${RELEASE_JSON}" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
[ -z "${VERSION:-}" ] && error "Release metadata did not include a version."
info "Resolved version: ${VERSION}"

# --- Refuse a downgrade, before the download ---
refuse_downgrade "${INSTALLED_VERSION}" "${VERSION}" "${DOWNGRADE_HINT}"

# --- Determine asset name ---
if [ "${PLATFORM}" = "mac" ]; then
  ASSET_PATTERN="openwaggle-.*-${ARCH_LABEL}\\.dmg"
elif [ "${PLATFORM}" = "linux" ]; then
  ASSET_PATTERN="openwaggle-.*-${ARCH_LABEL}\\.AppImage"
fi

ASSET_URL="$(select_asset_url "${RELEASE_JSON}" "${ASSET_PATTERN}")"
[ -z "${ASSET_URL:-}" ] && error "No matching asset found for ${PLATFORM}/${ARCH_LABEL}"

FILENAME="$(basename "${ASSET_URL}")"

# --- Download ---
TMPDIR="${TMPDIR:-/tmp}"
DOWNLOAD_PATH="${TMPDIR}/${FILENAME}"
info "Downloading ${FILENAME}…"
curl_with_retry -fSL --progress-bar -o "${DOWNLOAD_PATH}" "${ASSET_URL}"

# --- Verify SHA256 if checksum file exists ---
SHA_URL="$(printf '%s' "${RELEASE_JSON}" | grep '"browser_download_url"' | sed -n "s/.*\"browser_download_url\": *\"\([^\"]*\\)\".*/\1/p" | grep "SHA256SUMS" | head -1)"
if [ -n "${SHA_URL:-}" ]; then
  info "Verifying checksum…"
  SHA_FILE="${TMPDIR}/SHA256SUMS.txt"
  curl_with_retry -fsSL -o "${SHA_FILE}" "${SHA_URL}"
  EXPECTED="$(expected_checksum "${SHA_FILE}" "${FILENAME}")"
  if [ -n "${EXPECTED}" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL="$(sha256sum "${DOWNLOAD_PATH}" | awk '{print $1}')"
    else
      ACTUAL="$(shasum -a 256 "${DOWNLOAD_PATH}" | awk '{print $1}')"
    fi
    if [ "${EXPECTED}" != "${ACTUAL}" ]; then
      rm -f "${DOWNLOAD_PATH}" "${SHA_FILE}"
      error "Checksum mismatch! Expected ${EXPECTED}, got ${ACTUAL}"
    fi
    info "Checksum verified ✓"
  fi
  rm -f "${SHA_FILE}"
fi

# --- Install ---
if [ "${PLATFORM}" = "mac" ]; then
  APPLICATIONS_DIR="${OPENWAGGLE_APPLICATIONS_DIR:-/Applications}"
  mkdir -p "${APPLICATIONS_DIR}"
  # Physical, as running_mac_gui_pids compares bundle paths.
  APPLICATIONS_DIR="$(cd "${APPLICATIONS_DIR}" && pwd -P)"
  info "Mounting DMG and copying to ${APPLICATIONS_DIR}…"
  MOUNT_POINT="$(hdiutil attach -nobrowse -readonly "${DOWNLOAD_PATH}" 2>/dev/null | tail -1 | awk -F'\t' '{print $NF}')"
  APP_PATH="$(find "${MOUNT_POINT}" -maxdepth 1 -name '*.app' | head -1)"
  [ -z "${APP_PATH}" ] && error "No .app bundle found in DMG"
  INSTALLED_APP_PATH="${APPLICATIONS_DIR}/$(basename "${APP_PATH}")"
  # The image decides the bundle name, so check the app it really replaces before quitting it.
  INSTALLED_VERSION="$(mac_app_version "${INSTALLED_APP_PATH}")"
  refuse_downgrade "${INSTALLED_VERSION}" "${VERSION}" "${DOWNGRADE_HINT}"
  # Quit the window first: stopping the Host under an open app would only make it start another.
  quit_running_mac_app "${INSTALLED_APP_PATH}"
  stop_session_host_for_update "${INSTALLED_APP_PATH}/Contents/MacOS/OpenWaggle" \
    "${INSTALLED_VERSION}"
  rm -rf "${INSTALLED_APP_PATH}"
  cp -R "${APP_PATH}" "${APPLICATIONS_DIR}/"
  hdiutil detach "${MOUNT_POINT}" -quiet 2>/dev/null || true
  # Remove the quarantine attribute so the first launch skips the downloaded-app prompt
  xattr -rd com.apple.quarantine "${APPLICATIONS_DIR}/$(basename "${APP_PATH}")" 2>/dev/null || true
  info "Installed to ${APPLICATIONS_DIR}/$(basename "${APP_PATH}")"

  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "${INSTALL_DIR}"
  APP_EXECUTABLE="${APPLICATIONS_DIR}/$(basename "${APP_PATH}")/Contents/MacOS/OpenWaggle"
  INSTALL_PATH="${INSTALL_DIR}/openwaggle"
  ESCAPED_APP_EXECUTABLE="$(printf '%s' "${APP_EXECUTABLE}" | sed "s/'/'\"'\"'/g")"
  SHIM_TEMP_PATH="$(mktemp "${INSTALL_DIR}/.openwaggle-cli.XXXXXX")"
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' "${CLI_SHIM_MARKER}"
    printf 'exec '\''%s'\'' "$@"\n' "${ESCAPED_APP_EXECUTABLE}"
  } > "${SHIM_TEMP_PATH}"
  chmod +x "${SHIM_TEMP_PATH}"
  install_cli_shim_atomically "${SHIM_TEMP_PATH}" "${INSTALL_PATH}" "mac" "${APP_EXECUTABLE}" || \
    error "Could not replace ${INSTALL_PATH} safely; no unrecognized target was overwritten"
  info "Installed CLI to ${INSTALL_DIR}/openwaggle"
  if ! echo "${PATH}" | grep -q "${INSTALL_DIR}"; then
    info "Add ${INSTALL_DIR} to your PATH if not already present"
  fi

elif [ "${PLATFORM}" = "linux" ]; then
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "${INSTALL_DIR}"
  mkdir -p "${APP_DIR}"
  INSTALL_PATH="${INSTALL_DIR}/openwaggle"
  APPIMAGE_PATH="${APP_DIR}/OpenWaggle.AppImage"
  # The AppImage's version, so a later install knows what its CLI supports without running it.
  APPIMAGE_VERSION_PATH="${APP_DIR}/version"
  DESKTOP_DIR="${HOME}/.local/share/applications"
  DESKTOP_PATH="${DESKTOP_DIR}/openwaggle.desktop"
  # An open app keeps running, and keeps its Host, until the user quits it and stops the Host.
  stop_session_host_for_update "${APPIMAGE_PATH}" "${INSTALLED_CLI_VERSION}"
  install_executable_atomically "${DOWNLOAD_PATH}" "${APPIMAGE_PATH}"
  printf '%s\n' "${VERSION#v}" > "${APPIMAGE_VERSION_PATH}"
  ESCAPED_APPIMAGE_PATH="$(printf '%s' "${APPIMAGE_PATH}" | sed "s/'/'\"'\"'/g")"
  SHIM_TEMP_PATH="$(mktemp "${INSTALL_DIR}/.openwaggle-cli.XXXXXX")"
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' "${CLI_SHIM_MARKER}"
    printf 'exec env OPENWAGGLE_CLI_OUTPUT_FD=3 '\''%s'\'' "$@" 3>&1 1>/dev/null\n' "${ESCAPED_APPIMAGE_PATH}"
  } > "${SHIM_TEMP_PATH}"
  chmod +x "${SHIM_TEMP_PATH}"
  install_cli_shim_atomically "${SHIM_TEMP_PATH}" "${INSTALL_PATH}" "linux" "${DESKTOP_PATH}" || \
    error "Could not replace ${INSTALL_PATH} safely; no unrecognized target was overwritten"

  write_linux_desktop_entry "${DESKTOP_DIR}" "${APPIMAGE_PATH}"

  info "Installed app to ${APPIMAGE_PATH}"
  info "Installed CLI to ${INSTALL_PATH}"
  if ! echo "${PATH}" | grep -q "${INSTALL_DIR}"; then
    info "Add ${INSTALL_DIR} to your PATH if not already present"
  fi
fi

persist_selected_channel || error "Could not save the ${CHANNEL} update channel preference."
rm -f "${DOWNLOAD_PATH}"
animate_ready
launch_installed_app
