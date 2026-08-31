import {
  LocalSessionFrameDecoder,
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES,
} from './local-session-framing'
import type { LocalSessionInboundByteBudget } from './local-session-resource-policy'

export class LocalSessionInboundCapacityError extends Error {}

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
      this.budget.release(pendingBefore + chunk.byteLength - this.decoder.pendingBytes)
      return values
    } catch (error) {
      this.budget.release(pendingBefore + chunk.byteLength)
      this.decoder.reset()
      throw error
    }
  }

  markAuthenticated() {
    this.decoder.setMaxFrameBytes(MAX_LOCAL_SESSION_FRAME_BYTES)
  }

  release() {
    this.budget.release(this.decoder.pendingBytes)
    this.decoder.reset()
  }
}
