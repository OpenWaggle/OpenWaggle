import {
  encodeLocalSessionPayload,
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES,
} from './local-session-framing'

export const DEFAULT_MAX_PENDING_OUTBOUND_BYTES_GLOBAL = 256 * 1024 * 1024
/**
 * How long a frame waits for outbound capacity before the connection that left a frame unread
 * the longest is closed. Capacity is held by frames other clients have not read yet, such as the
 * desktop app parsing a large transcript, which usually takes a second or two. The wait plus the
 * eviction release waits stays below the client's handshake and response timeouts, so the Host
 * decides before the client gives up.
 */
export const DEFAULT_OUTBOUND_CAPACITY_WAIT_MS = 4_000
/** How long an evicted connection gets to release its frames before the next one is evicted. */
export const DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS = 500
const MAX_OUTBOUND_ENCODING_RESERVATION_BYTES =
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES + MAX_LOCAL_SESSION_FRAME_BYTES

export class LocalSessionOutboundCapacityError extends Error {
  constructor() {
    super('The Local Session Host outbound byte budget was reached.')
  }
}

interface EncodingWaiter {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
  readonly abort: () => void
}

export interface LocalSessionOutboundLease {
  readonly payload: Buffer
  readonly release: () => void
}

/** The connection a frame is written to; it is closed if it leaves the frame unread too long. */
export interface LocalSessionOutboundOwner {
  /** Closes the connection; its frames release their bytes when its socket closes. */
  readonly evict: (unreadForMs: number) => void
}

export interface LocalSessionOutboundByteBudgetOptions {
  readonly capacityWaitMs?: number | undefined
  readonly evictionReleaseWaitMs?: number | undefined
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

/**
 * Bounds the bytes the Host holds for frames clients have not read yet. Encodes run one at a
 * time in arrival order; one that finds no room waits for room while holding that turn, since no
 * later encode could fit either, so the first frame to wait is the first to be written. When the
 * room stays held for the capacity wait, the frames that have stayed unread longer than that are
 * the readers that stopped: their connections are closed, oldest first, instead of the one that
 * asked for room.
 */
export class LocalSessionOutboundByteBudget {
  private retainedBytes = 0
  private peakRetainedBytes = 0
  private encoding = false
  private readonly encodingWaiters: EncodingWaiter[] = []
  /** Retained frames, oldest first. */
  private readonly leases = new Set<RetainedLease>()
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
    this.now = options.now ?? Date.now
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
   * `LocalSessionOutboundCapacityError` only when no frame has stayed unread for the whole wait.
   */
  async encode(
    value: unknown,
    signal: AbortSignal,
    owner?: LocalSessionOutboundOwner,
  ): Promise<LocalSessionOutboundLease> {
    await this.acquireEncoder(signal)
    try {
      await this.waitForRoom(signal)
      return this.encodeWithReservation(value, signal, owner)
    } finally {
      this.releaseEncoder()
    }
  }

  private hasRoom() {
    return this.retainedBytes + MAX_OUTBOUND_ENCODING_RESERVATION_BYTES <= this.capacity
  }

  private async waitForRoom(signal: AbortSignal) {
    const startedAt = this.now()
    const deadline = startedAt + this.capacityWaitMs
    while (!this.hasRoom()) {
      if (signal.aborted) throw encodingAborted()
      const remainingMs = deadline - this.now()
      if (remainingMs > 0) {
        await this.nextRelease(signal, remainingMs)
        continue
      }
      const stalled = this.oldestEvictableLeaseBefore(startedAt)
      if (!stalled?.owner) throw new LocalSessionOutboundCapacityError()
      this.evictedOwners.add(stalled.owner)
      stalled.owner.evict(this.now() - stalled.retainedAt)
      // An owner may release its frames during evict(), before a release could be awaited.
      if (!this.hasRoom()) await this.nextRelease(signal, this.evictionReleaseWaitMs)
    }
    if (signal.aborted) throw encodingAborted()
  }

  /** The oldest frame retained before `time` whose connection has not been evicted yet. */
  private oldestEvictableLeaseBefore(time: number) {
    for (const lease of this.leases) {
      if (lease.retainedAt > time) return undefined
      if (lease.owner && !this.evictedOwners.has(lease.owner)) return lease
    }
    return undefined
  }

  private encodeWithReservation(
    value: unknown,
    signal: AbortSignal,
    owner: LocalSessionOutboundOwner | undefined,
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
    this.releaseBytes(MAX_OUTBOUND_ENCODING_RESERVATION_BYTES - retainedLeaseBytes)
    const lease: RetainedLease = {
      bytes: retainedLeaseBytes,
      retainedAt: this.now(),
      owner,
    }
    this.leases.add(lease)
    return {
      payload,
      release: () => {
        if (!this.leases.delete(lease)) return
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

  /** Resolves on the next release or after `timeoutMs`; rejects when `signal` aborts. */
  private nextRelease(signal: AbortSignal, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (this.releaseWaiter === wake) this.releaseWaiter = undefined
      }
      const wake = () => {
        settle()
        resolve()
      }
      const abort = () => {
        settle()
        reject(encodingAborted())
      }
      const timer = setTimeout(wake, timeoutMs)
      signal.addEventListener('abort', abort, { once: true })
      this.releaseWaiter = wake
    })
  }

  private acquireEncoder(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(encodingAborted())
    }
    if (!this.encoding) {
      this.encoding = true
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const waiter: EncodingWaiter = {
        signal,
        resolve: () => {
          signal.removeEventListener('abort', waiter.abort)
          this.encoding = true
          resolve()
        },
        reject,
        abort: () => {
          const index = this.encodingWaiters.indexOf(waiter)
          if (index !== -1) this.encodingWaiters.splice(index, 1)
          reject(encodingAborted())
        },
      }
      signal.addEventListener('abort', waiter.abort, { once: true })
      this.encodingWaiters.push(waiter)
    })
  }

  private releaseEncoder(): void {
    this.encoding = false
    while (this.encodingWaiters.length > 0) {
      const waiter = this.encodingWaiters.shift()
      if (!waiter || waiter.signal.aborted) continue
      waiter.resolve()
      return
    }
  }
}
