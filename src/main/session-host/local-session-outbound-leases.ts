import type { LocalSessionHostLiveClock } from './local-session-host-live-clock'

/** The connection a frame is written to; it is closed if it leaves its frames unread too long. */
export interface LocalSessionOutboundOwner {
  /** Closes the connection; its frames release their bytes when its socket closes. */
  readonly evict: (unreadForMs: number) => void
}

export interface RetainedOutboundLease {
  readonly bytes: number
  readonly owner: LocalSessionOutboundOwner | undefined
  /** Live time the client last read part of the frame, or the frame was retained. */
  progressAt: number
}

export interface StalledOutboundOwner {
  readonly owner: LocalSessionOutboundOwner
  readonly unreadForMs: number
}

/**
 * The frames the Host holds for clients, by connection, and which connection has stopped reading
 * them. The live clock runs while any frame is held, so a stall is measured while it happens.
 */
export class LocalSessionOutboundLeases {
  private readonly leases = new Set<RetainedOutboundLease>()
  private readonly bytesByOwner = new Map<LocalSessionOutboundOwner, number>()
  private readonly evictedOwners = new WeakSet<LocalSessionOutboundOwner>()

  constructor(
    private readonly clock: LocalSessionHostLiveClock,
    /** How long a frame stays unread before its connection counts as stopped. */
    private readonly stoppedAfterMs: number,
  ) {}

  add(bytes: number, owner: LocalSessionOutboundOwner | undefined): RetainedOutboundLease {
    const lease: RetainedOutboundLease = { bytes, owner, progressAt: this.clock.now() }
    this.leases.add(lease)
    this.clock.start()
    if (owner) this.bytesByOwner.set(owner, this.bytesHeldBy(owner) + bytes)
    return lease
  }

  /** Whether the lease was still held. */
  remove(lease: RetainedOutboundLease): boolean {
    if (!this.leases.delete(lease)) return false
    if (this.leases.size === 0) this.clock.stop()
    if (lease.owner) {
      const remaining = this.bytesHeldBy(lease.owner) - lease.bytes
      if (remaining > 0) this.bytesByOwner.set(lease.owner, remaining)
      else this.bytesByOwner.delete(lease.owner)
    }
    return true
  }

  touch(lease: RetainedOutboundLease): void {
    lease.progressAt = this.clock.now()
  }

  bytesHeldBy(owner: LocalSessionOutboundOwner): number {
    return this.bytesByOwner.get(owner) ?? 0
  }

  markEvicted(owner: LocalSessionOutboundOwner): void {
    this.evictedOwners.add(owner)
  }

  /**
   * Among connections that left a frame unread for the stop time and were not closed already: the
   * longest stopped one whose frames free `missingBytes` alone, else the one holding the most.
   */
  stalledOwnerToEvict(missingBytes: number): StalledOutboundOwner | undefined {
    const now = this.clock.now()
    const stoppedFor = new Map<LocalSessionOutboundOwner, number>()
    for (const lease of this.leases) {
      const unreadForMs = now - lease.progressAt
      if (unreadForMs < this.stoppedAfterMs || !this.evictable(lease.owner)) continue
      stoppedFor.set(lease.owner, Math.max(stoppedFor.get(lease.owner) ?? 0, unreadForMs))
    }
    let freesEnough: StalledOutboundOwner | undefined
    let largest: (StalledOutboundOwner & { readonly bytes: number }) | undefined
    for (const [owner, unreadForMs] of stoppedFor) {
      const bytes = this.bytesHeldBy(owner)
      if (bytes >= missingBytes && (!freesEnough || unreadForMs > freesEnough.unreadForMs)) {
        freesEnough = { owner, unreadForMs }
      }
      if (!largest || bytes > largest.bytes) largest = { owner, unreadForMs, bytes }
    }
    return freesEnough ?? largest
  }

  /** Live time until some connection's frame has been unread for the stop time; none if no open connection holds one. */
  nextStallInMs(): number | undefined {
    const now = this.clock.now()
    let soonest: number | undefined
    for (const lease of this.leases) {
      if (!this.evictable(lease.owner)) continue
      const inMs = Math.max(1, lease.progressAt + this.stoppedAfterMs - now)
      soonest = soonest === undefined ? inMs : Math.min(soonest, inMs)
    }
    return soonest
  }

  private evictable(
    owner: LocalSessionOutboundOwner | undefined,
  ): owner is LocalSessionOutboundOwner {
    return owner !== undefined && !this.evictedOwners.has(owner)
  }
}
