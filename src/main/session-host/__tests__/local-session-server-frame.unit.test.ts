import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionOutboundByteBudget } from '../local-session-outbound-budget'
import {
  LocalSessionClientDisconnectedError,
  writeLocalSessionSocketFrame,
} from '../local-session-server-frame'

/**
 * A socket double with a controllable write outcome, so a frame write can be driven through
 * the exact failure the Sentry report shows: the callback of a write to a peer that went away
 * receiving EPIPE, after the liveness guard already passed.
 */
class FrameWriteSocket extends EventEmitter {
  writable = true
  destroyed = false
  writtenSegments: Buffer[] = []

  private failNextWriteWith: (() => Error | undefined) | undefined

  failWritesAfterNextSegmentWith(error: () => Error) {
    let firstWriteAfterArm = true
    this.failNextWriteWith = () => {
      if (firstWriteAfterArm) {
        firstWriteAfterArm = false
        return undefined
      }
      return error()
    }
  }

  write(segment: Buffer, callback: (error?: Error) => void): boolean {
    if (this.destroyed) {
      setImmediate(() => callback(streamDestroyed()))
      return false
    }
    const error = this.failNextWriteWith?.()
    if (error) {
      setImmediate(() => callback(error))
      return false
    }
    this.writtenSegments.push(segment)
    setImmediate(() => callback())
    return true
  }

  destroy() {
    this.destroyed = true
    this.writable = false
    this.emit('close')
  }
}

/** The peer reset the connection: the kernel reports EPIPE to the pending write callback. */
function epipe() {
  return Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
}

/** Node reports a write issued on a destroyed stream through its callback as ERR_STREAM_DESTROYED. */
function streamDestroyed() {
  return Object.assign(new Error('This socket has been ended by the other party'), {
    code: 'ERR_STREAM_DESTROYED',
  })
}

async function writtenFrameError(socket: FrameWriteSocket, value: unknown) {
  try {
    await writeLocalSessionSocketFrame({
      socket: fromPartial<Socket>(socket),
      value,
      budget: new LocalSessionOutboundByteBudget(),
      signal: new AbortController().signal,
    })
  } catch (error) {
    return error
  }
  throw new Error('The frame write unexpectedly succeeded.')
}

describe('writeLocalSessionSocketFrame when the client disconnects mid-frame', () => {
  it('reports a benign client disconnect, not the raw EPIPE write error', async () => {
    const socket = new FrameWriteSocket()
    // The first segment (the frame header) is written, then the peer's reset arrives.
    socket.failWritesAfterNextSegmentWith(epipe)

    const error = await writtenFrameError(socket, { hello: 'frame' })

    expect(error).toBeInstanceOf(LocalSessionClientDisconnectedError)
  })

  it('reports a benign client disconnect when the socket is destroyed between segments', async () => {
    const socket = new FrameWriteSocket()
    const originalWrite = socket.write.bind(socket)
    vi.spyOn(socket, 'write').mockImplementation((segment, callback) => {
      if (socket.writtenSegments.length > 0) socket.destroy()
      return originalWrite(segment, callback)
    })

    const error = await writtenFrameError(socket, { hello: 'frame' })

    expect(error).toBeInstanceOf(LocalSessionClientDisconnectedError)
  })

  it('writes both segments of a healthy frame', async () => {
    const socket = new FrameWriteSocket()

    await writeLocalSessionSocketFrame({
      socket: fromPartial<Socket>(socket),
      value: { hello: 'frame' },
      budget: new LocalSessionOutboundByteBudget(),
      signal: new AbortController().signal,
    })

    expect(socket.writtenSegments).toHaveLength(2)
  })

  it('keeps a write error that is not a client disconnect as it is', async () => {
    const socket = new FrameWriteSocket()
    const unexpected = new Error('Anomaly.')
    socket.failWritesAfterNextSegmentWith(() => unexpected)

    const error = await writtenFrameError(socket, { hello: 'frame' })

    expect(error).toBe(unexpected)
  })
})
