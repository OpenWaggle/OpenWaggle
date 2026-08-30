import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { refreshLocalSessionProfileAdmissions } from '../local-session-profile-invalidation'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session server subscriptions', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-host-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('drops restricted subscription payloads before authorization and advances the cursor', async () => {
    const endpoint = path.join(temporaryRoot, 'restricted.sock')
    const eventHub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      subscriberCapacity: 1,
    })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const authorizeEvent = vi.fn(async () => true)
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({
        callerId: 'transient-mcp:restricted',
        profileAuthority: {
          profileId: 'restricted',
          profileName: 'restricted',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['session-allowed'] },
          authorizationCeiling: 'ask-for-approval',
        },
      }),
      authorizeEvent,
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'request-subscribe',
        after: eventHub.cursor(),
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })

    const firstDenied = eventHub.publish({
      kind: 'semantic-discovery-readiness-changed',
      readiness: { status: 'ready', pendingCount: 0, snapshotRevision: 1 },
    })
    let lastDenied = firstDenied
    for (let stateRevision = 1; stateRevision <= 300; stateRevision += 1) {
      lastDenied = eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-denied',
        stateRevision,
        operation: 'message',
      })
    }
    const visible = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 1,
      operation: 'message',
    })

    await expect(reader.next()).resolves.toEqual({
      kind: 'cursor-advanced',
      subscriptionId: expect.any(String),
      cursor: firstDenied.cursor,
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'cursor-advanced',
      subscriptionId: expect.any(String),
      cursor: lastDenied.cursor,
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'event',
      subscriptionId: expect.any(String),
      event: visible,
    })
    expect(authorizeEvent).toHaveBeenCalledOnce()
    expect(authorizeEvent).toHaveBeenCalledWith(expect.any(Object), visible)
  })

  it('uses live event authorization when a named profile gains Session scope', async () => {
    const endpoint = path.join(temporaryRoot, 'live-profile-scope.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const liveSessionIds = new Set(['session-original'])
    const authorizeEvent = vi.fn(async (_caller, event) => {
      if (event.payload.kind === 'semantic-discovery-readiness-changed') return false
      return liveSessionIds.has(event.payload.sessionId)
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
          scope: { sessionIds: ['session-original'] },
          authorizationCeiling: 'ask-for-approval',
        },
      }),
      refreshCaller: async (caller) => ({
        ...caller,
        baseProfileScope: { sessionIds: [...liveSessionIds] },
        profileAuthority: caller.profileAuthority
          ? {
              ...caller.profileAuthority,
              scope: { sessionIds: [...liveSessionIds] },
            }
          : undefined,
      }),
      authorizeEvent,
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'request-subscribe',
        after: eventHub.cursor(),
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })

    const firstDenied = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-denied',
      stateRevision: 1,
      operation: 'message',
    })
    let lastDenied = firstDenied
    for (let stateRevision = 2; stateRevision <= 300; stateRevision += 1) {
      lastDenied = eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-denied',
        stateRevision,
        operation: 'message',
      })
    }
    const original = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-original',
      stateRevision: 1,
      operation: 'message',
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'cursor-advanced',
      subscriptionId: expect.any(String),
      cursor: firstDenied.cursor,
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'cursor-advanced',
      subscriptionId: expect.any(String),
      cursor: lastDenied.cursor,
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'event',
      subscriptionId: expect.any(String),
      event: original,
    })

    liveSessionIds.add('session-newly-authorized')
    await refreshLocalSessionProfileAdmissions('mutable')
    const visible = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-newly-authorized',
      stateRevision: 1,
      operation: 'spawn',
    })

    await expect(reader.next()).resolves.toEqual({
      kind: 'event',
      subscriptionId: expect.any(String),
      event: visible,
    })
    expect(authorizeEvent).toHaveBeenCalledWith(expect.any(Object), visible)

    liveSessionIds.delete('session-original')
    await refreshLocalSessionProfileAdmissions('mutable')
    const firstRevoked = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-original',
      stateRevision: 2,
      operation: 'message',
    })
    let lastRevoked = firstRevoked
    for (let stateRevision = 3; stateRevision <= 302; stateRevision += 1) {
      lastRevoked = eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-original',
        stateRevision,
        operation: 'message',
      })
    }
    const stillVisible = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-newly-authorized',
      stateRevision: 2,
      operation: 'message',
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'cursor-advanced',
      subscriptionId: expect.any(String),
      cursor: firstRevoked.cursor,
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'cursor-advanced',
      subscriptionId: expect.any(String),
      cursor: lastRevoked.cursor,
    })
    await expect(reader.next()).resolves.toEqual({
      kind: 'event',
      subscriptionId: expect.any(String),
      event: stillVisible,
    })
  })
})
