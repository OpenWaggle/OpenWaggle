import { describe, expect, it } from 'vitest'
import {
  encodeLocalSessionFrame,
  LocalSessionFrameDecoder,
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES,
} from '../local-session-framing'

describe('Local Session transport framing', () => {
  it('decodes fragmented and coalesced request frames without delimiter ambiguity', () => {
    const first = encodeLocalSessionFrame({ requestId: 'first', text: 'line one\nline two' })
    const second = encodeLocalSessionFrame({ requestId: 'second' })
    const combined = Buffer.concat([first, second])
    const decoder = new LocalSessionFrameDecoder()

    expect(decoder.push(combined.subarray(0, 3))).toEqual([])
    expect(decoder.push(combined.subarray(3, first.byteLength + 2))).toEqual([
      { requestId: 'first', text: 'line one\nline two' },
    ])
    expect(decoder.push(combined.subarray(first.byteLength + 2))).toEqual([{ requestId: 'second' }])
    expect(decoder.pendingBytes).toBe(0)
  })

  it('rejects an announced payload larger than the transport boundary', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32BE(MAX_LOCAL_SESSION_FRAME_BYTES + 1)

    expect(() => new LocalSessionFrameDecoder().push(header)).toThrow(
      `Local Session frame exceeds ${MAX_LOCAL_SESSION_FRAME_BYTES} bytes.`,
    )
  })

  it('retains only undecoded bytes across many small fragments', () => {
    const frame = encodeLocalSessionFrame({ text: 'x'.repeat(4_096) })
    const decoder = new LocalSessionFrameDecoder()
    let decoded: unknown[] = []
    for (let offset = 0; offset < frame.byteLength; offset += 7) {
      decoded = decoded.concat(decoder.push(frame.subarray(offset, offset + 7)))
      expect(decoder.pendingBytes).toBeLessThanOrEqual(frame.byteLength)
    }
    expect(decoded).toEqual([{ text: 'x'.repeat(4_096) }])
    expect(decoder.pendingBytes).toBe(0)
  })

  it('rejects packed frames before parsing beyond the configured boundary', () => {
    const decoder = new LocalSessionFrameDecoder()
    const packed = Buffer.concat(
      Array.from({ length: 258 }, (_, index) => encodeLocalSessionFrame({ index })),
    )

    expect(() => decoder.push(packed, 256)).toThrow(
      'Local Session chunk exceeds 256 decoded frames.',
    )
  })

  it('consumes a highly fragmented frame without shifting the chunk queue', () => {
    const decoder = new LocalSessionFrameDecoder()
    const frame = encodeLocalSessionFrame({ text: 'fragmented' })
    let decoded: unknown[] = []
    for (const byte of frame) decoded = decoded.concat(decoder.push(Buffer.from([byte])))

    expect(decoded).toEqual([{ text: 'fragmented' }])
    expect(decoder.pendingBytes).toBe(0)
  })

  it('chunks and reassembles a logical response larger than one physical frame', () => {
    const value = { requestId: 'large-history', text: 'x'.repeat(MAX_LOCAL_SESSION_FRAME_BYTES) }
    const encoded = encodeLocalSessionFrame(value)
    const decoder = new LocalSessionFrameDecoder()

    expect(encoded.byteLength).toBeGreaterThan(MAX_LOCAL_SESSION_FRAME_BYTES)
    expect(decoder.push(encoded)).toEqual([value])
    expect(decoder.pendingBytes).toBe(0)
  })

  it('rejects logical chunk envelopes before authentication', () => {
    const decoder = new LocalSessionFrameDecoder(MAX_PREAUTH_LOCAL_SESSION_FRAME_BYTES)
    const hostile = encodeLocalSessionFrame({
      __openwaggleLocalSessionChunkV1: {
        id: 'hostile',
        index: 4_294_967_294,
        total: 4_294_967_295,
        payload: '',
      },
    })

    expect(() => decoder.push(hostile)).toThrow('not accepted before authentication')
  })

  it('caps authenticated chunk counts before allocating attacker-sized metadata', () => {
    const decoder = new LocalSessionFrameDecoder()
    const hostile = encodeLocalSessionFrame({
      __openwaggleLocalSessionChunkV1: {
        id: 'hostile',
        index: 4_294_967_294,
        total: 4_294_967_295,
        payload: '',
      },
    })

    expect(() => decoder.push(hostile)).toThrow('metadata is invalid')
  })

  it('rejects oversized logical chunk identifiers before retaining assembly metadata', () => {
    const decoder = new LocalSessionFrameDecoder()
    const hostile = encodeLocalSessionFrame({
      __openwaggleLocalSessionChunkV1: {
        id: 'x'.repeat(1024 * 1024),
        index: 0,
        total: 2,
        payload: '',
      },
    })

    expect(() => decoder.push(hostile)).toThrow('metadata is invalid')
    expect(decoder.pendingBytes).toBe(0)
  })

  it('bounds incomplete logical-message metadata even when chunk payloads are empty', () => {
    const decoder = new LocalSessionFrameDecoder()
    for (let index = 0; index < 4; index += 1) {
      decoder.push(
        encodeLocalSessionFrame({
          __openwaggleLocalSessionChunkV1: {
            id: `00000000-0000-4000-8000-00000000000${String(index)}`,
            index: 0,
            total: 2,
            payload: '',
          },
        }),
      )
    }
    const overflow = encodeLocalSessionFrame({
      __openwaggleLocalSessionChunkV1: {
        id: '00000000-0000-4000-8000-000000000004',
        index: 0,
        total: 2,
        payload: '',
      },
    })

    expect(() => decoder.push(overflow)).toThrow('Too many Local Session logical messages')
  })
})
