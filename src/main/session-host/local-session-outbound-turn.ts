interface TurnWaiter {
  readonly resolve: () => void
  readonly signal: AbortSignal
  readonly abort: () => void
}

/** One holder at a time, granted in arrival order; a waiter whose signal aborts leaves the line. */
export class LocalSessionOutboundTurn {
  private held = false
  private readonly waiters: TurnWaiter[] = []

  constructor(private readonly aborted: () => Error) {}

  acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(this.aborted())
    if (!this.held) {
      this.held = true
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const waiter: TurnWaiter = {
        signal,
        resolve: () => {
          signal.removeEventListener('abort', waiter.abort)
          this.held = true
          resolve()
        },
        abort: () => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          reject(this.aborted())
        },
      }
      signal.addEventListener('abort', waiter.abort, { once: true })
      this.waiters.push(waiter)
    })
  }

  release(): void {
    this.held = false
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      if (!waiter || waiter.signal.aborted) continue
      waiter.resolve()
      return
    }
  }
}
