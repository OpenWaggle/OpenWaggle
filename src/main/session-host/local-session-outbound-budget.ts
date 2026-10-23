import {
  encodeLocalSessionPayload,
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES,
} from './local-session-framing'
import { LocalSessionHostLiveClock } from './local-session-host-live-clock'
import {
  LocalSessionOutboundLeases,
  type LocalSessionOutboundOwner,
} from './local-session-outbound-leases'
import {
  LocalSessionOutboundReleaseSignal,
  LocalSessionOutboundTurn,
} from './local-session-outbound-turn'

export type { LocalSessionOutboundOwner } from './local-session-outbound-leases'

export const DEFAULT_MAX_PENDING_OUTBOUND_BYTES_GLOBAL = 256 * 1024 * 1024
/**
 * How long a frame must stay unread before its connection counts as stopped, and how long a frame
 * that finds no room waits before such connections are closed. Both are live time: time the
 * Host's event loop was blocked, when no socket could be served, is not counted. A reader of a
 * large transcript usually catches up within a second or two.
 */
export const DEFAULT_OUTBOUND_CAPACITY_WAIT_MS = 4_000
/** How long an evicted connection gets to release its frames before the next one is evicted. */
export const DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS = 500
/**
 * The wall-clock limit on any one wait, below the client's 10 s answer timeout, so a Host that
 * keeps stalling still answers or closes before the client gives up.
 */
export const MAX_OUTBOUND_CAPACITY_WAIT_MS = 8_000
const MAX_OUTBOUND_ENCODING_RESERVATION_BYTES =
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES + MAX_LOCAL_SESSION_FRAME_BYTES

export class LocalSessionOutboundCapacityError extends Error {
  constructor() {
    super('The Local Session Host outbound byte budget was reached.')
  }
}

export interface LocalSessionOutboundLease {
  readonly payload: Buffer
  /** Records that the client read part of the frame, so it does not count as stopped. */
  readonly touch: () => void
  readonly release: () => void
  /** How long the frame waited for room before it was encoded. */
  readonly waitedMs: number
}

export interface LocalSessionOutboundByteBudgetOptions {
  readonly capacityWaitMs?: number | undefined
  readonly evictionReleaseWaitMs?: number | undefined
  /** The wall-clock limit on one wait; `MAX_OUTBOUND_CAPACITY_WAIT_MS` unless a test sets it. */
  readonly maxWaitMs?: number | undefined
  /** A monotonic wall clock in milliseconds; stalls are measured against it. */
  readonly now?: () => number
}

export interface LocalSessionOutboundEncodeOptions {
  /**
   * The most bytes the frame may encode to, such as a handshake frame's. A bounded frame that
   * fits is encoded at once, ahead of frames waiting for room, since it reserves only that much.
   */
  readonly maxBytes?: number
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
 * time in arrival order; one that finds no room waits while holding that turn, since no later
 * encode could fit either. After the capacity wait it closes the connections that left a frame
 * unread for that long, preferring one that frees enough room alone, instead of the connection
 * that asked for room; it fails only when no connection holds such a frame or will soon.
 */
export class LocalSessionOutboundByteBudget {
  private retainedBytes = 0
  private peakRetainedBytes = 0
  private readonly encoderTurn = new LocalSessionOutboundTurn(encodingAborted)
  private readonly leases: LocalSessionOutboundLeases
  private readonly released = new LocalSessionOutboundReleaseSignal(encodingAborted)
  private readonly capacityWaitMs: number
  private readonly evictionReleaseWaitMs: number
  private readonly maxWaitMs: number
  private readonly wallNow: () => number
  private readonly clock: LocalSessionHostLiveClock

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
    this.maxWaitMs = nonNegativeInteger(
      options.maxWaitMs ?? MAX_OUTBOUND_CAPACITY_WAIT_MS,
      'outbound capacity wait limit',
    )
    this.wallNow = options.now ?? (() => performance.now())
    this.clock = new LocalSessionHostLiveClock(this.wallNow)
    this.leases = new LocalSessionOutboundLeases(this.clock, this.capacityWaitMs)
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

  async encode(
    value: unknown,
    signal: AbortSignal,
    owner?: LocalSessionOutboundOwner,
    options: LocalSessionOutboundEncodeOptions = {},
  ): Promise<LocalSessionOutboundLease> {
    const arrivedAt = this.wallNow()
    const arrivedLiveAt = this.clock.now()
    if (signal.aborted) throw encodingAborted()
    const bounded =
      options.maxBytes === undefined
        ? undefined
        : this.encodeBounded(value, owner, options.maxBytes)
    if (bounded) return bounded
    await this.encoderTurn.acquire(signal)
    try {
      await this.waitForRoom(signal, arrivedAt, arrivedLiveAt)
      return this.encodeReserved(value, signal, owner, arrivedAt)
    } finally {
      this.encoderTurn.release()
    }
  }

  /** Undefined when the bound does not fit now or the frame encodes to more than it. */
  private encodeBounded(
    value: unknown,
    owner: LocalSessionOutboundOwner | undefined,
    maxBytes: number,
  ) {
    if (maxBytes > MAX_LOCAL_SESSION_FRAME_BYTES) return undefined
    if (this.retainedBytes + maxBytes > this.capacity) return undefined
    this.retainBytes(maxBytes)
    let payload: Buffer
    try {
      payload = encodeLocalSessionPayload(value)
    } catch (error) {
      this.releaseBytes(maxBytes)
      throw error
    }
    if (payload.byteLength > maxBytes) {
      // Larger than its bound: it waits for room like any frame.
      this.releaseBytes(maxBytes)
      return undefined
    }
    return this.leaseFor(payload, owner, maxBytes, this.wallNow())
  }

  private hasRoom() {
    return this.retainedBytes + MAX_OUTBOUND_ENCODING_RESERVATION_BYTES <= this.capacity
  }

  /** Waits up to the capacity wait of live time from arrival, and never past the wall limit. */
  private async waitForRoom(signal: AbortSignal, arrivedAt: number, arrivedLiveAt: number) {
    const giveUpAt = arrivedAt + this.maxWaitMs
    const decideAt = arrivedLiveAt + this.capacityWaitMs
    while (!this.hasRoom()) {
      if (signal.aborted) throw encodingAborted()
      const wallRemainingMs = giveUpAt - this.wallNow()
      if (wallRemainingMs <= 0) throw new LocalSessionOutboundCapacityError()
      const liveRemainingMs = decideAt - this.clock.now()
      if (liveRemainingMs > 0) {
        await this.released.wait(signal, Math.min(liveRemainingMs, wallRemainingMs))
        continue
      }
      await afterPendingIo()
      if (signal.aborted) throw encodingAborted()
      if (this.hasRoom()) break
      const stalled = this.leases.stalledOwnerToEvict(
        this.retainedBytes + MAX_OUTBOUND_ENCODING_RESERVATION_BYTES - this.capacity,
      )
      if (stalled) {
        this.leases.markEvicted(stalled.owner)
        stalled.owner.evict(stalled.unreadForMs)
        await this.waitForOwnerRelease(signal, stalled.owner, giveUpAt)
        continue
      }
      const nextStallInMs = this.leases.nextStallInMs()
      // Only frames of connections already closed, or of no connection, hold the room.
      if (nextStallInMs === undefined) throw new LocalSessionOutboundCapacityError()
      await this.released.wait(signal, Math.min(nextStallInMs, wallRemainingMs))
    }
    if (signal.aborted) throw encodingAborted()
  }

  private async waitForOwnerRelease(
    signal: AbortSignal,
    owner: LocalSessionOutboundOwner,
    giveUpAt: number,
  ) {
    const releaseBy = this.clock.now() + this.evictionReleaseWaitMs
    while (!this.hasRoom() && this.leases.bytesHeldBy(owner) > 0) {
      const remainingMs = Math.min(releaseBy - this.clock.now(), giveUpAt - this.wallNow())
      if (remainingMs <= 0) return
      await this.released.wait(signal, remainingMs)
    }
  }

  private encodeReserved(
    value: unknown,
    signal: AbortSignal,
    owner: LocalSessionOutboundOwner | undefined,
    arrivedAt: number,
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
    return this.leaseFor(payload, owner, MAX_OUTBOUND_ENCODING_RESERVATION_BYTES, arrivedAt)
  }

  /** Turns the reservation an encoded payload was made under into its lease's retained bytes. */
  private leaseFor(
    payload: Buffer,
    owner: LocalSessionOutboundOwner | undefined,
    reservationBytes: number,
    arrivedAt: number,
  ): LocalSessionOutboundLease {
    const bytes =
      payload.byteLength +
      (payload.byteLength > MAX_LOCAL_SESSION_FRAME_BYTES ? MAX_LOCAL_SESSION_FRAME_BYTES : 0)
    const lease = this.leases.add(bytes, owner)
    this.releaseBytes(reservationBytes - bytes)
    return {
      payload,
      waitedMs: this.wallNow() - arrivedAt,
      touch: () => this.leases.touch(lease),
      release: () => {
        if (this.leases.remove(lease)) this.releaseBytes(lease.bytes)
      },
    }
  }

  private retainBytes(bytes: number) {
    this.retainedBytes += bytes
    this.peakRetainedBytes = Math.max(this.peakRetainedBytes, this.retainedBytes)
  }

  private releaseBytes(bytes: number) {
    this.retainedBytes = Math.max(0, this.retainedBytes - bytes)
    if (bytes > 0) this.released.notify()
  }
}
