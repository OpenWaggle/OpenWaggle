import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { listenLocalSessionServer } from '../local-session-server'
import {
  connectLocalSessionTestClient,
  sessionHostCursorFromTestFrame,
  TestFrameReader,
} from './local-session-server-test-client'

describe('filtered Local Session watch checkpoints', () => {
  const sockets: { destroy: () => void }[] = []
  const servers: { close: () => Promise<void> }[] = []
  const roots: string[] = []

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy()
    for (const server of servers.splice(0)) await server.close()
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
  })

  it('resumes after unrelated events exceed the replay window', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-filtered-watch-'))
    roots.push(root)
    const endpoint = path.join(root, 'filtered-watch.sock')
    const eventHub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      replayCapacity: 3,
    })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    servers.push(
      await listenLocalSessionServer(endpoint, {
        hostInstanceId: 'host-current',
        eventHub,
        liveness,
        authenticate: async () => ({ callerId: 'cli:filtered-watch' }),
        dispatch: async () => ({ accepted: true }),
      }),
    )
    const client = await connectLocalSessionTestClient(endpoint)
    sockets.push(client)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
        clientKind: 'cli',
        clientVersion: 'test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'initial-watch',
        sessionIds: ['session-visible'],
      }),
    )
    const subscribed = await reader.next()
    expect(subscribed).toMatchObject({ kind: 'subscribed', requestId: 'initial-watch' })
    if (typeof subscribed !== 'object' || subscribed === null) {
      throw new Error('Expected a subscription frame.')
    }
    const subscriptionId: unknown = Reflect.get(subscribed, 'subscriptionId')
    if (typeof subscriptionId !== 'string') throw new Error('Expected a subscription ID.')
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-visible',
      stateRevision: 1,
      operation: 'message',
    })
    await expect(reader.next()).resolves.toMatchObject({ kind: 'event', subscriptionId })

    let checkpoint: ReturnType<typeof sessionHostCursorFromTestFrame> | undefined
    for (let stateRevision = 1; stateRevision <= 5; stateRevision += 1) {
      eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-unrelated',
        stateRevision,
        operation: 'message',
      })
    }
    while (checkpoint?.sequence !== eventHub.cursor().sequence) {
      const frame = await reader.next()
      expect(frame).toMatchObject({ kind: 'cursor-advanced', subscriptionId })
      checkpoint = sessionHostCursorFromTestFrame(frame)
    }
    if (!checkpoint) throw new Error('Expected a filtered cursor checkpoint.')
    client.write(
      encodeLocalSessionFrame({
        kind: 'unsubscribe',
        requestId: 'stop-initial-watch',
        subscriptionId,
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'unsubscribed',
      requestId: 'stop-initial-watch',
    })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'resumed-watch',
        after: checkpoint,
        sessionIds: ['session-visible'],
      }),
    )
    let resumed = await reader.next()
    if (
      typeof resumed === 'object' &&
      resumed !== null &&
      Reflect.get(resumed, 'kind') === 'subscription-closed'
    ) {
      resumed = await reader.next()
    }
    expect(resumed).toMatchObject({ kind: 'subscribed', requestId: 'resumed-watch' })
  })
})
