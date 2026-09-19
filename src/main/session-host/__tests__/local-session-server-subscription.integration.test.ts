import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { refreshLocalSessionProfileAdmissions } from '../local-session-profile-invalidation'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import {
  connectLocalSessionTestClient,
  sessionHostCursorFromTestFrame,
  TestFrameReader,
} from './local-session-server-test-client'

const SCOPE_REFRESH_CASES: readonly {
  readonly label: string
  readonly callerId: string
  readonly scope: LocalSessionProfileScope
  readonly refreshId: string | undefined
}[] = [
  {
    label: 'named profile',
    callerId: 'profile:mutable',
    scope: { sessionIds: ['session-original'] },
    refreshId: 'mutable',
  },
  {
    label: 'transient MCP workspace authority',
    callerId: 'transient-mcp:mutable',
    scope: { workspaceRoots: ['/workspace'] },
    refreshId: undefined,
  },
]

describe('Local Session server subscriptions', () => {
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

  it('drops restricted subscription payloads without exposing their progress', async () => {
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
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
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

    eventHub.publish({
      kind: 'semantic-discovery-readiness-changed',
      readiness: { status: 'ready', pendingCount: 0, snapshotRevision: 1 },
    })
    for (let stateRevision = 1; stateRevision <= 300; stateRevision += 1) {
      eventHub.publish({
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
      kind: 'event',
      subscriptionId: expect.any(String),
      event: {
        ...visible,
        cursor: { hostInstanceId: expect.any(String), sequence: 0 },
      },
    })
    expect(authorizeEvent).toHaveBeenCalledOnce()
    expect(authorizeEvent).toHaveBeenCalledWith(expect.any(Object), visible)
  })

  it.each(SCOPE_REFRESH_CASES)(
    'uses live event authorization when a $label gains Session scope',
    async ({ callerId, scope, refreshId }) => {
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
          callerId,
          profileAuthority: {
            profileId: 'mutable',
            profileName: 'mutable',
            capabilities: ['sessions:discover'],
            scope,
            authorizationCeiling: 'ask-for-approval',
          },
          eventAdmissionSessionIds: ['session-original'],
        }),
        refreshCaller: async (caller) => ({
          ...caller,
          eventAdmissionSessionIds: [...liveSessionIds],
          profileAuthority: caller.profileAuthority
            ? {
                ...caller.profileAuthority,
                scope:
                  callerId === 'profile:mutable'
                    ? { sessionIds: [...liveSessionIds] }
                    : caller.profileAuthority.scope,
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
          supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
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

      eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-denied',
        stateRevision: 1,
        operation: 'message',
      })
      for (let stateRevision = 2; stateRevision <= 300; stateRevision += 1) {
        eventHub.publish({
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
        kind: 'event',
        subscriptionId: expect.any(String),
        event: {
          ...original,
          cursor: { hostInstanceId: expect.any(String), sequence: 0 },
        },
      })
      liveSessionIds.add('session-newly-authorized')
      await refreshLocalSessionProfileAdmissions(refreshId)
      const expandedResync = await reader.next()
      expect(expandedResync).toMatchObject({
        kind: 'resync-required',
        reason: 'cursor-expired',
      })
      client.write(
        encodeLocalSessionFrame({
          kind: 'subscribe',
          requestId: 'subscribe-expanded',
          after: sessionHostCursorFromTestFrame(expandedResync),
        }),
      )
      await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })
      const visible = eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-newly-authorized',
        stateRevision: 1,
        operation: 'spawn',
      })
      await expect(reader.next()).resolves.toEqual({
        kind: 'event',
        subscriptionId: expect.any(String),
        event: {
          ...visible,
          cursor: { hostInstanceId: expect.any(String), sequence: 0 },
        },
      })
      expect(authorizeEvent).toHaveBeenCalledWith(expect.any(Object), visible)
      liveSessionIds.delete('session-original')
      await refreshLocalSessionProfileAdmissions(refreshId)
      const reducedResync = await reader.next()
      expect(reducedResync).toMatchObject({
        kind: 'resync-required',
        reason: 'cursor-expired',
      })
      client.write(
        encodeLocalSessionFrame({
          kind: 'subscribe',
          requestId: 'subscribe-reduced',
          after: sessionHostCursorFromTestFrame(reducedResync),
        }),
      )
      await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })
      eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-original',
        stateRevision: 2,
        operation: 'message',
      })
      for (let stateRevision = 3; stateRevision <= 302; stateRevision += 1) {
        eventHub.publish({
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
        kind: 'event',
        subscriptionId: expect.any(String),
        event: {
          ...stillVisible,
          cursor: { hostInstanceId: expect.any(String), sequence: 0 },
        },
      })
    },
  )
})
