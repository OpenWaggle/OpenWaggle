import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
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
        supportedRevisions: [7],
        clientKind: 'cli',
        clientVersion: version,
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true, revision: 7 })
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

  it('bounds concurrent large writes and disconnects a client when stalled readers hold capacity', async () => {
    const endpoint = path.join(temporaryRoot, 'outbound-budget.sock')
    let encodedLargeResponses = 0
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub: new SessionHostEventHub({ hostInstanceId: 'host-current' }),
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      maxPendingOutboundBytesGlobal: OUTBOUND_BUDGET_BYTES,
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

    const stalled = await connect(endpoint, 'stalled-reader')
    const delayedReader = await connect(endpoint, 'delayed-reader')
    const rejected = await connect(endpoint, 'rejected-under-pressure')
    stalled.socket.pause()
    delayedReader.socket.pause()
    requestLargeResponse(stalled.socket, 'stalled')
    requestLargeResponse(delayedReader.socket, 'delayed')

    await vi.waitFor(() => {
      const pendingBytes = handle?.outboundByteUsage().pendingBytes ?? 0
      expect(pendingBytes).toBeGreaterThan(RETAINED_LARGE_RESPONSE_BYTES * 2)
      expect(pendingBytes).toBeLessThan(RETAINED_LARGE_RESPONSE_BYTES * 2 + 1024)
    })

    const rejectedClosed = new Promise<void>((resolve) => rejected.socket.once('close', resolve))
    requestLargeResponse(rejected.socket, 'rejected')
    await rejectedClosed
    expect(encodedLargeResponses).toBe(2)

    const retained = handle.outboundByteUsage()
    expect(retained.pendingBytes).toBeLessThanOrEqual(retained.maxBytes)
    expect(retained.peakBytes).toBeLessThanOrEqual(retained.maxBytes)

    delayedReader.socket.resume()
    await expect(delayedReader.reader.next()).resolves.toSatisfy(
      (value: unknown) => responseTextLength(value) === LARGE_RESPONSE_BYTES,
    )
    await vi.waitFor(() => {
      const pendingBytes = handle?.outboundByteUsage().pendingBytes ?? 0
      expect(pendingBytes).toBeGreaterThan(RETAINED_LARGE_RESPONSE_BYTES)
      expect(pendingBytes).toBeLessThan(RETAINED_LARGE_RESPONSE_BYTES + 1024)
    })

    stalled.socket.destroy()
    await vi.waitFor(() => expect(handle?.outboundByteUsage().pendingBytes).toBe(0))
  })
})
