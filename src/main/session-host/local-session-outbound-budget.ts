import {
  encodeLocalSessionPayload,
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES,
} from './local-session-framing'

export const DEFAULT_MAX_PENDING_OUTBOUND_BYTES_GLOBAL = 256 * 1024 * 1024
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

export class LocalSessionOutboundByteBudget {
  private retainedBytes = 0
  private peakRetainedBytes = 0
  private encoding = false
  private readonly encodingWaiters: EncodingWaiter[] = []

  constructor(private readonly capacity = DEFAULT_MAX_PENDING_OUTBOUND_BYTES_GLOBAL) {
    if (!Number.isSafeInteger(capacity) || capacity < MAX_OUTBOUND_ENCODING_RESERVATION_BYTES) {
      throw new Error(
        `Local Session outbound byte capacity must be at least ${MAX_OUTBOUND_ENCODING_RESERVATION_BYTES} bytes.`,
      )
    }
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

  async encode(value: unknown, signal: AbortSignal): Promise<LocalSessionOutboundLease> {
    await this.acquireEncoder(signal)
    let reservedForEncoding = false
    try {
      if (signal.aborted) throw new Error('Local Session outbound encoding was aborted.')
      if (this.retainedBytes + MAX_OUTBOUND_ENCODING_RESERVATION_BYTES > this.capacity) {
        throw new LocalSessionOutboundCapacityError()
      }
      this.retainedBytes += MAX_OUTBOUND_ENCODING_RESERVATION_BYTES
      this.peakRetainedBytes = Math.max(this.peakRetainedBytes, this.retainedBytes)
      reservedForEncoding = true
      const payload = encodeLocalSessionPayload(value)
      if (signal.aborted) throw new Error('Local Session outbound encoding was aborted.')
      const retainedLeaseBytes =
        payload.byteLength +
        (payload.byteLength > MAX_LOCAL_SESSION_FRAME_BYTES ? MAX_LOCAL_SESSION_FRAME_BYTES : 0)
      this.retainedBytes -= MAX_OUTBOUND_ENCODING_RESERVATION_BYTES - retainedLeaseBytes
      reservedForEncoding = false
      let released = false
      return {
        payload,
        release: () => {
          if (released) return
          released = true
          this.retainedBytes = Math.max(0, this.retainedBytes - retainedLeaseBytes)
        },
      }
    } catch (error) {
      if (reservedForEncoding) {
        this.retainedBytes = Math.max(
          0,
          this.retainedBytes - MAX_OUTBOUND_ENCODING_RESERVATION_BYTES,
        )
      }
      throw error
    } finally {
      this.releaseEncoder()
    }
  }

  private acquireEncoder(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new Error('Local Session outbound encoding was aborted.'))
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
          reject(new Error('Local Session outbound encoding was aborted.'))
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
