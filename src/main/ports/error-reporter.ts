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
  /**
   * Reports the error events of an envelope a renderer's SDK serialized, after this process's
   * scrubbing and Usage statistics check. Absent where renderers report another way (Electron's
   * SDK bridge). Never throws.
   */
  readonly captureRendererEnvelope?: (envelope: string) => void
  /** Waits up to `timeoutMs` for pending reports, before the process exits. */
  readonly flush: (timeoutMs: number) => Promise<void>
}
