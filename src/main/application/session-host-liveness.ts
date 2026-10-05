export const SESSION_HOST_LIVENESS_KINDS = [
  'client',
  'run',
  'action-run',
  'follow-up-delivery',
  'semantic-preparation',
  'export',
  'wait',
  'subscription',
  'operation',
] as const

export type SessionHostLivenessKind = (typeof SESSION_HOST_LIVENESS_KINDS)[number]

/**
 * Background maintenance that polls on its own schedule. It holds the Host open while it works but
 * is not activity: the idle grace keeps counting from the last real work, or a poll every few
 * seconds would keep an idle Host alive forever.
 */
const IDLE_CLOCK_NEUTRAL_KINDS: ReadonlySet<SessionHostLivenessKind> = new Set([
  'semantic-preparation',
])
export type SessionHostDrainReason = 'recovery' | 'upgrade' | 'stop'
const SHUTDOWN_RETRY_DELAY_MS = 250

export interface SessionHostDrainOptions {
  /**
   * Stop the Host this long after the drain starts even if work still holds it. Work still running
   * then ends with the Host, as it would if the process were killed.
   */
  readonly deadlineMs?: number
}

export interface SessionHostLivenessOptions {
  readonly idleGracePeriodMs: number
  readonly clientHandoffGracePeriodMs?: number
  readonly requestShutdown: () => void | Promise<void>
}

export class SessionHostLiveness {
  private readonly owners = new Map<SessionHostLivenessKind, number>()
  private idleGracePeriodMs: number
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** When the Host last became idle; `null` while it owns work. */
  private idleSince: number | null = null
  private drainDeadlineAt: number | null = null
  private drainDeadlineTimer: ReturnType<typeof setTimeout> | null = null
  private drainDeadlinePassed = false
  private closed = false
  private shutdownRequested = false
  private draining = false
  private activeDrainReason: SessionHostDrainReason | null = null
  private acceptedClient = false
  private readonly clientHandoffGracePeriodMs: number

  constructor(private readonly options: SessionHostLivenessOptions) {
    this.assertGracePeriod(options.idleGracePeriodMs)
    this.assertGracePeriod(options.clientHandoffGracePeriodMs ?? 0)
    this.idleGracePeriodMs = options.idleGracePeriodMs
    this.clientHandoffGracePeriodMs = options.clientHandoffGracePeriodMs ?? 0
  }

  private assertGracePeriod(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Session Host idle grace period must be a non-negative safe integer.')
    }
  }

  private totalOwners() {
    let total = 0
    for (const count of this.owners.values()) total += count
    return total
  }

  private cancelIdleTimer() {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private shutdownFailed() {
    if (this.closed) return
    this.shutdownRequested = false
    this.cancelIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.draining) {
        this.requestShutdownWhenDrained()
        return
      }
      if (!this.closed && !this.shutdownRequested && this.totalOwners() === 0) {
        this.requestShutdownSafely()
      }
    }, SHUTDOWN_RETRY_DELAY_MS)
  }

  private requestShutdownSafely() {
    this.shutdownRequested = true
    try {
      const result = this.options.requestShutdown()
      void Promise.resolve(result).catch(() => this.shutdownFailed())
    } catch {
      this.shutdownFailed()
    }
  }

  /** Shut down once the Host has been idle for `delayMs`, counting time it is already idle. */
  private scheduleIdleShutdown(delayMs = this.idleGracePeriodMs) {
    if (this.closed || this.shutdownRequested || this.totalOwners() > 0 || this.idleTimer) return
    const now = Date.now()
    const idleForMs = this.idleSince === null ? 0 : now - this.idleSince
    this.idleSince ??= now
    this.idleTimer = setTimeout(
      () => {
        this.idleTimer = null
        if (this.closed || this.shutdownRequested || this.totalOwners() > 0) return
        this.requestShutdownSafely()
      },
      Math.max(0, delayMs - idleForMs),
    )
  }

  private hasBlockingDrainOwners() {
    return [...this.owners.entries()].some(
      ([kind, count]) => kind !== 'client' && kind !== 'subscription' && count > 0,
    )
  }

  private requestShutdownWhenDrained() {
    if (this.closed || this.shutdownRequested || !this.draining) return
    if (this.hasBlockingDrainOwners() && !this.drainDeadlinePassed) return
    this.requestShutdownSafely()
  }

  private armDrainDeadline(deadlineMs: number) {
    this.assertGracePeriod(deadlineMs)
    const deadlineAt = Date.now() + deadlineMs
    // A later stop may shorten a drain, never extend it.
    if (this.drainDeadlineAt !== null && this.drainDeadlineAt <= deadlineAt) return
    this.clearDrainDeadline()
    this.drainDeadlineAt = deadlineAt
    this.drainDeadlineTimer = setTimeout(() => {
      this.drainDeadlineTimer = null
      this.drainDeadlinePassed = true
      this.requestShutdownWhenDrained()
    }, deadlineMs)
  }

  private clearDrainDeadline() {
    if (this.drainDeadlineTimer) clearTimeout(this.drainDeadlineTimer)
    this.drainDeadlineTimer = null
  }

  /**
   * `whileDraining` admits work that helps a drain finish, such as interrupting a Run. It
   * still holds the Host open until it completes, so its response is delivered.
   */
  acquire(kind: SessionHostLivenessKind, options: { readonly whileDraining?: boolean } = {}) {
    const admittedByDrain = kind === 'client' || kind === 'subscription' || options.whileDraining
    if (this.closed || this.shutdownRequested || (this.draining && !admittedByDrain)) {
      throw new Error(
        'The Session Host is stopping and is no longer accepting new work; try again once it has stopped.',
      )
    }
    this.cancelIdleTimer()
    if (!IDLE_CLOCK_NEUTRAL_KINDS.has(kind)) this.idleSince = null
    this.owners.set(kind, (this.owners.get(kind) ?? 0) + 1)
    if (kind === 'client') this.acceptedClient = true
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.owners.get(kind) ?? 0
      if (count <= 1) this.owners.delete(kind)
      else this.owners.set(kind, count - 1)
      if (this.draining) this.requestShutdownWhenDrained()
      else {
        const delay =
          kind === 'client'
            ? Math.max(this.idleGracePeriodMs, this.clientHandoffGracePeriodMs)
            : this.idleGracePeriodMs
        this.scheduleIdleShutdown(delay)
      }
    }
  }

  requestDrain(
    reason: SessionHostDrainReason = 'recovery',
    options: SessionHostDrainOptions = {},
  ): void {
    if (this.closed) return
    if (!this.draining) {
      this.draining = true
      this.activeDrainReason = reason
      this.cancelIdleTimer()
    }
    if (options.deadlineMs !== undefined) this.armDrainDeadline(options.deadlineMs)
    this.requestShutdownWhenDrained()
  }

  isDraining(): boolean {
    return this.draining
  }

  drainReason(): SessionHostDrainReason | null {
    return this.activeDrainReason
  }

  armIdleShutdown(delayMs = this.idleGracePeriodMs): void {
    this.assertGracePeriod(delayMs)
    this.scheduleIdleShutdown(delayMs)
  }

  /**
   * The Host re-reads this setting every second. Only a changed value reschedules an idle Host,
   * and the time it has already been idle counts, so a refresh never postpones the shutdown.
   */
  updateIdleGracePeriod(idleGracePeriodMs: number): void {
    this.assertGracePeriod(idleGracePeriodMs)
    if (idleGracePeriodMs === this.idleGracePeriodMs) return
    this.idleGracePeriodMs = idleGracePeriodMs
    if (this.draining || this.totalOwners() > 0 || this.shutdownRequested) return
    this.cancelIdleTimer()
    this.scheduleIdleShutdown()
  }

  ownerCount(kind?: SessionHostLivenessKind): number {
    return kind ? (this.owners.get(kind) ?? 0) : this.totalOwners()
  }

  hasAcceptedClient(): boolean {
    return this.acceptedClient
  }

  hasScheduledIdleShutdown(): boolean {
    return this.idleTimer !== null
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.cancelIdleTimer()
    this.clearDrainDeadline()
    this.owners.clear()
  }
}
