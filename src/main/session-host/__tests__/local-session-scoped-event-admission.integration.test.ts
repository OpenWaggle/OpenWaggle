import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session scoped event admission', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-event-admit-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each([
    { label: 'project', scope: { projectPaths: ['/allowed-project'] } },
    { label: 'workspace', scope: { workspaceRoots: ['/allowed-workspace'] } },
    { label: 'hive', scope: { hiveRootSessionIds: ['allowed-hive'] } },
  ])(
    'drops more than subscriber capacity of unrelated events for $label scope before buffering',
    async ({ scope }) => {
      const endpoint = path.join(temporaryRoot, 'scoped.sock')
      const eventHub = new SessionHostEventHub({
        hostInstanceId: 'host-current',
        subscriberCapacity: 1,
      })
      const liveness = new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      })
      const authorizeEvent = vi.fn(async (_caller, event) =>
        event.payload.kind === 'semantic-discovery-readiness-changed'
          ? false
          : event.payload.sessionId === 'session-allowed',
      )
      handle = await listenLocalSessionServer(endpoint, {
        hostInstanceId: 'host-current',
        eventHub,
        liveness,
        authenticate: async () => ({
          callerId: 'profile:restricted',
          profileAuthority: {
            profileId: 'restricted',
            profileName: 'restricted',
            capabilities: ['sessions:discover'],
            scope,
            authorizationCeiling: 'ask-for-approval',
          },
          eventAdmissionSessionIds: ['session-allowed'],
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
    },
  )

  it('drops over-capacity event kinds denied by capability before buffering', async () => {
    const endpoint = path.join(temporaryRoot, 'capability.sock')
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
        callerId: 'profile:discover-only',
        profileAuthority: {
          profileId: 'discover-only',
          profileName: 'discover-only',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['session-allowed'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['session-allowed'],
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
      kind: 'session-transport',
      sessionId: 'session-allowed',
      event: { type: 'agent_start', runId: 'run-1', timestamp: 1 },
    })
    for (let sequence = 2; sequence <= 300; sequence += 1) {
      eventHub.publish({
        kind: 'session-transport',
        sessionId: 'session-allowed',
        event: { type: 'agent_start', runId: `run-${sequence}`, timestamp: sequence },
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

  it('does not combine base read capability with an over-capacity discovery-only child stream', async () => {
    const endpoint = path.join(temporaryRoot, 'derived-capability.sock')
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
        callerId: 'profile:queen',
        profileAuthority: {
          profileId: 'queen',
          profileName: 'queen',
          capabilities: ['sessions:read'],
          scope: { sessionIds: ['queen-session'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['queen-session'],
        derivedSessionAuthorities: [
          {
            sessionId: 'worker-session',
            capabilities: ['sessions:discover'],
            authorizationCeiling: 'ask-for-approval',
          },
        ],
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
      kind: 'session-transport',
      sessionId: 'worker-session',
      event: { type: 'agent_start', runId: 'run-1', timestamp: 1 },
    })
    for (let sequence = 2; sequence <= 300; sequence += 1) {
      eventHub.publish({
        kind: 'session-transport',
        sessionId: 'worker-session',
        event: { type: 'agent_start', runId: `run-${sequence}`, timestamp: sequence },
      })
    }
    const visible = eventHub.publish({
      kind: 'session-transport',
      sessionId: 'queen-session',
      event: { type: 'agent_start', runId: 'run-visible', timestamp: 301 },
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
})
