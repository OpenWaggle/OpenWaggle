import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import {
  disconnectLocalSessionProfile,
  fenceLocalSessionProfileAdmissions,
  refreshLocalSessionProfileAdmissions,
} from '../local-session-profile-invalidation'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import {
  connectLocalSessionTestClient,
  sessionHostCursorFromTestFrame,
  TestFrameReader,
} from './local-session-server-test-client'

describe('Local Session subscription admission fences', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null

  beforeEach(async () => {
    handle = null
    client = null
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-host-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps admissions fenced until every concurrent authority refresh completes', async () => {
    const endpoint = path.join(temporaryRoot, 'concurrent.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    let releaseFirstRefresh!: () => void
    let releaseSecondRefresh!: () => void
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve
    })
    const secondRefreshGate = new Promise<void>((resolve) => {
      releaseSecondRefresh = resolve
    })
    let refreshCall = 0
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({
        callerId: 'profile:mutable',
        profileAuthority: {
          profileId: 'mutable',
          profileName: 'mutable',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['session-allowed'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['session-allowed'],
      }),
      refreshCaller: async (caller) => {
        refreshCall += 1
        await (refreshCall === 1 ? firstRefreshGate : secondRefreshGate)
        return caller
      },
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [7],
        clientKind: 'cli',
        clientVersion: 'test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'request-subscribe',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })

    const firstRefresh = refreshLocalSessionProfileAdmissions('mutable')
    const secondRefresh = refreshLocalSessionProfileAdmissions('mutable')
    await vi.waitFor(() => expect(refreshCall).toBe(1))
    releaseFirstRefresh()
    await firstRefresh
    await vi.waitFor(() => expect(refreshCall).toBe(2))

    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 1,
      operation: 'message',
    })
    releaseSecondRefresh()
    await secondRefresh
    const resync = await reader.next()
    expect(resync).toMatchObject({ kind: 'resync-required', reason: 'cursor-expired' })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'subscribe-after-concurrent-refresh',
        after: sessionHostCursorFromTestFrame(resync),
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'event',
      event: {
        cursor: { hostInstanceId: expect.any(String), sequence: 0 },
        payload: { stateRevision: 1 },
      },
    })
    const visibleEvent = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 2,
      operation: 'message',
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'event',
      subscriptionId: expect.any(String),
      event: {
        ...visibleEvent,
        cursor: { hostInstanceId: expect.any(String), sequence: 0 },
      },
    })
  })

  it('invalidates the stream at a durable profile fence and replays only after refresh', async () => {
    const endpoint = path.join(temporaryRoot, 'fence.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({
        callerId: 'profile:mutable',
        profileAuthority: {
          profileId: 'mutable',
          profileName: 'mutable',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['session-allowed'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['session-allowed'],
      }),
      refreshCaller: async (caller) => caller,
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [7],
        clientKind: 'cli',
        clientVersion: 'test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'request-subscribe',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })

    await fenceLocalSessionProfileAdmissions('mutable')
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 1,
      operation: 'message',
    })
    await refreshLocalSessionProfileAdmissions('mutable', { consumeExistingFence: true })
    const resync = await reader.next()
    expect(resync).toMatchObject({ kind: 'resync-required', reason: 'cursor-expired' })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'subscribe-after-fence',
        after: sessionHostCursorFromTestFrame(resync),
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'event',
      event: {
        cursor: { hostInstanceId: expect.any(String), sequence: 0 },
        payload: { stateRevision: 1 },
      },
    })
    const refreshedEvent = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 2,
      operation: 'message',
    })
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'event',
      event: {
        ...refreshedEvent,
        cursor: { hostInstanceId: expect.any(String), sequence: 0 },
      },
    })

    await fenceLocalSessionProfileAdmissions('mutable')
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 3,
      operation: 'message',
    })
    const closed = new Promise<void>((resolve) => client?.once('close', () => resolve()))
    disconnectLocalSessionProfile('mutable')
    await closed
  })
})
