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

  private readonly clock: LocalSessionHostLiveClock
  /** How long a frame stays unread before its connection counts as stopped. */
  private readonly stoppedAfterMs: number

  constructor(
    clock: LocalSessionHostLiveClock,

    stoppedAfterMs: number,
  ) {
    this.clock = clock
    this.stoppedAfterMs = stoppedAfterMs
  }

  add(bytes: number, owner: LocalSessionOutboundOwner | undefined) {
    const lease: RetainedOutboundLease = { bytes, owner, progressAt: this.clock.now() }
    this.leases.add(lease)
    this.clock.start()
    if (owner) this.bytesByOwner.set(owner, this.bytesHeldBy(owner) + bytes)
    return lease
  }

  /** Whether the lease was still held. */
  remove(lease: RetainedOutboundLease) {
    if (!this.leases.delete(lease)) return false
    if (this.leases.size === 0) this.clock.stop()
    if (lease.owner) {
      const remaining = this.bytesHeldBy(lease.owner) - lease.bytes
      if (remaining > 0) this.bytesByOwner.set(lease.owner, remaining)
      else this.bytesByOwner.delete(lease.owner)
    }
    return true
  }

  touch(lease: RetainedOutboundLease) {
    lease.progressAt = this.clock.now()
  }

  bytesHeldBy(owner: LocalSessionOutboundOwner) {
    return this.bytesByOwner.get(owner) ?? 0
  }

  markEvicted(owner: LocalSessionOutboundOwner) {
    this.evictedOwners.add(owner)
  }

  /**
   * Among connections that left a frame unread for the stop time and were not closed already: the
   * longest stopped one whose frames free `missingBytes` alone, else the one holding the most.
   * None when all of them together could not free that much: closing one would make no room.
   */
  stalledOwnerToEvict(missingBytes: number) {
    const now = this.clock.now()
    const stoppedFor = new Map<LocalSessionOutboundOwner, number>()
    for (const lease of this.leases) {
      const unreadForMs = now - lease.progressAt
      if (unreadForMs < this.stoppedAfterMs || !this.evictable(lease.owner)) continue
      stoppedFor.set(lease.owner, Math.max(stoppedFor.get(lease.owner) ?? 0, unreadForMs))
    }
    let stoppedBytes = 0
    for (const owner of stoppedFor.keys()) stoppedBytes += this.bytesHeldBy(owner)
    if (stoppedBytes < missingBytes) return undefined
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

  /**
   * Live time until a frame of an open connection, still being read, reaches the stop time; none
   * when no such frame is held.
   */
  nextStallInMs() {
    const now = this.clock.now()
    let soonest: number | undefined
    for (const lease of this.leases) {
      if (!this.evictable(lease.owner)) continue
      const inMs = lease.progressAt + this.stoppedAfterMs - now
      if (inMs <= 0) continue
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
