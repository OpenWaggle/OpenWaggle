const RECOVERY_MAX_ATTEMPTS = 3
const RECOVERY_INITIAL_DELAY_MS = 250
const RECOVERY_WINDOW_MS = 30_000
const RECOVERY_FINAL_NAVIGATION_GRACE_MS = 250
const RECOVERY_BACKOFF_BASE = 2

interface BrowserPreviewCrashRecoveryOptions {
  readonly isCurrent: () => boolean
  readonly recover: () => void
  readonly onExhausted: () => void
}

export function isRecoverableBrowserPreviewCrash(reason: string) {
  return reason === 'crashed' || reason === 'oom' || reason === 'abnormal-exit'
}

/** Keeps a crashed preview available while bounding automatic reload loops. */
export class BrowserPreviewCrashRecovery {
  private readonly attemptTimestamps: number[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private disposed = false

  constructor(private readonly options: BrowserPreviewCrashRecoveryOptions) {}

  start(): void {
    if (this.disposed || !this.options.isCurrent()) return
    this.clearTimer()
    this.pruneAttempts()
    this.active = true
    if (this.attemptTimestamps.length >= RECOVERY_MAX_ATTEMPTS) {
      this.exhaust()
      return
    }
    this.scheduleAttempt()
  }

  navigationStarted(): void {
    this.cancel()
  }

  cancel(): void {
    this.active = false
    this.clearTimer()
  }

  dispose(): void {
    this.disposed = true
    this.cancel()
  }

  private scheduleAttempt(): void {
    const delay = RECOVERY_INITIAL_DELAY_MS * RECOVERY_BACKOFF_BASE ** this.attemptTimestamps.length
    this.timer = setTimeout(() => {
      this.timer = null
      this.runAttempt()
    }, delay)
    this.timer.unref()
  }

  private runAttempt(): void {
    if (!this.active || this.disposed || !this.options.isCurrent()) {
      this.cancel()
      return
    }
    this.pruneAttempts()
    if (this.attemptTimestamps.length >= RECOVERY_MAX_ATTEMPTS) {
      this.exhaust()
      return
    }
    this.attemptTimestamps.push(Date.now())
    try {
      this.options.recover()
    } catch {
      // A raced reload failure consumes this attempt and advances to the next bounded retry.
    }
    if (!this.active || this.disposed || !this.options.isCurrent()) return
    if (this.attemptTimestamps.length < RECOVERY_MAX_ATTEMPTS) {
      this.scheduleAttempt()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.active && !this.disposed && this.options.isCurrent()) this.exhaust()
    }, RECOVERY_FINAL_NAVIGATION_GRACE_MS)
    this.timer.unref()
  }

  private exhaust(): void {
    this.active = false
    this.clearTimer()
    if (!this.disposed && this.options.isCurrent()) this.options.onExhausted()
  }

  private pruneAttempts(): void {
    const cutoff = Date.now() - RECOVERY_WINDOW_MS
    while ((this.attemptTimestamps[0] ?? Number.POSITIVE_INFINITY) <= cutoff) {
      this.attemptTimestamps.shift()
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
