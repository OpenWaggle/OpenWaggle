import type { ErrorReportOrigin } from '@shared/error-reporting/error-report-constants'

export type { ErrorReportOrigin }

/**
 * Error reporting port (ADR 0045). Reports leave the machine only while Usage statistics are on,
 * and only after scrubbing. An error keeps its message text only when reported with the
 * `application` origin, which a call site may pass only when its messages cannot hold user
 * content; every other error is reported by its type and code.
 */
export interface ErrorReporter {
  /** Reports an error the app caught. Never throws. */
  readonly captureException: (error: unknown, origin?: ErrorReportOrigin) => void
  /** Waits up to `timeoutMs` for pending reports, before the process exits. */
  readonly flush: (timeoutMs: number) => Promise<void>
}
