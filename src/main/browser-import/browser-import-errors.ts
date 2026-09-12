import {
  BROWSER_IMPORT_FAILURE_COPY,
  type BrowserImportFailureReason,
  type BrowserImportSourceId,
  type BrowserImportUnavailableReason,
} from '@shared/types/browser-import'

export class BrowserImportError extends Error {
  readonly reason: BrowserImportFailureReason
  override readonly cause?: unknown

  constructor(reason: BrowserImportFailureReason, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'BrowserImportError'
    this.reason = reason
    this.cause = cause
  }
}

export function browserImportError(
  cause: unknown,
  fallbackReason: BrowserImportFailureReason,
  message: string,
) {
  return cause instanceof BrowserImportError
    ? cause
    : new BrowserImportError(fallbackReason, message, cause)
}

export function browserImportFailure(cause: unknown): {
  readonly reason: BrowserImportFailureReason
  readonly message: string
} {
  if (cause instanceof BrowserImportError) {
    return { reason: cause.reason, message: BROWSER_IMPORT_FAILURE_COPY[cause.reason] }
  }
  return {
    reason: 'read-failed',
    message: BROWSER_IMPORT_FAILURE_COPY['read-failed'],
  }
}

export function browserImportFilePermissionReason(
  sourceId: BrowserImportSourceId,
  platform: NodeJS.Platform,
  errorCode: unknown,
): BrowserImportUnavailableReason | undefined {
  if (errorCode !== 'EACCES' && errorCode !== 'EPERM') return undefined
  if (sourceId === 'safari' && platform === 'darwin' && errorCode === 'EPERM') {
    return 'needs-full-disk-access'
  }
  return 'permission-denied'
}
