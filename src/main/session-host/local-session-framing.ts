import { randomUUID } from 'node:crypto'

const FRAME_HEADER_BYTES = 4
const RETAINED_CHUNK_COMPACTION_THRESHOLD = 1_024
const COMPACTION_HEAD_FRACTION_DENOMINATOR = 2
const LOGICAL_CHUNK_PAYLOAD_BYTES = 5 * 1024 * 1024
const LOGICAL_CHUNK_KEY = '__openwaggleLocalSessionChunkV1'
const LOGICAL_CHUNK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MIN_LOGICAL_CHUNKS = 2
const MAX_ACTIVE_LOGICAL_MESSAGES = 4
export const MAX_LOCAL_SESSION_FRAME_BYTES = 8 * 1024 * 1024
export const MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES = 64 * 1024 * 1024
export const MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES = 64 * 1024
const MAX_LOGICAL_CHUNKS = Math.ceil(
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES / LOGICAL_CHUNK_PAYLOAD_BYTES,
)

function encodePhysicalFrame(payload: Buffer): Buffer {
  if (payload.byteLength > MAX_LOCAL_SESSION_FRAME_BYTES) {
    throw new Error(`Local Session frame exceeds ${MAX_LOCAL_SESSION_FRAME_BYTES} bytes.`)
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.byteLength)
  frame.writeUInt32BE(payload.byteLength, 0)
  payload.copy(frame, FRAME_HEADER_BYTES)
  return frame
}

function chunkEnvelope(input: {
  readonly id: string
  readonly index: number
  readonly total: number
  readonly payload: Buffer
}) {
  return Buffer.from(
    JSON.stringify({
      [LOGICAL_CHUNK_KEY]: {
        id: input.id,
        index: input.index,
        total: input.total,
        payload: input.payload.toString('base64'),
      },
    }),
    'utf8',
  )
}

export function encodeLocalSessionFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8')
  if (payload.byteLength <= MAX_LOCAL_SESSION_FRAME_BYTES) return encodePhysicalFrame(payload)
  if (payload.byteLength > MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES) {
    throw new Error(
      `Local Session logical message exceeds ${MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES} bytes.`,
    )
  }
  const id = randomUUID()
  const total = Math.ceil(payload.byteLength / LOGICAL_CHUNK_PAYLOAD_BYTES)
  const frames: Buffer[] = []
  for (let index = 0; index < total; index += 1) {
    const offset = index * LOGICAL_CHUNK_PAYLOAD_BYTES
    frames.push(
      encodePhysicalFrame(
        chunkEnvelope({
          id,
          index,
          total,
          payload: payload.subarray(offset, offset + LOGICAL_CHUNK_PAYLOAD_BYTES),
        }),
      ),
    )
  }
  return Buffer.concat(frames)
}

interface LogicalChunkState {
  readonly total: number
  readonly chunks: Map<number, Buffer>
  bytes: number
}

interface LogicalChunk {
  readonly id: string
  readonly index: number
  readonly total: number
  readonly payload: Buffer
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeChunkEnvelope(value: unknown) {
  if (!isRecord(value)) return null
  const envelope = value[LOGICAL_CHUNK_KEY]
  if (!isRecord(envelope)) return null
  if (
    typeof envelope.id !== 'string' ||
    typeof envelope.index !== 'number' ||
    !Number.isSafeInteger(envelope.index) ||
    typeof envelope.total !== 'number' ||
    !Number.isSafeInteger(envelope.total) ||
    typeof envelope.payload !== 'string'
  ) {
    return null
  }
  return {
    id: envelope.id,
    index: envelope.index,
    total: envelope.total,
    payload: Buffer.from(envelope.payload, 'base64'),
  } satisfies LogicalChunk
}

export class LocalSessionFrameDecoder {
  private readonly chunks: Buffer[] = []
  private readonly logicalChunks = new Map<string, LogicalChunkState>()
  private logicalChunkBytes = 0
  private logicalChunksEnabled: boolean
  private headIndex = 0
  private headOffset = 0
  private retainedBytes = 0

  constructor(private maxFrameBytes = MAX_LOCAL_SESSION_FRAME_BYTES) {
    this.logicalChunksEnabled = maxFrameBytes > MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES
  }

  get pendingBytes() {
    return this.retainedBytes + this.logicalChunkBytes
  }

  setMaxFrameBytes(maxFrameBytes: number) {
    this.maxFrameBytes = maxFrameBytes
    this.logicalChunksEnabled = maxFrameBytes > MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES
  }

  reset() {
    this.chunks.length = 0
    this.headIndex = 0
    this.headOffset = 0
    this.retainedBytes = 0
    this.logicalChunks.clear()
    this.logicalChunkBytes = 0
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

  private acceptLogicalChunk(chunk: LogicalChunk, values: unknown[]) {
    if (!this.logicalChunksEnabled) {
      throw new Error('Local Session logical chunks are not accepted before authentication.')
    }
    if (
      !LOGICAL_CHUNK_ID_PATTERN.test(chunk.id) ||
      chunk.total < MIN_LOGICAL_CHUNKS ||
      chunk.total > MAX_LOGICAL_CHUNKS ||
      chunk.index < 0 ||
      chunk.index >= chunk.total
    ) {
      throw new Error('Local Session logical chunk metadata is invalid.')
    }
    let state = this.logicalChunks.get(chunk.id)
    if (!state) {
      if (this.logicalChunks.size >= MAX_ACTIVE_LOGICAL_MESSAGES) {
        throw new Error('Too many Local Session logical messages are active.')
      }
      state = { total: chunk.total, chunks: new Map(), bytes: 0 }
      this.logicalChunks.set(chunk.id, state)
    }
    if (state.total !== chunk.total || state.chunks.has(chunk.index)) {
      throw new Error('Local Session logical chunk sequence is invalid.')
    }
    state.chunks.set(chunk.index, chunk.payload)
    state.bytes += chunk.payload.byteLength
    this.logicalChunkBytes += chunk.payload.byteLength
    if (state.bytes > MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES) {
      throw new Error(
        `Local Session logical message exceeds ${MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES} bytes.`,
      )
    }
    if (state.chunks.size !== state.total) return
    const ordered: Buffer[] = []
    for (let index = 0; index < state.total; index += 1) {
      const part = state.chunks.get(index)
      if (!part) throw new Error('Local Session logical chunk sequence is incomplete.')
      ordered.push(part)
    }
    this.logicalChunks.delete(chunk.id)
    this.logicalChunkBytes -= state.bytes
    values.push(JSON.parse(Buffer.concat(ordered).toString('utf8')))
  }

  private acceptDecodedValue(value: unknown, values: unknown[]) {
    const logicalChunk = decodeChunkEnvelope(value)
    if (logicalChunk) this.acceptLogicalChunk(logicalChunk, values)
    else values.push(value)
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
    let decodedFrames = 0
    const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES)
    while (this.retainedBytes >= FRAME_HEADER_BYTES) {
      this.copyPending(header, FRAME_HEADER_BYTES)
      const payloadBytes = header.readUInt32BE(0)
      if (payloadBytes > this.maxFrameBytes) {
        throw new Error(`Local Session frame exceeds ${this.maxFrameBytes} bytes.`)
      }
      const frameBytes = FRAME_HEADER_BYTES + payloadBytes
      if (this.retainedBytes < frameBytes) break
      if (decodedFrames >= maxFrames) {
        throw new Error(`Local Session chunk exceeds ${String(maxFrames)} decoded frames.`)
      }
      this.consume(FRAME_HEADER_BYTES)
      const payload = Buffer.allocUnsafe(payloadBytes)
      this.copyPending(payload, payloadBytes)
      this.consume(payloadBytes)
      const value: unknown = JSON.parse(payload.toString('utf8'))
      decodedFrames += 1
      this.acceptDecodedValue(value, values)
    }
    this.compactHead()
    return values
  }
}
