import { describe, expect, it } from 'vitest'
import { isTransientNotarizationFailure } from '../notarization-failure'

// Captured from the 1.0.0-beta.1 release, run 36695614844: the arm64 submission uploaded, then
// the macOS runner lost its network while notarytool waited for Apple's verdict.
const RUNNER_OFFLINE_LOG = `  • signing         file=dist/mac-arm64/OpenWaggle.app platform=darwin type=distribution
  ⨯ Failed to notarize via notarytool.  Failed with unexpected result:

Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline." UserInfo={_kCFStreamErrorCodeKey=50, _NSURLErrorNWPathKey=unsatisfied (No network route)}, NSErrorFailingURLStringKey=https://appstoreconnect.apple.com/notary/v2/submissions/226731ef-31eb-4d4f-8ab6-f5afa83e7df3?})  failedTask=build
`

describe('notarization failure classification', () => {
  it('treats notarytool losing its connection to Apple as transient', () => {
    expect(isTransientNotarizationFailure(RUNNER_OFFLINE_LOG)).toBe(true)
  })

  it('treats a timed-out request and an Apple-side 5xx as transient', () => {
    expect(
      isTransientNotarizationFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."',
      ),
    ).toBe(true)
    expect(
      isTransientNotarizationFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: 503, error: Service Unavailable)',
      ),
    ).toBe(true)
  })

  it('fails fast when Apple rejects the submission or the credentials', () => {
    expect(
      isTransientNotarizationFailure(
        'Failed to notarize via notarytool\n  status: Invalid\n  message: Processing complete',
      ),
    ).toBe(false)
    expect(
      isTransientNotarizationFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: 401, error: Unauthorized)',
      ),
    ).toBe(false)
  })

  it('ignores network errors that did not fail notarization', () => {
    expect(
      isTransientNotarizationFailure(
        'Error Domain=NSURLErrorDomain Code=-1009 while downloading Electron\n⨯ cannot find module',
      ),
    ).toBe(false)
    expect(isTransientNotarizationFailure('⨯ The identity is not valid for code signing')).toBe(false)
  })
})
