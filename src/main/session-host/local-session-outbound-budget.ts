import {
  encodeLocalSessionPayload,
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES,
} from './local-session-framing'

export const DEFAULT_MAX_PENDING_OUTBOUND_BYTES_GLOBAL = 256 * 1024 * 1024
/**
 * How long a frame waits for outbound capacity before its connection is dropped. Capacity is held
 * by frames other clients have not read yet, such as the desktop app parsing a large transcript;
 * that usually takes a few seconds, so a full budget delays the next frame instead of closing an
 * unrelated connection at once.
 */
export const DEFAULT_OUTBOUND_CAPACITY_WAIT_MS = 10_000
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

export interface LocalSessionOutboundByteBudgetOptions {
  readonly capacityWaitMs?: number | undefined
}

function encodingAborted() {
  return new Error('Local Session outbound encoding was aborted.')
}

export class LocalSessionOutboundByteBudget {
  private retainedBytes = 0
  private peakRetainedBytes = 0
  private encoding = false
  private readonly encodingWaiters: EncodingWaiter[] = []
  private readonly capacityWaiters = new Set<() => void>()
  private readonly capacityWaitMs: number

  constructor(
    private readonly capacity = DEFAULT_MAX_PENDING_OUTBOUND_BYTES_GLOBAL,
    options: LocalSessionOutboundByteBudgetOptions = {},
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < MAX_OUTBOUND_ENCODING_RESERVATION_BYTES) {
      throw new Error(
        `Local Session outbound byte capacity must be at least ${MAX_OUTBOUND_ENCODING_RESERVATION_BYTES} bytes.`,
      )
    }
    const capacityWaitMs = options.capacityWaitMs ?? DEFAULT_OUTBOUND_CAPACITY_WAIT_MS
    if (!Number.isSafeInteger(capacityWaitMs) || capacityWaitMs < 0) {
      throw new Error('Local Session outbound capacity wait must be a non-negative safe integer.')
    }
    this.capacityWaitMs = capacityWaitMs
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
   * Encodes `value` once the budget has room for it. While frames other clients have not read
   * hold the room, it waits for them to be written, up to the capacity wait; only then does it
   * fail with `LocalSessionOutboundCapacityError`.
   */
  async encode(value: unknown, signal: AbortSignal): Promise<LocalSessionOutboundLease> {
    const deadline = Date.now() + this.capacityWaitMs
    let lease = await this.encodeIfCapacity(value, signal)
    while (!lease) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw new LocalSessionOutboundCapacityError()
      await this.waitForCapacity(signal, remainingMs)
      lease = await this.encodeIfCapacity(value, signal)
    }
    return lease
  }

  private async encodeIfCapacity(
    value: unknown,
    signal: AbortSignal,
  ): Promise<LocalSessionOutboundLease | undefined> {
    await this.acquireEncoder(signal)
    let reservedForEncoding = false
    try {
      if (signal.aborted) throw encodingAborted()
      if (this.retainedBytes + MAX_OUTBOUND_ENCODING_RESERVATION_BYTES > this.capacity) return
      this.retainedBytes += MAX_OUTBOUND_ENCODING_RESERVATION_BYTES
      this.peakRetainedBytes = Math.max(this.peakRetainedBytes, this.retainedBytes)
      reservedForEncoding = true
      const payload = encodeLocalSessionPayload(value)
      if (signal.aborted) throw encodingAborted()
      const retainedLeaseBytes =
        payload.byteLength +
        (payload.byteLength > MAX_LOCAL_SESSION_FRAME_BYTES ? MAX_LOCAL_SESSION_FRAME_BYTES : 0)
      this.releaseBytes(MAX_OUTBOUND_ENCODING_RESERVATION_BYTES - retainedLeaseBytes)
      reservedForEncoding = false
      let released = false
      return {
        payload,
        release: () => {
          if (released) return
          released = true
          this.releaseBytes(retainedLeaseBytes)
        },
      }
    } catch (error) {
      if (reservedForEncoding) this.releaseBytes(MAX_OUTBOUND_ENCODING_RESERVATION_BYTES)
      throw error
    } finally {
      this.releaseEncoder()
    }
  }

  private releaseBytes(bytes: number) {
    this.retainedBytes = Math.max(0, this.retainedBytes - bytes)
    if (bytes <= 0) return
    const waiters = [...this.capacityWaiters]
    this.capacityWaiters.clear()
    for (const wake of waiters) wake()
  }

  /** Resolves when retained bytes are released or `timeoutMs` passes; rejects on abort. */
  private waitForCapacity(signal: AbortSignal, timeoutMs: number): Promise<void> {
    if (signal.aborted) return Promise.reject(encodingAborted())
    return new Promise((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.capacityWaiters.delete(wake)
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
      this.capacityWaiters.add(wake)
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
