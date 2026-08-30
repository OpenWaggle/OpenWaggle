const FRAME_HEADER_BYTES = 4
const RETAINED_CHUNK_COMPACTION_THRESHOLD = 1_024
const COMPACTION_HEAD_FRACTION_DENOMINATOR = 2
export const MAX_LOCAL_SESSION_FRAME_BYTES = 8 * 1024 * 1024
export const MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES = 64 * 1024

export function encodeLocalSessionFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8')
  if (payload.byteLength > MAX_LOCAL_SESSION_FRAME_BYTES) {
    throw new Error(`Local Session frame exceeds ${MAX_LOCAL_SESSION_FRAME_BYTES} bytes.`)
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.byteLength)
  frame.writeUInt32BE(payload.byteLength, 0)
  payload.copy(frame, FRAME_HEADER_BYTES)
  return frame
}

export class LocalSessionFrameDecoder {
  private readonly chunks: Buffer[] = []
  private headIndex = 0
  private headOffset = 0
  private retainedBytes = 0

  constructor(private maxFrameBytes = MAX_LOCAL_SESSION_FRAME_BYTES) {}

  get pendingBytes() {
    return this.retainedBytes
  }

  setMaxFrameBytes(maxFrameBytes: number) {
    this.maxFrameBytes = maxFrameBytes
  }

  reset() {
    this.chunks.length = 0
    this.headIndex = 0
    this.headOffset = 0
    this.retainedBytes = 0
  }

  private copyPending(target: Buffer, bytes: number) {
    let targetOffset = 0
    for (let index = this.headIndex; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index]
      if (!chunk) continue
      const sourceOffset = index === this.headIndex ? this.headOffset : 0
      const available = chunk.byteLength - sourceOffset
      const copying = Math.min(bytes - targetOffset, available)
      chunk.copy(target, targetOffset, sourceOffset, sourceOffset + copying)
      targetOffset += copying
      if (targetOffset === bytes) break
    }
  }

  private consume(bytes: number) {
    let remaining = bytes
    while (remaining > 0) {
      const head = this.chunks[this.headIndex]
      if (!head) throw new Error('Local Session frame decoder underflow.')
      const available = head.byteLength - this.headOffset
      if (remaining < available) {
        this.headOffset += remaining
        this.retainedBytes -= remaining
        return
      }
      remaining -= available
      this.retainedBytes -= available
      this.headIndex += 1
      this.headOffset = 0
    }
  }

  private compactHead() {
    if (this.headIndex === this.chunks.length) {
      this.chunks.length = 0
      this.headIndex = 0
      this.headOffset = 0
      return
    }
    if (
      this.headIndex > RETAINED_CHUNK_COMPACTION_THRESHOLD &&
      this.headIndex * COMPACTION_HEAD_FRACTION_DENOMINATOR > this.chunks.length
    ) {
      this.chunks.splice(0, this.headIndex)
      this.headIndex = 0
    }
    if (this.headOffset === 0) return
    const head = this.chunks[this.headIndex]
    if (!head) {
      this.headOffset = 0
      return
    }
    this.chunks[this.headIndex] = Buffer.from(head.subarray(this.headOffset))
    this.headOffset = 0
  }

  push(chunk: Buffer, maxFrames = Number.POSITIVE_INFINITY): unknown[] {
    if (
      !(
        maxFrames === Number.POSITIVE_INFINITY ||
        (Number.isSafeInteger(maxFrames) && maxFrames > 0)
      )
    ) {
      throw new Error('Local Session frame decode limit must be a positive safe integer.')
    }
    if (chunk.byteLength > 0) {
      this.chunks.push(chunk)
      this.retainedBytes += chunk.byteLength
    }
    const values: unknown[] = []
    const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES)
    while (this.retainedBytes >= FRAME_HEADER_BYTES) {
      this.copyPending(header, FRAME_HEADER_BYTES)
      const payloadBytes = header.readUInt32BE(0)
      if (payloadBytes > this.maxFrameBytes) {
        throw new Error(`Local Session frame exceeds ${this.maxFrameBytes} bytes.`)
      }
      const frameBytes = FRAME_HEADER_BYTES + payloadBytes
      if (this.retainedBytes < frameBytes) break
      if (values.length >= maxFrames) {
        throw new Error(`Local Session chunk exceeds ${String(maxFrames)} decoded frames.`)
      }
      this.consume(FRAME_HEADER_BYTES)
      const payload = Buffer.allocUnsafe(payloadBytes)
      this.copyPending(payload, payloadBytes)
      this.consume(payloadBytes)
      const value: unknown = JSON.parse(payload.toString('utf8'))
      values.push(value)
    }
    this.compactHead()
    return values
  }
}
