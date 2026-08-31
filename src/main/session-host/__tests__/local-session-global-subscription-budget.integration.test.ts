import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { isRecord } from '@shared/utils/validation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session global subscription budget', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  const clients: Socket[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-sub-budget-'))
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function connect(endpoint: string) {
    const socket = await connectLocalSessionTestClient(endpoint)
    clients.push(socket)
    const reader = new TestFrameReader(socket)
    socket.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'subscription-budget',
      }),
    )
    await reader.next()
    return { reader, socket }
  }

  it('atomically admits concurrent connections and releases capacity', async () => {
    const endpoint = path.join(temporaryRoot, 'g.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      maxSubscriptionsGlobal: 1,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch: async () => ({ accepted: true }),
    })
    const first = await connect(endpoint)
    const second = await connect(endpoint)
    for (const [requestId, connection] of [
      ['first', first],
      ['second', second],
    ] as const) {
      connection.socket.write(
        encodeLocalSessionFrame({ kind: 'subscribe', requestId, after: eventHub.cursor() }),
      )
    }

    const responses = await Promise.all([first.reader.next(), second.reader.next()])
    expect(
      responses.filter((response) => isRecord(response) && response.kind === 'subscribed'),
    ).toHaveLength(1)
    expect(
      responses.filter(
        (response) =>
          isRecord(response) &&
          response.kind === 'error' &&
          response.code === 'subscription_limit_exceeded',
      ),
    ).toHaveLength(1)
    expect(eventHub.subscriberCount()).toBe(1)

    const subscribedIndex = responses.findIndex(
      (response) => isRecord(response) && response.kind === 'subscribed',
    )
    const subscribedSocket = subscribedIndex === 0 ? first.socket : second.socket
    const closed = new Promise<void>((resolve) => subscribedSocket.once('close', resolve))
    subscribedSocket.destroy()
    await closed
    await vi.waitFor(() => expect(eventHub.subscriberCount()).toBe(0))

    const replacement = await connect(endpoint)
    replacement.socket.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'replacement',
        after: eventHub.cursor(),
      }),
    )
    await expect(replacement.reader.next()).resolves.toMatchObject({
      kind: 'subscribed',
      requestId: 'replacement',
    })
  })
})
