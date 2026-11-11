# Creates a throwaway self-signed Authenticode certificate for a CI packaging job, never a release
# certificate: valid for two days, trusted on this runner only (the machine's Root and
# TrustedPublisher stores; the user's Root store would ask for confirmation in a dialog), exported to a password-protected PFX in $env:RUNNER_TEMP. Appends the hook
# configuration (scripts/electrobun/hooks-steps.ts) to $env:GITHUB_ENV: OPENWAGGLE_WINDOWS_SIGN_PFX
# and OPENWAGGLE_WINDOWS_SIGN_PASSWORD, without a timestamp server.
$ErrorActionPreference = 'Stop'
$work = Join-Path $env:RUNNER_TEMP 'openwaggle-ci-identity'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$password = [Guid]::NewGuid().ToString('N')
Write-Output "::add-mask::$password"
$certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=OpenWaggle CI Code Signing' `
  -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 3072 `
  -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(2)
$pfx = Join-Path $work 'ci-signing.pfx'
$secure = ConvertTo-SecureString -String $password -Force -AsPlainText
Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password $secure | Out-Null
$cer = Join-Path $work 'ci-signing.cer'
Export-Certificate -Cert $certificate -FilePath $cer | Out-Null
foreach ($store in 'Root', 'TrustedPublisher') {
  Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\$store" | Out-Null
}
Add-Content -Path $env:GITHUB_ENV -Value "OPENWAGGLE_WINDOWS_SIGN_PFX=$pfx"
Add-Content -Path $env:GITHUB_ENV -Value "OPENWAGGLE_WINDOWS_SIGN_PASSWORD=$password"
Write-Output "Throwaway certificate $($certificate.Thumbprint) in $pfx"
