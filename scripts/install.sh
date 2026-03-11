#!/usr/bin/env bash
# OpenWaggle installer — downloads the latest release for your platform.
# Usage: curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh | bash
set -euo pipefail

REPO="OpenWaggle/OpenWaggle"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
READY_MESSAGE="Ready to waggle"
READY_TYPE_DELAY_SECONDS="0.045"
READY_CURSOR_BLINK_DELAY_SECONDS="0.12"
READY_CURSOR_BLINK_CYCLES=2

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
error() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

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
  x86_64|amd64) ARCH_LABEL="x64" ;;
  arm64|aarch64) ARCH_LABEL="arm64" ;;
  *)             error "Unsupported architecture: ${ARCH}" ;;
esac

# --- Fetch latest release info ---
info "Fetching latest release from GitHub…"
RELEASE_JSON="$(curl -fsSL "${API_URL}")" || error "Failed to fetch release info. Is the repo public?"
VERSION="$(printf '%s' "${RELEASE_JSON}" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
info "Latest version: ${VERSION}"

# --- Determine asset name ---
if [ "${PLATFORM}" = "mac" ]; then
  ASSET_PATTERN="openwaggle-.*-${ARCH_LABEL}\\.dmg"
elif [ "${PLATFORM}" = "linux" ]; then
  ASSET_PATTERN="openwaggle-.*-${ARCH_LABEL}\\.AppImage"
fi

ASSET_URL="$(printf '%s' "${RELEASE_JSON}" | grep '"browser_download_url"' | grep -oE "https://[^\"]+" | grep -E "${ASSET_PATTERN}" | head -1)"
[ -z "${ASSET_URL:-}" ] && error "No matching asset found for ${PLATFORM}/${ARCH_LABEL}"

FILENAME="$(basename "${ASSET_URL}")"

# --- Download ---
TMPDIR="${TMPDIR:-/tmp}"
DOWNLOAD_PATH="${TMPDIR}/${FILENAME}"
info "Downloading ${FILENAME}…"
curl -fSL --progress-bar -o "${DOWNLOAD_PATH}" "${ASSET_URL}"

# --- Verify SHA256 if checksum file exists ---
SHA_URL="$(printf '%s' "${RELEASE_JSON}" | grep '"browser_download_url"' | grep -oE "https://[^\"]+" | grep "SHA256SUMS" | head -1)"
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
  info "Mounting DMG and copying to /Applications…"
  MOUNT_POINT="$(hdiutil attach -nobrowse -readonly "${DOWNLOAD_PATH}" 2>/dev/null | tail -1 | awk -F'\t' '{print $NF}')"
  APP_PATH="$(find "${MOUNT_POINT}" -maxdepth 1 -name '*.app' | head -1)"
  [ -z "${APP_PATH}" ] && error "No .app bundle found in DMG"
  rm -rf "/Applications/$(basename "${APP_PATH}")"
  cp -R "${APP_PATH}" /Applications/
  hdiutil detach "${MOUNT_POINT}" -quiet 2>/dev/null || true
  # Remove quarantine for unsigned app
  xattr -rd com.apple.quarantine "/Applications/$(basename "${APP_PATH}")" 2>/dev/null || true
  info "Installed to /Applications/$(basename "${APP_PATH}")"

elif [ "${PLATFORM}" = "linux" ]; then
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "${INSTALL_DIR}"
  INSTALL_PATH="${INSTALL_DIR}/openwaggle"
  cp "${DOWNLOAD_PATH}" "${INSTALL_PATH}"
  chmod +x "${INSTALL_PATH}"

  # Create .desktop entry
  DESKTOP_DIR="${HOME}/.local/share/applications"
  mkdir -p "${DESKTOP_DIR}"
  cat > "${DESKTOP_DIR}/openwaggle.desktop" <<DESKTOP
[Desktop Entry]
Name=OpenWaggle
Comment=Desktop coding agent with multi-model support
Exec=${INSTALL_PATH} %U
Terminal=false
Type=Application
Categories=Development;IDE;
DESKTOP

  info "Installed to ${INSTALL_PATH}"
  if ! echo "${PATH}" | grep -q "${INSTALL_DIR}"; then
    info "Add ${INSTALL_DIR} to your PATH if not already present"
  fi
fi

rm -f "${DOWNLOAD_PATH}"
animate_ready
