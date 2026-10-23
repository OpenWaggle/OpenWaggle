/**
 * Ticks this far apart while frames are retained; a later tick means the event loop was blocked.
 * A frame is retained only while it is written, so the ticker rarely runs for long.
 */
const DEFAULT_TICK_MS = 25
/** Timer jitter that is not counted as a stall; blocks shorter than tick plus this are missed. */
const DEFAULT_TOLERANCE_MS = 25

/**
 * Wall time minus the time the Host's event loop was blocked, which is time in which no socket
 * could be read or written and so is no client's fault. A ticker runs only while it is started;
 * a gap between ticks longer than the tick plus a tolerance is a stall. A stall that has not been
 * ticked yet is subtracted as well, so the clock reads the same whichever callback runs first
 * when the loop resumes.
 */
export class LocalSessionHostLiveClock {
  private stalledMs = 0
  private lastTickAt = 0
  private ticker: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly wallNow: () => number,
    private readonly tickMs = DEFAULT_TICK_MS,
    private readonly toleranceMs = DEFAULT_TOLERANCE_MS,
  ) {}

  now(): number {
    const at = this.wallNow()
    return at - this.stalledMs - (this.ticker ? this.stallSinceTick(at) : 0)
  }

  start(): void {
    if (this.ticker) return
    this.lastTickAt = this.wallNow()
    this.ticker = setInterval(() => this.tick(), this.tickMs)
    this.ticker.unref?.()
  }

  stop(): void {
    if (!this.ticker) return
    this.tick()
    clearInterval(this.ticker)
    this.ticker = undefined
  }

  private tick() {
    const at = this.wallNow()
    this.stalledMs += this.stallSinceTick(at)
    this.lastTickAt = at
  }

  private stallSinceTick(at: number) {
    return Math.max(0, at - this.lastTickAt - this.tickMs - this.toleranceMs)
  }
}
