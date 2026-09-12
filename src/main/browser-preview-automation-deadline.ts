import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'

export interface BrowserPreviewAutomationRunOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

function timeoutFor(options: BrowserPreviewAutomationRunOptions) {
  const timeoutMs = options.timeoutMs ?? BROWSER_PREVIEW_AUTOMATION_LIMITS.DEFAULT_TIMEOUT_MS
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > BROWSER_PREVIEW_AUTOMATION_LIMITS.MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `Browser preview timeout must be between 1 and ${String(BROWSER_PREVIEW_AUTOMATION_LIMITS.MAX_TIMEOUT_MS)} ms.`,
    )
  }
  return timeoutMs
}

function cancellationError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Browser preview action was cancelled.')
}

export class BrowserPreviewAutomationDeadline {
  readonly signal: AbortSignal
  readonly deadlineAt: number
  readonly timeoutMs: number

  private readonly controller = new AbortController()
  private readonly upstream?: AbortSignal
  private readonly onUpstreamAbort = () => {
    this.controller.abort(new Error('Browser preview action was cancelled.'))
  }
  private readonly timer: ReturnType<typeof setTimeout>

  constructor(options: BrowserPreviewAutomationRunOptions = {}) {
    this.timeoutMs = timeoutFor(options)
    this.deadlineAt = Date.now() + this.timeoutMs
    this.signal = this.controller.signal
    this.upstream = options.signal
    if (options.signal?.aborted) this.onUpstreamAbort()
    else options.signal?.addEventListener('abort', this.onUpstreamAbort, { once: true })
    this.timer = setTimeout(() => {
      this.controller.abort(
        new Error(`Browser preview action timed out within ${String(this.timeoutMs)} ms.`),
      )
    }, this.timeoutMs)
    this.timer.unref()
  }

  remainingMs() {
    return Math.max(1, this.deadlineAt - Date.now())
  }

  throwIfAborted() {
    if (this.signal.aborted) throw cancellationError(this.signal)
  }

  race<A>(operation: PromiseLike<A>): Promise<A> {
    if (this.signal.aborted) return Promise.reject(cancellationError(this.signal))
    return new Promise<A>((resolve, reject) => {
      let settled = false
      const finish = (settle: () => void) => {
        if (settled) return
        settled = true
        this.signal.removeEventListener('abort', onAbort)
        settle()
      }
      const onAbort = () => finish(() => reject(cancellationError(this.signal)))
      this.signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve(operation).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      )
    })
  }

  dispose() {
    clearTimeout(this.timer)
    this.upstream?.removeEventListener('abort', this.onUpstreamAbort)
  }
}
