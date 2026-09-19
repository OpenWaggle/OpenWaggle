import type { BrowserPreviewRecord } from './browser-preview-records'
import { createLogger } from './logger'

const INITIAL_RETRY_DELAY_MS = 250
const MAX_RETRY_DELAY_MS = 30_000
const RETRY_BACKOFF = 2
const logger = createLogger('browser-preview-retirement-cleanup')

interface CleanupAttempt {
  delayMs: number
  timer: ReturnType<typeof setTimeout> | null
}

/** Retired renderers cannot be asked to retry; native cleanup belongs to the lifecycle. */
export class BrowserPreviewRetirementCleanup {
  private readonly attempts = new WeakMap<BrowserPreviewRecord, CleanupAttempt>()

  constructor(private readonly close: (record: BrowserPreviewRecord) => Promise<void>) {}

  start(record: BrowserPreviewRecord): void {
    if (this.attempts.has(record)) return
    const attempt: CleanupAttempt = { delayMs: INITIAL_RETRY_DELAY_MS, timer: null }
    this.attempts.set(record, attempt)
    this.run(record, attempt)
  }

  cancel(record: BrowserPreviewRecord): void {
    const attempt = this.attempts.get(record)
    if (!attempt) return
    this.attempts.delete(record)
    if (attempt.timer !== null) clearTimeout(attempt.timer)
  }

  private run(record: BrowserPreviewRecord, attempt: CleanupAttempt) {
    if (this.attempts.get(record) !== attempt) return
    let closing: Promise<void>
    try {
      closing = this.close(record)
    } catch (error) {
      this.retry(record, attempt, error)
      return
    }
    void closing.then(
      () => {
        if (this.attempts.get(record) === attempt) this.cancel(record)
      },
      (error: unknown) => this.retry(record, attempt, error),
    )
  }

  private retry(record: BrowserPreviewRecord, attempt: CleanupAttempt, error: unknown) {
    if (this.attempts.get(record) !== attempt) return
    logger.warn('Retired native preview close failed; retrying cleanup', {
      previewId: record.previewId,
      retryDelayMs: attempt.delayMs,
      error,
    })
    attempt.timer = setTimeout(() => {
      if (this.attempts.get(record) !== attempt) return
      attempt.timer = null
      this.run(record, attempt)
    }, attempt.delayMs)
    attempt.timer.unref()
    attempt.delayMs = Math.min(attempt.delayMs * RETRY_BACKOFF, MAX_RETRY_DELAY_MS)
  }
}
