import { BROWSER_IMPORT_FAILURE_COPY } from '@shared/types/browser-import'
import { describe, expect, it } from 'vitest'
import {
  BrowserImportError,
  browserImportFailure,
  browserImportFilePermissionReason,
} from '../browser-import-errors'

describe('browser import failure classification', () => {
  it('classifies only macOS Safari EPERM as a Full Disk Access blocker', () => {
    expect(browserImportFilePermissionReason('safari', 'darwin', 'EPERM')).toBe(
      'needs-full-disk-access',
    )
    expect(browserImportFilePermissionReason('safari', 'darwin', 'EACCES')).toBe(
      'permission-denied',
    )
    expect(browserImportFilePermissionReason('chrome', 'darwin', 'EPERM')).toBe('permission-denied')
    expect(browserImportFilePermissionReason('safari', 'linux', 'EPERM')).toBe('permission-denied')
    expect(browserImportFilePermissionReason('safari', 'darwin', 'ENOENT')).toBeUndefined()
  })

  it('returns stable user copy without leaking internal error messages', () => {
    const failure = browserImportFailure(
      new BrowserImportError('needs-keychain-approval', 'secret helper stderr'),
    )

    expect(failure).toEqual({
      reason: 'needs-keychain-approval',
      message: BROWSER_IMPORT_FAILURE_COPY['needs-keychain-approval'],
    })
    expect(JSON.stringify(failure)).not.toContain('secret helper stderr')
  })

  it('maps unknown errors to the bounded read failure', () => {
    expect(browserImportFailure(new Error('sensitive path'))).toEqual({
      reason: 'read-failed',
      message: BROWSER_IMPORT_FAILURE_COPY['read-failed'],
    })
  })
})
