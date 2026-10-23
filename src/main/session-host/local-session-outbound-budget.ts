import {
  encodeLocalSessionPayload,
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES,
} from './local-session-framing'
import { LocalSessionOutboundTurn } from './local-session-outbound-turn'

export const DEFAULT_MAX_PENDING_OUTBOUND_BYTES_GLOBAL = 256 * 1024 * 1024
/**
 * How long, from its arrival, a frame waits for outbound capacity before connections that left
 * frames unread for that whole time are closed. Capacity is held by frames other clients have not
 * read yet, such as the desktop app parsing a large transcript, which usually takes a second or
 * two. Measured from arrival, a frame queued behind others is decided as soon as one at the head.
 */
export const DEFAULT_OUTBOUND_CAPACITY_WAIT_MS = 4_000
/** How long an evicted connection gets to release its frames before the next one is evicted. */
export const DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS = 500
/**
 * A wait that wakes later than this fraction of the capacity wait is the Host's stall, not the
 * clients': it gets that fraction again of time in which sockets are served.
 */
const LATE_WAKE_FRACTION_DENOMINATOR = 4
/** A Host that keeps stalling still decides. */
const MAX_LATE_EXTENSIONS = 3
const MAX_OUTBOUND_ENCODING_RESERVATION_BYTES =
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES + MAX_LOCAL_SESSION_FRAME_BYTES

export class LocalSessionOutboundCapacityError extends Error {
  constructor() {
    super('The Local Session Host outbound byte budget was reached.')
  }
}

export interface LocalSessionOutboundLease {
  readonly payload: Buffer
  readonly release: () => void
  /** How long the frame waited for room before it was encoded. */
  readonly waitedMs: number
}

/** The connection a frame is written to; it is closed if it leaves its frames unread too long. */
export interface LocalSessionOutboundOwner {
  /** Closes the connection; its frames release their bytes when its socket closes. */
  readonly evict: (unreadForMs: number) => void
}

export interface LocalSessionOutboundByteBudgetOptions {
  readonly capacityWaitMs?: number | undefined
  readonly evictionReleaseWaitMs?: number | undefined
  /** A monotonic clock in milliseconds. */
  readonly now?: () => number
}

interface RetainedLease {
  readonly bytes: number
  readonly retainedAt: number
  readonly owner: LocalSessionOutboundOwner | undefined
}

function encodingAborted() {
  return new Error('Local Session outbound encoding was aborted.')
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Local Session ${name} must be a non-negative safe integer.`)
  }
  return value
}

/** Resolves after the I/O poll, so write completions a Host stall held back run first. */
function afterPendingIo() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

/**
 * Bounds the bytes the Host holds for frames clients have not read yet. Encodes run one at a
 * time in arrival order; one that finds no room waits for room while holding that turn, since no
 * later encode could fit either, so the first frame to wait is the first to be written. When the
 * room stays held for the capacity wait, the connections whose frames were retained before the
 * frame arrived and are still unread are the readers that stopped: they are closed, preferring one
 * that frees enough room alone, instead of the connection that asked for room.
 */
export class LocalSessionOutboundByteBudget {
  private retainedBytes = 0
  private peakRetainedBytes = 0
  private readonly encoderTurn = new LocalSessionOutboundTurn(encodingAborted)
  /** Retained frames, oldest first. */
  private readonly leases = new Set<RetainedLease>()
  private readonly bytesByOwner = new Map<LocalSessionOutboundOwner, number>()
  private readonly evictedOwners = new WeakSet<LocalSessionOutboundOwner>()
  /** The encode holding the turn, waiting for bytes to be released. */
  private releaseWaiter: (() => void) | undefined
  private readonly capacityWaitMs: number
  private readonly evictionReleaseWaitMs: number
  private readonly now: () => number

  constructor(
    private readonly capacity = DEFAULT_MAX_PENDING_OUTBOUND_BYTES_GLOBAL,
    options: LocalSessionOutboundByteBudgetOptions = {},
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < MAX_OUTBOUND_ENCODING_RESERVATION_BYTES) {
      throw new Error(
        `Local Session outbound byte capacity must be at least ${MAX_OUTBOUND_ENCODING_RESERVATION_BYTES} bytes.`,
      )
    }
    this.capacityWaitMs = nonNegativeInteger(
      options.capacityWaitMs ?? DEFAULT_OUTBOUND_CAPACITY_WAIT_MS,
      'outbound capacity wait',
    )
    this.evictionReleaseWaitMs = nonNegativeInteger(
      options.evictionReleaseWaitMs ?? DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS,
      'outbound eviction release wait',
    )
    this.now = options.now ?? (() => performance.now())
  }

  get pendingBytes() {
    return this.retainedBytes
  }

  get peakBytes() {
    return this.peakRetainedBytes
  }

  get maxBytes() {
    return this.capacity
  }

  /**
   * Encodes `value` once the budget has room for it, waiting as the class describes. Fails with
   * `LocalSessionOutboundCapacityError` when no connection that held an unread frame since the
   * frame arrived is left to close.
   */
  async encode(
    value: unknown,
    signal: AbortSignal,
    owner?: LocalSessionOutboundOwner,
  ): Promise<LocalSessionOutboundLease> {
    const arrivedAt = this.now()
    await this.encoderTurn.acquire(signal)
    try {
      await this.waitForRoom(signal, arrivedAt)
      return this.encodeWithReservation(value, signal, owner, this.now() - arrivedAt)
    } finally {
      this.encoderTurn.release()
    }
  }

  private hasRoom() {
    return this.retainedBytes + MAX_OUTBOUND_ENCODING_RESERVATION_BYTES <= this.capacity
  }

  private async waitForRoom(signal: AbortSignal, arrivedAt: number) {
    let deadline = arrivedAt + this.capacityWaitMs
    let lateExtensions = 0
    while (!this.hasRoom()) {
      if (signal.aborted) throw encodingAborted()
      const remainingMs = deadline - this.now()
      if (remainingMs > 0) {
        const lateMs = await this.sleepUntilRelease(signal, remainingMs)
        const grace = this.capacityWaitMs / LATE_WAKE_FRACTION_DENOMINATOR
        if (lateMs > grace && lateExtensions < MAX_LATE_EXTENSIONS) {
          // The Host could not read or write sockets while it stalled: give clients live time.
          lateExtensions += 1
          deadline = Math.max(deadline, this.now() + grace)
        }
        continue
      }
      await afterPendingIo()
      if (signal.aborted) throw encodingAborted()
      if (this.hasRoom()) break
      const stalled = this.stalledOwnerToEvict(arrivedAt)
      if (!stalled) throw new LocalSessionOutboundCapacityError()
      this.evictedOwners.add(stalled.owner)
      stalled.owner.evict(this.now() - stalled.retainedAt)
      await this.waitForOwnerRelease(signal, stalled.owner)
    }
    if (signal.aborted) throw encodingAborted()
  }

  /** Sleeps until a release or `timeoutMs`; returns how much later than due it woke. */
  private async sleepUntilRelease(signal: AbortSignal, timeoutMs: number) {
    const dueAt = this.now() + timeoutMs
    const wokeByRelease = await this.nextRelease(signal, timeoutMs)
    return wokeByRelease ? 0 : Math.max(0, this.now() - dueAt)
  }

  private async waitForOwnerRelease(signal: AbortSignal, owner: LocalSessionOutboundOwner) {
    const releaseBy = this.now() + this.evictionReleaseWaitMs
    while (!this.hasRoom() && (this.bytesByOwner.get(owner) ?? 0) > 0) {
      const remainingMs = releaseBy - this.now()
      if (remainingMs <= 0) return
      await this.nextRelease(signal, remainingMs)
    }
  }

  /**
   * Among connections holding a frame retained before `arrivedAt` and not evicted yet: the oldest
   * whose frames free enough room alone, else the one holding the most bytes.
   */
  private stalledOwnerToEvict(arrivedAt: number) {
    const missingBytes =
      this.retainedBytes + MAX_OUTBOUND_ENCODING_RESERVATION_BYTES - this.capacity
    let largest: { owner: LocalSessionOutboundOwner; retainedAt: number } | undefined
    let largestBytes = 0
    const seen = new Set<LocalSessionOutboundOwner>()
    for (const lease of this.leases) {
      if (lease.retainedAt > arrivedAt) break
      const owner = lease.owner
      if (!owner || seen.has(owner) || this.evictedOwners.has(owner)) continue
      seen.add(owner)
      const bytes = this.bytesByOwner.get(owner) ?? 0
      if (bytes >= missingBytes) return { owner, retainedAt: lease.retainedAt }
      if (bytes > largestBytes) {
        largest = { owner, retainedAt: lease.retainedAt }
        largestBytes = bytes
      }
    }
    return largest
  }

  private encodeWithReservation(
    value: unknown,
    signal: AbortSignal,
    owner: LocalSessionOutboundOwner | undefined,
    waitedMs: number,
  ): LocalSessionOutboundLease {
    this.retainBytes(MAX_OUTBOUND_ENCODING_RESERVATION_BYTES)
    let payload: Buffer
    try {
      payload = encodeLocalSessionPayload(value)
      if (signal.aborted) throw encodingAborted()
    } catch (error) {
      this.releaseBytes(MAX_OUTBOUND_ENCODING_RESERVATION_BYTES)
      throw error
    }
    const retainedLeaseBytes =
      payload.byteLength +
      (payload.byteLength > MAX_LOCAL_SESSION_FRAME_BYTES ? MAX_LOCAL_SESSION_FRAME_BYTES : 0)
    const lease: RetainedLease = { bytes: retainedLeaseBytes, retainedAt: this.now(), owner }
    this.leases.add(lease)
    if (owner) this.bytesByOwner.set(owner, (this.bytesByOwner.get(owner) ?? 0) + lease.bytes)
    this.releaseBytes(MAX_OUTBOUND_ENCODING_RESERVATION_BYTES - retainedLeaseBytes)
    return {
      payload,
      waitedMs,
      release: () => {
        if (!this.leases.delete(lease)) return
        if (owner) {
          const remaining = (this.bytesByOwner.get(owner) ?? 0) - lease.bytes
          if (remaining > 0) this.bytesByOwner.set(owner, remaining)
          else this.bytesByOwner.delete(owner)
        }
        this.releaseBytes(lease.bytes)
      },
    }
  }

  private retainBytes(bytes: number) {
    this.retainedBytes += bytes
    this.peakRetainedBytes = Math.max(this.peakRetainedBytes, this.retainedBytes)
  }

  private releaseBytes(bytes: number) {
    this.retainedBytes = Math.max(0, this.retainedBytes - bytes)
    if (bytes > 0) this.releaseWaiter?.()
  }

  /**
   * Resolves `true` on the next release, `false` after `timeoutMs`; rejects when `signal` aborts.
   * Only the encode holding the turn waits, and it registers in the same tick it saw no room, so
   * no release is missed.
   */
  private nextRelease(signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (this.releaseWaiter === released) this.releaseWaiter = undefined
      }
      const released = () => {
        settle()
        resolve(true)
      }
      const abort = () => {
        settle()
        reject(encodingAborted())
      }
      const timer = setTimeout(() => {
        settle()
        resolve(false)
      }, timeoutMs)
      signal.addEventListener('abort', abort, { once: true })
      this.releaseWaiter = released
    })
  }
}
