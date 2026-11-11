#!/usr/bin/env bash
# Creates a throwaway self-signed code-signing identity for a CI packaging job, never a release
# identity: a new keychain in $RUNNER_TEMP, the certificate trusted for code signing on this runner
# only, valid for two days. Appends the hook configuration (scripts/electrobun/hooks-steps.ts) to
# $GITHUB_ENV: OPENWAGGLE_MACOS_SIGN_IDENTITY, OPENWAGGLE_MACOS_SIGN_KEYCHAIN and
# OPENWAGGLE_MACOS_SIGN_TIMESTAMP=0 (Apple's timestamp service only counter-signs Apple-issued
# certificates). The keychain is also made the default one, so what the app stores there during the
# job stays out of the runner's login keychain.
set -euo pipefail
work="${RUNNER_TEMP:?}/openwaggle-ci-identity"
mkdir -p "$work"
keychain="$work/ci.keychain-db"
password="$(openssl rand -hex 16)"
p12_password="$(openssl rand -hex 16)"
cat > "$work/cert.cnf" <<'CNF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = OpenWaggle CI Code Signing
OU = OWCITEAM01
O = OpenWaggle CI
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -config "$work/cert.cnf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" >/dev/null 2>&1
openssl pkcs12 -export -legacy -inkey "$work/key.pem" -in "$work/cert.pem" \
  -out "$work/identity.p12" -passout "pass:$p12_password" >/dev/null 2>&1 ||
  openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" \
    -out "$work/identity.p12" -passout "pass:$p12_password"
rm -f "$work/key.pem"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$work/identity.p12" -k "$keychain" -P "$p12_password" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
security default-keychain -d user -s "$keychain"
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$work/cert.pem"
identity="$(security find-identity -v -p codesigning "$keychain" | awk '/OpenWaggle CI Code Signing/ {print $2; exit}')"
[ -n "$identity" ] || { security find-identity -p codesigning "$keychain"; echo "no valid identity" >&2; exit 1; }
{
  echo "OPENWAGGLE_MACOS_SIGN_IDENTITY=$identity"
  echo "OPENWAGGLE_MACOS_SIGN_KEYCHAIN=$keychain"
  echo "OPENWAGGLE_MACOS_SIGN_TIMESTAMP=0"
} >> "${GITHUB_ENV:?}"
echo "Throwaway identity $identity in $keychain"
