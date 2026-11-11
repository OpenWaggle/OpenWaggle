#!/usr/bin/env bash
# Imports the release's Developer ID Application identity (MACOS_CERTIFICATE_P12_BASE64 and
# MACOS_CERTIFICATE_PASSWORD, the secrets electron-builder used) into a temporary keychain that only
# this job sees, and appends the hook configuration (scripts/electrobun/hooks-steps.ts) to
# $GITHUB_ENV: OPENWAGGLE_MACOS_SIGN_IDENTITY and OPENWAGGLE_MACOS_SIGN_KEYCHAIN. Without the secrets
# it does nothing, so the build is signed ad hoc (Alpha and Beta without signing configured).
set -euo pipefail
if [ -z "${MACOS_CERTIFICATE_P12_BASE64:-}" ] || [ -z "${MACOS_CERTIFICATE_PASSWORD:-}" ]; then
  echo "macOS signing is not configured; the app is signed ad hoc."
  exit 0
fi
work="${RUNNER_TEMP:?}/openwaggle-release-identity"
mkdir -p "$work"
keychain="$work/release.keychain-db"
password="$(openssl rand -hex 16)"
echo "::add-mask::$password"
printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | base64 --decode > "$work/identity.p12"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$work/identity.p12" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
rm -f "$work/identity.p12"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
identity="$(security find-identity -v -p codesigning "$keychain" | awk '/Developer ID Application/ {print $2; exit}')"
[ -n "$identity" ] || { echo "No Developer ID Application identity in the certificate." >&2; exit 1; }
{
  echo "OPENWAGGLE_MACOS_SIGN_IDENTITY=$identity"
  echo "OPENWAGGLE_MACOS_SIGN_KEYCHAIN=$keychain"
} >> "${GITHUB_ENV:?}"
