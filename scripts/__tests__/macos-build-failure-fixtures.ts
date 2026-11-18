/** Real electron-builder log shapes from failed macOS release builds, shared by the classifier tests. */
// Captured from the 1.0.0-beta.1 release, run 36695614844: the arm64 submission uploaded, then
// the macOS runner lost its network while notarytool waited for Apple's verdict.
export const RUNNER_OFFLINE_LOG = `  • signing         file=dist/mac-arm64/OpenWaggle.app platform=darwin type=distribution
  ⨯ Failed to notarize via notarytool.  Failed with unexpected result:

Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline." UserInfo={_kCFStreamErrorCodeKey=50, _NSURLErrorNWPathKey=unsatisfied (No network route)}, NSErrorFailingURLStringKey=https://appstoreconnect.apple.com/notary/v2/submissions/226731ef-31eb-4d4f-8ab6-f5afa83e7df3?})  failedTask=build
`

export function dmgbuildFailureLog(hdiutilError: string) {
  return `  • notarization successful
  ⨯ /Users/runner/Library/Caches/electron-builder/dmg-builder@1.2.5/dmgbuild-bundle-arm64-75c8a6c-9epj3/dmgbuild process failed 1
Exit code:
1
Output:
Exit code: 1. Command failed: /Users/runner/Library/Caches/electron-builder/dmg-builder@1.2.5/dmgbuild-bundle-arm64-75c8a6c-9epj3/dmgbuild -s /private/var/folders/s6/T/t-iPp4Tm/4.json OpenWaggle 1.0.0-beta.8 /Users/runner/work/OpenWaggle/OpenWaggle/dist/openwaggle-1.0.0-beta.8-x64.dmg
${hdiutilError}
plistlib.InvalidFileException: Invalid file
  failedTask=build stackTrace=Error: dmgbuild process failed 1
`
}

// Run 37285929256: attempts 1 and 3 failed creating the x64 image, attempt 2 attaching arm64.
export const HDIUTIL_CREATE_LOG = dmgbuildFailureLog(
  'hdiutil: create failed - Device not configured',
)
export const HDIUTIL_ATTACH_LOG = dmgbuildFailureLog(
  'hdiutil: attach failed - Device not configured',
)

// Captured from the 1.0.0-beta.36 release, run 42493633669: notarization succeeded, then stapler
// lost its connection to Apple's ticket service (CloudKit) while fetching the ticket.
export const STAPLE_CONNECTION_LOST_LOG = `  • signing         file=dist/mac/OpenWaggle.app platform=darwin type=distribution
  ⨯ Failed to staple your application with code: 68

Processing: /Users/runner/work/OpenWaggle/OpenWaggle/dist/mac/OpenWaggle.app
Domain is api.apple-cloudkit.com
Response is (null)
error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost." UserInfo={_kCFStreamErrorCodeKey=-4, NSErrorFailingURLStringKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup, _kCFStreamErrorDomainKey=4}
Size of data is 0
CloudKit's response is inconsistent with expections: (null)
The staple and validate action failed! Error 68.
  failedTask=build stackTrace=Error: Failed to staple your application with code: 68
`
