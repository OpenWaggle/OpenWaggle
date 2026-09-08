import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session disconnected dispatch budget', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let releaseDispatch: (() => void) | undefined
  const clients: Socket[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-host-'))
  })

  afterEach(async () => {
    releaseDispatch?.()
    for (const client of clients.splice(0)) client.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function connect(endpoint: string, clientVersion: string) {
    const socket = await connectLocalSessionTestClient(endpoint)
    clients.push(socket)
    const reader = new TestFrameReader(socket)
    socket.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [7],
        clientKind: 'cli',
        clientVersion,
      }),
    )
    return { socket, reader }
  }

  it('charges a disconnected command until its retained dispatch payload settles', async () => {
    const endpoint = path.join(temporaryRoot, 'retained.sock')
    const command = encodeLocalSessionFrame({
      kind: 'command',
      requestId: 'retained',
      payload: { text: 'x'.repeat(4_096) },
    })
    const dispatch = vi.fn(
      () =>
        new Promise<{ accepted: true }>((resolve) => {
          releaseDispatch = () => resolve({ accepted: true })
        }),
    )
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub: new SessionHostEventHub({ hostInstanceId: 'host-current' }),
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      maxPendingInboundBytesGlobal: command.byteLength,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch,
    })
    const first = await connect(endpoint, 'retained-command')
    await expect(first.reader.next()).resolves.toMatchObject({ accepted: true, revision: 7 })
    first.socket.write(command)
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
    const firstClosed = new Promise<void>((resolve) => first.socket.once('close', resolve))
    first.socket.destroy()
    await firstClosed

    const blocked = await connect(endpoint, 'budget-still-leased')
    await expect(blocked.reader.next()).resolves.toMatchObject({
      kind: 'error',
      code: 'inbound_backpressure_exceeded',
    })

    releaseDispatch?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
    const admitted = await connect(endpoint, 'budget-released-after-dispatch')
    await expect(admitted.reader.next()).resolves.toMatchObject({ accepted: true, revision: 7 })
  })
})
