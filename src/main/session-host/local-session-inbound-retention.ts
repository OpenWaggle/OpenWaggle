import {
  LocalSessionFrameDecoder,
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES,
} from './local-session-framing'
import type { LocalSessionInboundByteBudget } from './local-session-resource-policy'

export class LocalSessionInboundCapacityError extends Error {}

export interface LocalSessionInboundBatch {
  readonly values: readonly unknown[]
  readonly release: () => void
}

interface LocalSessionInboundLease {
  readonly bytes: number
  active: boolean
}

export class LocalSessionInboundRetention {
  private readonly decoder = new LocalSessionFrameDecoder(MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES)

  constructor(private readonly budget: LocalSessionInboundByteBudget) {}

  push(chunk: Buffer, maxFrames?: number) {
    if (!this.budget.reserve(chunk.byteLength)) {
      throw new LocalSessionInboundCapacityError(
        'The Local Session Host inbound byte budget was exceeded.',
      )
    }
    const pendingBefore = this.decoder.pendingBytes
    try {
      const values = this.decoder.push(chunk, maxFrames)
      const consumedBytes = pendingBefore + chunk.byteLength - this.decoder.pendingBytes
      const lease = { bytes: consumedBytes, active: consumedBytes > 0 }
      return {
        values,
        release: () => this.releaseLease(lease),
      } satisfies LocalSessionInboundBatch
    } catch (error) {
      this.budget.release(pendingBefore + chunk.byteLength)
      this.decoder.reset()
      throw error
    }
  }

  markAuthenticated() {
    this.decoder.setMaxFrameBytes(MAX_LOCAL_SESSION_FRAME_BYTES)
  }

  releasePendingFrame() {
    this.budget.release(this.decoder.pendingBytes)
    this.decoder.reset()
  }

  private releaseLease(lease: LocalSessionInboundLease) {
    if (!lease.active) return
    lease.active = false
    this.budget.release(lease.bytes)
  }
}
