import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { refreshLocalSessionProfileAdmissions } from '../local-session-profile-invalidation'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session active-run subscriptions', () => {
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

  it('retries active-run admission when authority refresh races subscription setup', async () => {
    const endpoint = path.join(temporaryRoot, 'active.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    let releaseFirstAuthorization!: () => void
    const firstAuthorizationGate = new Promise<void>((resolve) => {
      releaseFirstAuthorization = resolve
    })
    let authorizationCall = 0
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({
        callerId: 'profile:mutable',
        profileAuthority: {
          profileId: 'mutable',
          profileName: 'mutable',
          capabilities: ['sessions:read'],
          scope: { sessionIds: ['session-running'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['session-running'],
      }),
      refreshCaller: async (caller) => ({
        ...caller,
        profileAuthority: caller.profileAuthority
          ? { ...caller.profileAuthority, capabilities: ['sessions:discover'] }
          : undefined,
      }),
      snapshotActiveRuns: () => [
        {
          sessionId: SessionId('session-running'),
          model: SupportedModelId('provider/model'),
          activity: 'agent-run',
          activityEvents: [],
          mode: 'classic',
          startedAt: 1,
          messageId: 'message-running',
          parts: [{ type: 'text', text: 'stale' }],
        },
      ],
      authorizeActiveRun: async (caller) => {
        authorizationCall += 1
        if (authorizationCall === 1) await firstAuthorizationGate
        return caller.profileAuthority?.capabilities.includes('sessions:read') ?? false
      },
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
    client.write(encodeLocalSessionFrame({ kind: 'subscribe', requestId: 'request-subscribe' }))
    await vi.waitFor(() => expect(authorizationCall).toBe(1))

    const refresh = refreshLocalSessionProfileAdmissions('mutable')
    releaseFirstAuthorization()
    const subscribed = await reader.next()
    await refresh

    expect(subscribed).toMatchObject({
      kind: 'subscribed',
      requestId: 'request-subscribe',
      activeRuns: [],
    })
    expect(authorizationCall).toBe(2)
  })

  it('closes a provisional watch when active-run authorization rejects', async () => {
    const endpoint = path.join(temporaryRoot, 'failed-snapshot.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const authorizeActiveRun = vi
      .fn()
      .mockRejectedValueOnce(new Error('Snapshot authorization unavailable'))
      .mockResolvedValue(true)
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      maxSubscriptionsGlobal: 1,
      authenticate: async () => ({ callerId: 'local-user' }),
      snapshotActiveRuns: () => [
        {
          sessionId: SessionId('session-running'),
          model: SupportedModelId('provider/model'),
          activity: 'agent-run',
          activityEvents: [],
          mode: 'classic',
          startedAt: 1,
          messageId: 'message-running',
          parts: [{ type: 'text', text: 'running' }],
        },
      ],
      authorizeActiveRun,
      dispatch: async () => ({ accepted: true }),
    })

    const subscribe = async (requestId: string) => {
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
      client.write(encodeLocalSessionFrame({ kind: 'subscribe', requestId }))
      return reader.next()
    }

    await expect(subscribe('rejected')).resolves.toMatchObject({
      kind: 'error',
      code: 'protocol_error',
    })
    await vi.waitFor(() => expect(eventHub.subscriberCount()).toBe(0))
    client?.destroy()

    await expect(subscribe('replacement')).resolves.toMatchObject({
      kind: 'subscribed',
      requestId: 'replacement',
    })
    expect(eventHub.subscriberCount()).toBe(1)
  })

  it('closes a provisional watch when its connection closes during authorization', async () => {
    const endpoint = path.join(temporaryRoot, 'closed-snapshot.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    let releaseAuthorization!: () => void
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve
    })
    let authorizationStarted!: () => void
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve
    })
    let authorizationCall = 0
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      maxSubscriptionsGlobal: 1,
      authenticate: async () => ({ callerId: 'local-user' }),
      snapshotActiveRuns: () => [
        {
          sessionId: SessionId('session-running'),
          model: SupportedModelId('provider/model'),
          activity: 'agent-run',
          activityEvents: [],
          mode: 'classic',
          startedAt: 1,
          messageId: 'message-running',
          parts: [{ type: 'text', text: 'running' }],
        },
      ],
      authorizeActiveRun: async () => {
        authorizationCall += 1
        if (authorizationCall === 1) {
          authorizationStarted()
          await authorizationGate
        }
        return true
      },
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
    client.write(encodeLocalSessionFrame({ kind: 'subscribe', requestId: 'disconnecting' }))
    await started
    expect(eventHub.subscriberCount()).toBe(1)

    const disconnected = client
    const closed = new Promise<void>((resolve) => disconnected.once('close', resolve))
    disconnected.destroy()
    await closed
    try {
      await vi.waitFor(() => expect(eventHub.subscriberCount()).toBe(0))
      client = await connectLocalSessionTestClient(endpoint)
      const replacement = new TestFrameReader(client)
      client.write(
        encodeLocalSessionFrame({
          protocol: 'openwaggle-local-session',
          supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
          clientKind: 'cli',
          clientVersion: 'test',
        }),
      )
      await expect(replacement.next()).resolves.toMatchObject({ accepted: true })
      client.write(encodeLocalSessionFrame({ kind: 'subscribe', requestId: 'replacement' }))
      await expect(replacement.next()).resolves.toMatchObject({
        kind: 'subscribed',
        requestId: 'replacement',
      })
      expect(eventHub.subscriberCount()).toBe(1)
    } finally {
      releaseAuthorization()
    }
    await vi.waitFor(() => expect(eventHub.subscriberCount()).toBe(1))
  })
})
