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
/** How long Runs interrupted at a drain deadline get to settle before the Host stops anyway. */
export const SESSION_HOST_DRAIN_DEADLINE_SETTLE_MS = 3_000

export interface SessionHostDrainOptions {
  /**
   * End the drain this long after it starts even if work still holds the Host. Runs are then
   * interrupted through normal cancellation and get a short settle; anything left, such as a
   * running Action, ends with the Host.
   */
  readonly deadlineMs?: number
}

export interface SessionHostLivenessOptions {
  readonly idleGracePeriodMs: number
  readonly clientHandoffGracePeriodMs?: number
  readonly requestShutdown: () => void | Promise<void>
  /** Interrupts active Runs when a drain reaches its deadline, so they end as interrupted. */
  readonly interruptRunsAtDrainDeadline?: () => void | Promise<void>
  readonly drainDeadlineSettleMs?: number
}

function nonNegativeSafeInteger(value: number, description: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Session Host ${description} must be a non-negative safe integer.`)
  }
}

export class SessionHostLiveness {
  private readonly owners = new Map<SessionHostLivenessKind, number>()
  private idleGracePeriodMs: number
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** When the Host last became idle; `null` while it owns work. */
  private idleSince: number | null = null
  /** The earliest idle shutdown whatever the grace, set by the startup grace. */
  private startupFloorAt: number | null = null
  /** The earliest idle shutdown after the last client left, so it can reconnect. */
  private handoffFloorAt: number | null = null
  private drainDeadlineAt: number | null = null
  /** The drain deadline, then the Run settle after it. */
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private drainRetryTimer: ReturnType<typeof setTimeout> | null = null
  /** Past the deadline: Runs were interrupted and get the settle, nothing else holds the Host. */
  private drainDeadlineReached = false
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
    nonNegativeSafeInteger(value, 'idle grace period')
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

  private setDrainTimer(delayMs: number, callback: () => void) {
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null
      callback()
    }, delayMs)
  }

  private shutdownFailed() {
    if (this.closed) return
    this.shutdownRequested = false
    // A drain retries on its own timer, so a client that connects meanwhile cannot cancel it.
    if (this.draining) {
      if (this.drainRetryTimer) clearTimeout(this.drainRetryTimer)
      this.drainRetryTimer = setTimeout(() => {
        this.drainRetryTimer = null
        this.requestShutdownWhenDrained()
      }, SHUTDOWN_RETRY_DELAY_MS)
      return
    }
    this.cancelIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
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

  private static raised(floorAt: number | null, delayMs: number) {
    const next = Date.now() + delayMs
    return Math.max(floorAt ?? next, next)
  }

  /** Shut down once the Host has been idle for the grace period, and not before the floor. */
  private scheduleIdleShutdown() {
    if (this.closed || this.shutdownRequested || this.draining || this.totalOwners() > 0) return
    this.cancelIdleTimer()
    const now = Date.now()
    this.idleSince ??= now
    const shutdownAt = Math.max(
      this.startupFloorAt ?? 0,
      this.handoffFloorAt ?? 0,
      this.idleSince + this.idleGracePeriodMs,
    )
    this.idleTimer = setTimeout(
      () => {
        this.idleTimer = null
        if (this.closed || this.shutdownRequested || this.totalOwners() > 0) return
        this.requestShutdownSafely()
      },
      Math.max(0, shutdownAt - now),
    )
  }

  private hasActivityOwners() {
    return [...this.owners.entries()].some(
      ([kind, count]) => !IDLE_CLOCK_NEUTRAL_KINDS.has(kind) && count > 0,
    )
  }

  private hasBlockingDrainOwners() {
    return [...this.owners.entries()].some(
      ([kind, count]) => kind !== 'client' && kind !== 'subscription' && count > 0,
    )
  }

  private hasRunOwners() {
    return this.ownerCount('run') > 0 || this.ownerCount('follow-up-delivery') > 0
  }

  private requestShutdownWhenDrained() {
    if (this.closed || this.shutdownRequested || !this.draining) return
    const deadlineEndsDrain =
      this.drainDeadlinePassed || (this.drainDeadlineReached && !this.hasRunOwners())
    if (this.hasBlockingDrainOwners() && !deadlineEndsDrain) return
    this.requestShutdownSafely()
  }

  private armDrainDeadline(deadlineMs: number) {
    const deadlineAt = Date.now() + deadlineMs
    // A later stop may shorten a drain, never extend it.
    if (this.drainDeadlineAt !== null && this.drainDeadlineAt <= deadlineAt) return
    this.drainDeadlineAt = deadlineAt
    this.setDrainTimer(deadlineMs, () => this.reachDrainDeadline())
  }

  private reachDrainDeadline() {
    this.drainDeadlineReached = true
    if (!this.hasRunOwners()) {
      this.requestShutdownWhenDrained()
      return
    }
    // Interrupted Runs end as interrupted and release the Host; the settle bounds the rest.
    const settleMs = this.options.drainDeadlineSettleMs ?? SESSION_HOST_DRAIN_DEADLINE_SETTLE_MS
    this.setDrainTimer(settleMs, () => {
      this.drainDeadlinePassed = true
      this.requestShutdownWhenDrained()
    })
    try {
      void Promise.resolve(this.options.interruptRunsAtDrainDeadline?.()).catch(() => undefined)
    } catch {
      // The settle timer still ends the drain.
    }
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
    if (!IDLE_CLOCK_NEUTRAL_KINDS.has(kind)) {
      this.idleSince = null
      this.startupFloorAt = null
      this.handoffFloorAt = null
    }
    this.owners.set(kind, (this.owners.get(kind) ?? 0) + 1)
    if (kind === 'client') this.acceptedClient = true
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.owners.get(kind) ?? 0
      if (count <= 1) this.owners.delete(kind)
      else this.owners.set(kind, count - 1)
      // The Host is idle from the end of its last real work, even if background work outlasts it.
      if (!IDLE_CLOCK_NEUTRAL_KINDS.has(kind) && !this.hasActivityOwners()) {
        this.idleSince ??= Date.now()
        if (kind === 'client') {
          this.handoffFloorAt = SessionHostLiveness.raised(
            this.handoffFloorAt,
            this.clientHandoffGracePeriodMs,
          )
        }
      }
      if (this.draining) this.requestShutdownWhenDrained()
      else this.scheduleIdleShutdown()
    }
  }

  requestDrain(
    reason: SessionHostDrainReason = 'recovery',
    options: SessionHostDrainOptions = {},
  ): void {
    if (options.deadlineMs !== undefined)
      nonNegativeSafeInteger(options.deadlineMs, 'drain deadline')
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

  /** Shut down once idle for the grace period, and not before `delayMs` from now. */
  armIdleShutdown(delayMs = this.idleGracePeriodMs): void {
    this.assertGracePeriod(delayMs)
    // Recorded even while background work runs, so its end does not skip the startup grace.
    this.startupFloorAt = SessionHostLiveness.raised(this.startupFloorAt, delayMs)
    if (!this.hasActivityOwners()) this.idleSince ??= Date.now()
    this.scheduleIdleShutdown()
  }

  /**
   * The Host re-reads this setting every second. Only a changed value reschedules an idle Host.
   * The time it has already been idle counts, and the new value replaces the startup grace; a
   * client that just left keeps its handoff grace.
   */
  updateIdleGracePeriod(idleGracePeriodMs: number): void {
    this.assertGracePeriod(idleGracePeriodMs)
    if (idleGracePeriodMs === this.idleGracePeriodMs) return
    this.idleGracePeriodMs = idleGracePeriodMs
    if (this.draining || this.totalOwners() > 0 || this.shutdownRequested) return
    this.startupFloorAt = null
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
    if (this.drainTimer) clearTimeout(this.drainTimer)
    if (this.drainRetryTimer) clearTimeout(this.drainRetryTimer)
    this.drainTimer = null
    this.drainRetryTimer = null
    this.owners.clear()
  }
}
