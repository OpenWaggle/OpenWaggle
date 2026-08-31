import type { Socket } from 'node:net'
import type { LocalSessionOutboundByteBudget } from './local-session-outbound-budget'
import { writeLocalSessionSocketFrame } from './local-session-server-frame'

const DEFAULT_MAX_PENDING_OUTBOUND_FRAMES_PER_CONNECTION = 16

export class LocalSessionOutboundWriter {
  private writeTail = Promise.resolve()
  private pendingSends = 0
  private readonly maxPendingFrames: number

  constructor(
    private readonly socket: Socket,
    private readonly budget: LocalSessionOutboundByteBudget,
    private readonly signal: AbortSignal,
    maxPendingFrames = DEFAULT_MAX_PENDING_OUTBOUND_FRAMES_PER_CONNECTION,
  ) {
    if (!Number.isSafeInteger(maxPendingFrames) || maxPendingFrames < 1) {
      throw new Error('Local Session pending outbound frame limit must be a positive safe integer.')
    }
    this.maxPendingFrames = maxPendingFrames
  }

  send(value: unknown): Promise<void> {
    if (this.pendingSends >= this.maxPendingFrames) {
      this.socket.destroy()
      return Promise.reject(new Error('Local Session client is not consuming outbound frames.'))
    }
    this.pendingSends += 1
    const operation = this.writeTail
      .then(() => {
        if (this.signal.aborted || this.socket.destroyed || !this.socket.writable) return
        return writeLocalSessionSocketFrame({
          socket: this.socket,
          value,
          budget: this.budget,
          signal: this.signal,
        })
      })
      .finally(() => {
        this.pendingSends = Math.max(0, this.pendingSends - 1)
      })
    this.writeTail = operation.catch(() => undefined)
    return operation
  }
}
