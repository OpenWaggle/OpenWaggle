import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TRANSIENT_HDIUTIL_ERROR, transientMacosBuildFailure } from '../macos-build-failure'

import {
  dmgbuildFailureLog,
  HDIUTIL_ATTACH_LOG,
  HDIUTIL_CREATE_LOG,
  RUNNER_OFFLINE_LOG,
  STAPLE_CONNECTION_LOST_LOG,
} from './macos-build-failure-fixtures'

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

  it('treats stapler losing its connection to Apple after notarization as transient', () => {
    expect(transientMacosBuildFailure(STAPLE_CONNECTION_LOST_LOG)).toBe('staple-connection')
  })

  it('fails fast when stapling fails for a reason a rebuild would not fix', () => {
    expect(
      transientMacosBuildFailure(
        '  ⨯ Failed to staple your application with code: 65\nCould not validate ticket\nThe staple and validate action failed! Error 65.\n  failedTask=build',
      ),
    ).toBeNull()
    expect(
      transientMacosBuildFailure(
        'Error Domain=NSURLErrorDomain Code=-1005 while downloading Electron\n  ⨯ Failed to staple your application with code: 73\n  failedTask=build',
      ),
    ).toBeNull()
  })

  it('fails fast when only one of two staple failures lost the connection', () => {
    expect(
      transientMacosBuildFailure(
        `${STAPLE_CONNECTION_LOST_LOG}  ⨯ Failed to staple your application with code: 65\nCould not validate ticket\n  failedTask=build\n`,
      ),
    ).toBeNull()
  })

  it('fails fast on a notary rejection even when stapling the other architecture lost Apple', () => {
    expect(
      transientMacosBuildFailure(
        `${STAPLE_CONNECTION_LOST_LOG}\n  ⨯ Failed to notarize via notarytool\n  status: Invalid`,
      ),
    ).toBeNull()
  })

  it('treats an hdiutil device error that failed dmgbuild as transient', () => {
    expect(transientMacosBuildFailure(HDIUTIL_CREATE_LOG)).toBe('disk-image-device')
    expect(transientMacosBuildFailure(HDIUTIL_ATTACH_LOG)).toBe('disk-image-device')
    expect(
      transientMacosBuildFailure(dmgbuildFailureLog('hdiutil: create failed - Resource busy')),
    ).toBe('disk-image-device')
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

  it('fails fast on a rejection even when the other architecture hit a device error', () => {
    expect(
      transientMacosBuildFailure(
        `${HDIUTIL_CREATE_LOG}\n  ⨯ Failed to notarize via notarytool\n  status: Invalid`,
      ),
    ).toBeNull()
  })

  it('fails fast on disk-image errors that a rebuild would not fix', () => {
    expect(
      transientMacosBuildFailure(
        dmgbuildFailureLog('hdiutil: create failed - No space left on device'),
      ),
    ).toBeNull()
    expect(
      transientMacosBuildFailure(
        dmgbuildFailureLog('hdiutil: create failed - Operation not permitted'),
      ),
    ).toBeNull()
  })

  it('ignores hdiutil errors that did not fail dmgbuild', () => {
    expect(
      transientMacosBuildFailure(
        '  • hdiutil error: hdiutil: attach failed - Device not configured\n  ⨯ The identity is not valid for code signing  failedTask=build',
      ),
    ).toBeNull()
    expect(
      transientMacosBuildFailure(
        '  ⨯ dmgbuild process failed 1\nhdiutil: create failed - No space left on device\n  failedTask=build\n  • hdiutil: create failed - Device not configured',
      ),
    ).toBeNull()
  })

  it('ignores network errors that did not fail notarization', () => {
    expect(
      transientMacosBuildFailure(
        'Error Domain=NSURLErrorDomain Code=-1009 while downloading Electron\n⨯ cannot find module',
      ),
    ).toBeNull()
    expect(transientMacosBuildFailure('⨯ The identity is not valid for code signing')).toBeNull()
  })
})

describe('dmg-builder transient hdiutil retry patch registration', () => {
  it('registers the patch and retries the same errors the release classifier accepts', () => {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    )
    const patched =
      typeof manifest === 'object' && manifest !== null && 'patchedDependencies' in manifest
        ? manifest.patchedDependencies
        : undefined
    const [registration] = Object.entries(
      typeof patched === 'object' && patched !== null ? patched : {},
    ).filter(([dependency]) => dependency.startsWith('dmg-builder@'))
    expect(registration?.[1]).toBe(`patches/${registration?.[0]}.patch`)
    const patch = fs.readFileSync(path.join(process.cwd(), String(registration?.[1])), 'utf8')
    expect(patch).toContain(`/${TRANSIENT_HDIUTIL_ERROR.source}/;`)
    expect(patch).toContain('+    await execDmgbuildWithRetry(dmgbuild,')
  })
})
