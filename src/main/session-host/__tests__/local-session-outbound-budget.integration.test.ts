import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame, MAX_LOCAL_SESSION_FRAME_BYTES } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

const LARGE_RESPONSE_BYTES = 10 * 1024 * 1024
const RETAINED_LARGE_RESPONSE_BYTES = LARGE_RESPONSE_BYTES + MAX_LOCAL_SESSION_FRAME_BYTES
const OUTBOUND_BUDGET_BYTES = 96 * 1024 * 1024

function requestedResponseBytes(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('responseBytes' in value) ||
    typeof value.responseBytes !== 'number'
  ) {
    return 0
  }
  return value.responseBytes
}

function responseTextLength(value: unknown): number | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'response' ||
    !('payload' in value) ||
    typeof value.payload !== 'object' ||
    value.payload === null ||
    !('text' in value.payload) ||
    typeof value.payload.text !== 'string'
  ) {
    return
  }
  return value.payload.text.length
}

describe('Local Session outbound byte budget', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  const clients: Socket[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-host-'))
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function connect(endpoint: string, version: string) {
    const socket = await connectLocalSessionTestClient(endpoint)
    clients.push(socket)
    const reader = new TestFrameReader(socket)
    socket.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
        clientKind: 'cli',
        clientVersion: version,
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      accepted: true,
      revision: LOCAL_SESSION_CURRENT_REVISION,
    })
    return { socket, reader }
  }

  function requestLargeResponse(socket: Socket, requestId: string) {
    socket.write(
      encodeLocalSessionFrame({
        kind: 'command',
        requestId,
        payload: { responseBytes: LARGE_RESPONSE_BYTES },
      }),
    )
  }

  let encodedLargeResponses = 0

  async function listen(
    endpoint: string,
    outboundCapacityWaitMs: number,
    maxPendingOutboundBytesGlobal = OUTBOUND_BUDGET_BYTES,
    outboundMaxWaitMs?: number,
  ) {
    encodedLargeResponses = 0
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub: new SessionHostEventHub({ hostInstanceId: 'host-current' }),
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      maxPendingOutboundBytesGlobal,
      outboundCapacityWaitMs,
      ...(outboundMaxWaitMs === undefined ? {} : { outboundMaxWaitMs }),
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch: async ({ payload }) => {
        const responseBytes = requestedResponseBytes(payload)
        return {
          toJSON: () => {
            encodedLargeResponses += 1
            return { text: 'x'.repeat(responseBytes) }
          },
        }
      },
    })
    return handle
  }

  /**
   * A client that keeps reading, slowly: it pauses `pauseMs` after every `bytesPerPause` it reads,
   * whatever size the platform's socket reads have.
   */
  function readSlowly(socket: Socket, bytesPerPause: number, pauseMs: number) {
    let sincePause = 0
    const onData = (chunk: Buffer) => {
      sincePause += chunk.byteLength
      if (sincePause < bytesPerPause) return
      sincePause = 0
      socket.pause()
      setTimeout(() => socket.resume(), pauseMs)
    }
    socket.on('data', onData)
    socket.resume()
    return () => socket.off('data', onData)
  }

  /** Connects every client before the budget fills, so each test controls who holds the room. */
  async function holdCapacityWithUnreadResponses(endpoint: string, nextClientVersion: string) {
    const stalled = await connect(endpoint, 'stalled-reader')
    const delayedReader = await connect(endpoint, 'delayed-reader')
    const next = await connect(endpoint, nextClientVersion)
    stalled.socket.pause()
    delayedReader.socket.pause()
    requestLargeResponse(stalled.socket, 'stalled')
    // The stalled reader's frame is retained first, so it is the oldest unread one.
    await vi.waitFor(() => {
      const pendingBytes = handle?.outboundByteUsage().pendingBytes ?? 0
      expect(pendingBytes).toBeGreaterThan(RETAINED_LARGE_RESPONSE_BYTES)
      expect(pendingBytes).toBeLessThan(RETAINED_LARGE_RESPONSE_BYTES + 1024)
    })
    requestLargeResponse(delayedReader.socket, 'delayed')
    await vi.waitFor(() => {
      const pendingBytes = handle?.outboundByteUsage().pendingBytes ?? 0
      expect(pendingBytes).toBeGreaterThan(RETAINED_LARGE_RESPONSE_BYTES * 2)
      expect(pendingBytes).toBeLessThan(RETAINED_LARGE_RESPONSE_BYTES * 2 + 1024)
    })
    return { stalled, delayedReader, next }
  }

  it('makes the next client wait while a slow reader holds capacity, not drop its connection', async () => {
    const endpoint = path.join(temporaryRoot, 'outbound-budget-wait.sock')
    await listen(endpoint, 30_000)
    const {
      stalled,
      delayedReader,
      next: waiting,
    } = await holdCapacityWithUnreadResponses(endpoint, 'waits-for-capacity')
    let waitingClosed = false
    waiting.socket.once('close', () => {
      waitingClosed = true
    })

    requestLargeResponse(waiting.socket, 'waiting')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(encodedLargeResponses).toBe(2)
    expect(waitingClosed).toBe(false)

    // The slow reader catches up; the room its answer held lets the waiting answer through.
    delayedReader.socket.resume()
    await expect(delayedReader.reader.next()).resolves.toSatisfy(
      (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
    )
    await expect(waiting.reader.next()).resolves.toSatisfy(
      (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
    )
    expect(waitingClosed).toBe(false)
    const usage = handle?.outboundByteUsage()
    expect(usage?.peakBytes).toBeLessThanOrEqual(usage?.maxBytes ?? 0)

    stalled.socket.destroy()
    await vi.waitFor(() => expect(handle?.outboundByteUsage().pendingBytes).toBe(0))
  })

  it('closes the reader that stopped reading, not the client that asked for room', async () => {
    const endpoint = path.join(temporaryRoot, 'outbound-budget.sock')
    const server = await listen(endpoint, 50)
    const {
      stalled,
      delayedReader,
      next: waiting,
    } = await holdCapacityWithUnreadResponses(endpoint, 'served-after-eviction')
    const stalledClosed = new Promise<void>((resolve) => stalled.socket.once('close', resolve))
    let waitingClosed = false
    waiting.socket.once('close', () => {
      waitingClosed = true
    })

    requestLargeResponse(waiting.socket, 'waiting')
    await expect(waiting.reader.next()).resolves.toSatisfy(
      (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
    )
    expect(waitingClosed).toBe(false)
    expect(encodedLargeResponses).toBe(3)
    // A paused socket reports its close once it reads what was buffered before it.
    stalled.socket.resume()
    await stalledClosed

    const retained = server.outboundByteUsage()
    expect(retained.pendingBytes).toBeLessThanOrEqual(retained.maxBytes)
    expect(retained.peakBytes).toBeLessThanOrEqual(retained.maxBytes)

    delayedReader.socket.resume()
    await expect(delayedReader.reader.next()).resolves.toSatisfy(
      (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
    )
    await vi.waitFor(() => expect(handle?.outboundByteUsage().pendingBytes).toBe(0))
  })

  it('does not close readers that resumed while the Host was stalled past the wait', async () => {
    const endpoint = path.join(temporaryRoot, 'outbound-budget-stall.sock')
    await listen(endpoint, 1_000)
    const {
      stalled: firstReader,
      delayedReader: secondReader,
      next: waiting,
    } = await holdCapacityWithUnreadResponses(endpoint, 'waits-through-host-stall')
    const closed: string[] = []
    firstReader.socket.once('close', () => closed.push('first'))
    secondReader.socket.once('close', () => closed.push('second'))

    requestLargeResponse(waiting.socket, 'waiting')
    // Both readers catch up at 300 ms, but the Host is blocked from 200 ms to 1.4 s, past the
    // 1 s wait: their frames could not be written meanwhile, which is no fault of theirs.
    setTimeout(() => {
      firstReader.socket.resume()
      secondReader.socket.resume()
    }, 300)
    setTimeout(() => {
      const blockedUntil = Date.now() + 1_200
      while (Date.now() < blockedUntil) {
        // Simulates a synchronous Host stall.
      }
    }, 200)

    for (const reader of [firstReader, secondReader, waiting]) {
      await expect(reader.reader.next()).resolves.toSatisfy(
        (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
      )
    }
    expect(closed).toEqual([])
    await vi.waitFor(() => expect(handle?.outboundByteUsage().pendingBytes).toBe(0))
  })

  it('keeps a reader that reads a large answer slowly but steadily', async () => {
    const endpoint = path.join(temporaryRoot, 'slow-reader.sock')
    // One unread large answer fills it. The waiting answer may wait as long as the slow read takes.
    await listen(endpoint, 1_000, RETAINED_LARGE_RESPONSE_BYTES + 64 * 1024 * 1024, 60_000)
    const slow = await connect(endpoint, 'slow-steady-reader')
    const waiting = await connect(endpoint, 'waits-for-the-slow-reader')
    let slowClosed = false
    const closedEarly = new Promise<never>((_resolve, reject) => {
      slow.socket.once('close', () => {
        slowClosed = true
        reject(new Error('The slow but steady reader was closed.'))
      })
    })
    void closedEarly.catch(() => undefined)
    slow.socket.pause()
    requestLargeResponse(slow.socket, 'slow')
    await vi.waitFor(() =>
      expect(handle?.outboundByteUsage().pendingBytes).toBeGreaterThan(LARGE_RESPONSE_BYTES),
    )
    requestLargeResponse(waiting.socket, 'waiting')

    // About 10 MB at 256 KiB per 100 ms: each 1 MiB slice takes about 400 ms, under the 1 s stop
    // time, while the whole answer takes about 4 s, well over it.
    const readingStartedAt = performance.now()
    const stopReading = readSlowly(slow.socket, 256 * 1024, 100)
    await expect(Promise.race([slow.reader.next(), closedEarly])).resolves.toSatisfy(
      (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
    )
    stopReading()
    // The test's premise: without per-slice progress the reader would have been closed.
    expect(performance.now() - readingStartedAt).toBeGreaterThan(2_000)
    await expect(waiting.reader.next()).resolves.toSatisfy(
      (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
    )
    expect(slowClosed).toBe(false)
  })

  it('completes a new handshake at once while a large answer waits for room', async () => {
    const endpoint = path.join(temporaryRoot, 'handshake.sock')
    await listen(endpoint, 30_000)
    const {
      stalled,
      delayedReader,
      next: waiting,
    } = await holdCapacityWithUnreadResponses(endpoint, 'holds-the-turn')
    requestLargeResponse(waiting.socket, 'waiting')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const startedAt = performance.now()
    await connect(endpoint, 'connects-while-full')
    expect(performance.now() - startedAt).toBeLessThan(1_000)

    stalled.socket.destroy()
    delayedReader.socket.destroy()
    await expect(waiting.reader.next()).resolves.toSatisfy(
      (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
    )
  })
})
