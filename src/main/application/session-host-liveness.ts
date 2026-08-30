export const SESSION_HOST_LIVENESS_KINDS = [
  'client',
  'run',
  'follow-up-delivery',
  'semantic-preparation',
  'export',
  'wait',
  'subscription',
  'operation',
] as const

export type SessionHostLivenessKind = (typeof SESSION_HOST_LIVENESS_KINDS)[number]
export type SessionHostDrainReason = 'recovery' | 'upgrade'
const SHUTDOWN_RETRY_DELAY_MS = 250

export interface SessionHostLivenessOptions {
  readonly idleGracePeriodMs: number
  readonly clientHandoffGracePeriodMs?: number
  readonly requestShutdown: () => void | Promise<void>
}

export class SessionHostLiveness {
  private readonly owners = new Map<SessionHostLivenessKind, number>()
  private idleGracePeriodMs: number
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private shutdownRequested = false
  private draining = false
  private activeDrainReason: SessionHostDrainReason | null = null
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
      if (this.draining) this.requestShutdownWhenDrained()
      else if (!this.closed && !this.shutdownRequested && this.totalOwners() === 0) {
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

  private scheduleIdleShutdown(delayMs = this.idleGracePeriodMs) {
    if (this.closed || this.shutdownRequested || this.totalOwners() > 0 || this.idleTimer) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.closed || this.shutdownRequested || this.totalOwners() > 0) return
      this.requestShutdownSafely()
    }, delayMs)
  }

  private hasBlockingDrainOwners() {
    return [...this.owners.entries()].some(
      ([kind, count]) => kind !== 'client' && kind !== 'subscription' && count > 0,
    )
  }

  private requestShutdownWhenDrained() {
    if (this.closed || this.shutdownRequested || !this.draining || this.hasBlockingDrainOwners()) {
      return
    }
    this.requestShutdownSafely()
  }

  acquire(kind: SessionHostLivenessKind): () => void {
    if (
      this.closed ||
      this.shutdownRequested ||
      (this.draining && kind !== 'client' && kind !== 'subscription')
    ) {
      throw new Error('Session Host is no longer accepting liveness owners.')
    }
    this.cancelIdleTimer()
    this.owners.set(kind, (this.owners.get(kind) ?? 0) + 1)
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

  requestDrain(reason: SessionHostDrainReason = 'recovery'): void {
    if (this.closed || this.draining) return
    this.draining = true
    this.activeDrainReason = reason
    this.cancelIdleTimer()
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

  updateIdleGracePeriod(idleGracePeriodMs: number): void {
    this.assertGracePeriod(idleGracePeriodMs)
    this.idleGracePeriodMs = idleGracePeriodMs
    if (this.totalOwners() === 0 && !this.shutdownRequested) {
      this.cancelIdleTimer()
      this.scheduleIdleShutdown()
    }
  }

  ownerCount(kind?: SessionHostLivenessKind): number {
    return kind ? (this.owners.get(kind) ?? 0) : this.totalOwners()
  }

  hasScheduledIdleShutdown(): boolean {
    return this.idleTimer !== null
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.cancelIdleTimer()
    this.owners.clear()
  }
}
