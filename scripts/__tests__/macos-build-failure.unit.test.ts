import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { transientMacosBuildFailure } from '../macos-build-failure'

// Captured from the 1.0.0-beta.1 release, run 36695614844: the arm64 submission uploaded, then
// the macOS runner lost its network while notarytool waited for Apple's verdict.
const RUNNER_OFFLINE_LOG = `  • signing         file=dist/mac-arm64/OpenWaggle.app platform=darwin type=distribution
  ⨯ Failed to notarize via notarytool.  Failed with unexpected result:

Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline." UserInfo={_kCFStreamErrorCodeKey=50, _NSURLErrorNWPathKey=unsatisfied (No network route)}, NSErrorFailingURLStringKey=https://appstoreconnect.apple.com/notary/v2/submissions/226731ef-31eb-4d4f-8ab6-f5afa83e7df3?})  failedTask=build
`

// Captured from the 1.0.0-beta.8 release, run 37285929256: both apps notarized, then dmgbuild
// could not create the x64 disk image on the runner.
const HDIUTIL_DEVICE_LOG = `  • notarization successful
  ⨯ /Users/runner/Library/Caches/electron-builder/dmg-builder@1.2.5/dmgbuild-bundle-arm64-75c8a6c-9epj3/dmgbuild process failed 1
Exit code: 1. Command failed: /Users/runner/Library/Caches/electron-builder/dmg-builder@1.2.5/dmgbuild-bundle-arm64-75c8a6c-9epj3/dmgbuild -s /private/var/folders/s6/T/t-iPp4Tm/4.json OpenWaggle 1.0.0-beta.8 /Users/runner/work/OpenWaggle/OpenWaggle/dist/openwaggle-1.0.0-beta.8-x64.dmg
hdiutil: create failed - Device not configured
plistlib.InvalidFileException: Invalid file
`

describe('macOS build failure classification', () => {
  it('treats notarytool losing its connection to Apple as transient', () => {
    expect(transientMacosBuildFailure(RUNNER_OFFLINE_LOG)).toBe('notarization-connection')
  })

  it('treats a timed-out request and an Apple-side 5xx as transient', () => {
    expect(
      transientMacosBuildFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."',
      ),
    ).toBe('notarization-connection')
    expect(
      transientMacosBuildFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: 503, error: Service Unavailable)',
      ),
    ).toBe('notarization-connection')
  })

  it('treats an hdiutil device error while building the DMG as transient', () => {
    expect(transientMacosBuildFailure(HDIUTIL_DEVICE_LOG)).toBe('disk-image-device')
    expect(transientMacosBuildFailure('hdiutil: detach failed - Resource busy')).toBe(
      'disk-image-device',
    )
  })

  it('fails fast when Apple rejects the submission or the credentials', () => {
    expect(
      transientMacosBuildFailure(
        'Failed to notarize via notarytool\n  status: Invalid\n  message: Processing complete',
      ),
    ).toBeNull()
    expect(
      transientMacosBuildFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: 401, error: Unauthorized)',
      ),
    ).toBeNull()
  })

  it('fails fast on disk-image errors that a rebuild would not fix', () => {
    expect(transientMacosBuildFailure('hdiutil: create failed - No space left on device')).toBeNull()
    expect(transientMacosBuildFailure('hdiutil: create failed - Operation not permitted')).toBeNull()
  })

  it('ignores network errors that did not fail notarization', () => {
    expect(
      transientMacosBuildFailure(
        'Error Domain=NSURLErrorDomain Code=-1009 while downloading Electron\n⨯ cannot find module',
      ),
    ).toBeNull()
    expect(transientMacosBuildFailure('⨯ The identity is not valid for code signing')).toBeNull()
  })

  it('keeps the dmg-builder patch that retries only transient hdiutil failures', () => {
    const workspace = fs.readFileSync(path.join(process.cwd(), 'pnpm-workspace.yaml'), 'utf8')
    const registration = /^ {2}dmg-builder@([\d.]+): patches\/dmg-builder@\1\.patch$/mu.exec(
      workspace,
    )
    expect(registration).not.toBeNull()
    const patch = fs.readFileSync(
      path.join(process.cwd(), `patches/dmg-builder@${registration?.[1]}.patch`),
      'utf8',
    )
    expect(patch).toContain('+async function execDmgbuildWithRetry(')
    expect(patch).toContain('Device not configured|Resource busy')
    expect(patch).toContain('+    await execDmgbuildWithRetry(dmgbuild,')
  })
})
