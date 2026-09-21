#!/usr/bin/env bash
# OpenWaggle installer — downloads the latest release for your platform.
# Usage: curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh | bash
set -euo pipefail

DEFAULT_REPO="OpenWaggle/OpenWaggle"
REPO="${OPENWAGGLE_INSTALL_REPO:-${DEFAULT_REPO}}"
RELEASE_TAG="${OPENWAGGLE_RELEASE_TAG:-}"
REQUESTED_CHANNEL="${OPENWAGGLE_CHANNEL:-}"
RELEASES_API_URL="${OPENWAGGLE_RELEASES_API_URL:-https://api.github.com/repos/${REPO}/releases}"
RELEASE_API_URL="${OPENWAGGLE_RELEASE_API_URL:-}"
READY_MESSAGE="Ready to waggle"
READY_TYPE_DELAY_SECONDS="0.045"
READY_CURSOR_BLINK_DELAY_SECONDS="0.12"
READY_CURSOR_BLINK_CYCLES=2

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
error() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# BEGIN TESTABLE RELEASE RESOLUTION
extract_release_tags() {
  printf '%s' "$1" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | \
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
    page_json="$(curl -fsSL "$(release_page_url "${base_url}" "${page}")")" || return 1
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
    beta) printf '%s\n' "${tag}" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$' ;;
    alpha) printf '%s\n' "${tag}" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?$' ;;
    *) return 1 ;;
  esac
}

release_tag_is_supported() {
  printf '%s\n' "$1" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$'
}

resolve_default_channel() {
  local releases_json="$1"
  local tag
  while IFS= read -r tag; do
    if release_matches_channel "${tag}" stable; then
      printf '%s\n' stable
      return 0
    fi
  done < <(extract_release_tags "${releases_json}")
  printf '%s\n' alpha
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
# END TESTABLE RELEASE RESOLUTION

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

# --- Resolve and fetch release info ---
info "Fetching release metadata…"
if [ -n "${RELEASE_API_URL}" ]; then
  RELEASE_JSON="$(curl -fsSL "${RELEASE_API_URL}")" || error "Failed to fetch release info. Is the repo public?"
elif [ -n "${RELEASE_TAG}" ]; then
  case "${RELEASE_TAG}" in
    v*) ;;
    *) RELEASE_TAG="v${RELEASE_TAG}" ;;
  esac
  release_tag_is_supported "${RELEASE_TAG}" || error "Invalid release version: ${RELEASE_TAG}"
  RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}")" || \
    error "Failed to fetch release ${RELEASE_TAG}."
else
  case "${REQUESTED_CHANNEL}" in
    ''|stable|beta|alpha) ;;
    *) error "Invalid channel '${REQUESTED_CHANNEL}'. Use stable, beta, or alpha." ;;
  esac
  RELEASES_JSON="$(fetch_release_pages "${RELEASES_API_URL}")" || \
    error "Failed to list releases. Is the repo public?"
  CHANNEL="${REQUESTED_CHANNEL:-$(resolve_default_channel "${RELEASES_JSON}")}"
  RELEASE_TAG="$(resolve_release_tag "${RELEASES_JSON}" "${CHANNEL}")" || \
    error "No ${CHANNEL} release is available."
  info "Update channel: ${CHANNEL}"
  RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}")" || \
    error "Failed to fetch release ${RELEASE_TAG}."
fi
VERSION="$(printf '%s' "${RELEASE_JSON}" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
[ -z "${VERSION:-}" ] && error "Release metadata did not include a version."
info "Resolved version: ${VERSION}"

# --- Determine asset name ---
if [ "${PLATFORM}" = "mac" ]; then
  ASSET_PATTERN="openwaggle-.*-${ARCH_LABEL}\\.dmg"
elif [ "${PLATFORM}" = "linux" ]; then
  ASSET_PATTERN="openwaggle-.*-${ARCH_LABEL}\\.AppImage"
fi

ASSET_URL="$(printf '%s' "${RELEASE_JSON}" | grep '"browser_download_url"' | sed -n "s/.*\"browser_download_url\": *\"\([^\"]*\\)\".*/\1/p" | grep -E "${ASSET_PATTERN}" | head -1)"
[ -z "${ASSET_URL:-}" ] && error "No matching asset found for ${PLATFORM}/${ARCH_LABEL}"

FILENAME="$(basename "${ASSET_URL}")"

# --- Download ---
TMPDIR="${TMPDIR:-/tmp}"
DOWNLOAD_PATH="${TMPDIR}/${FILENAME}"
info "Downloading ${FILENAME}…"
curl -fSL --progress-bar -o "${DOWNLOAD_PATH}" "${ASSET_URL}"

# --- Verify SHA256 if checksum file exists ---
SHA_URL="$(printf '%s' "${RELEASE_JSON}" | grep '"browser_download_url"' | sed -n "s/.*\"browser_download_url\": *\"\([^\"]*\\)\".*/\1/p" | grep "SHA256SUMS" | head -1)"
if [ -n "${SHA_URL:-}" ]; then
  info "Verifying checksum…"
  SHA_FILE="${TMPDIR}/SHA256SUMS.txt"
  curl -fsSL -o "${SHA_FILE}" "${SHA_URL}"
  EXPECTED="$(grep "${FILENAME}" "${SHA_FILE}" | awk '{print $1}')"
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
  info "Mounting DMG and copying to ${APPLICATIONS_DIR}…"
  MOUNT_POINT="$(hdiutil attach -nobrowse -readonly "${DOWNLOAD_PATH}" 2>/dev/null | tail -1 | awk -F'\t' '{print $NF}')"
  APP_PATH="$(find "${MOUNT_POINT}" -maxdepth 1 -name '*.app' | head -1)"
  [ -z "${APP_PATH}" ] && error "No .app bundle found in DMG"
  mkdir -p "${APPLICATIONS_DIR}"
  rm -rf "${APPLICATIONS_DIR}/$(basename "${APP_PATH}")"
  cp -R "${APP_PATH}" "${APPLICATIONS_DIR}/"
  hdiutil detach "${MOUNT_POINT}" -quiet 2>/dev/null || true
  # Remove quarantine for unsigned app
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
  APP_DIR="${HOME}/.local/lib/openwaggle"
  mkdir -p "${INSTALL_DIR}"
  mkdir -p "${APP_DIR}"
  INSTALL_PATH="${INSTALL_DIR}/openwaggle"
  APPIMAGE_PATH="${APP_DIR}/OpenWaggle.AppImage"
  DESKTOP_DIR="${HOME}/.local/share/applications"
  DESKTOP_PATH="${DESKTOP_DIR}/openwaggle.desktop"
  install_executable_atomically "${DOWNLOAD_PATH}" "${APPIMAGE_PATH}"
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

  # Create .desktop entry
  mkdir -p "${DESKTOP_DIR}"
  cat > "${DESKTOP_PATH}" <<DESKTOP
[Desktop Entry]
Name=OpenWaggle
Comment=Desktop coding agent with multi-model support
Exec=${APPIMAGE_PATH} %U
Terminal=false
Type=Application
Categories=Development;IDE;
DESKTOP

  info "Installed app to ${APPIMAGE_PATH}"
  info "Installed CLI to ${INSTALL_PATH}"
  if ! echo "${PATH}" | grep -q "${INSTALL_DIR}"; then
    info "Add ${INSTALL_DIR} to your PATH if not already present"
  fi
fi

rm -f "${DOWNLOAD_PATH}"
animate_ready
