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

describe('Local Session server', () => {
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

  it('negotiates, authenticates, dispatches commands, and streams Host events on one socket', async () => {
    const endpoint = path.join(temporaryRoot, 'host.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const authenticate = vi.fn(async () => ({ callerId: 'local-user' }))
    const dispatch = vi.fn(async (input) => ({ accepted: true, echo: input.payload }))
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate,
      dispatch,
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)

    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2, 1],
        clientKind: 'cli',
        clientVersion: 'test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      accepted: true,
      revision: 2,
      hostInstanceId: 'host-current',
    })
    expect(authenticate).toHaveBeenCalledOnce()
    expect(liveness.ownerCount('client')).toBe(1)

    client.write(
      encodeLocalSessionFrame({
        kind: 'command',
        requestId: 'request-command',
        payload: { operation: 'status', sessionId: 'session-target' },
      }),
    )
    await expect(reader.next()).resolves.toEqual({
      kind: 'response',
      requestId: 'request-command',
      payload: {
        accepted: true,
        echo: { operation: 'status', sessionId: 'session-target' },
      },
    })
    expect(dispatch).toHaveBeenCalledWith({
      caller: { callerId: 'local-user' },
      negotiatedRevision: 2,
      eventCursor: { hostInstanceId: 'host-current', sequence: 0 },
      payload: { operation: 'status', sessionId: 'session-target' },
      signal: expect.any(AbortSignal),
    })

    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'request-subscribe',
        after: eventHub.cursor(),
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'subscribed',
      requestId: 'request-subscribe',
    })
    expect(liveness.ownerCount('subscription')).toBe(1)

    eventHub.publish({
      kind: 'session-list-changed',
      sessionId: 'session-created',
      change: 'created',
    })
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'event',
      event: {
        payload: {
          kind: 'session-list-changed',
          sessionId: 'session-created',
          change: 'created',
        },
      },
    })

    client.destroy()
    for (let attempt = 0; attempt < 20 && liveness.ownerCount() > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(liveness.ownerCount()).toBe(0)
  })

  it('rejects authentication failure without acquiring a client liveness owner', async () => {
    const endpoint = path.join(temporaryRoot, 'host-auth.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => {
        throw new Error('Credential rejected.')
      },
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)

    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'mcp',
        clientVersion: 'test',
      }),
    )

    await expect(reader.next()).resolves.toMatchObject({
      kind: 'error',
      code: 'authentication_failed',
    })
    expect(liveness.ownerCount()).toBe(0)
  })

  it('runs the command contract over the immediately previous transport revision', async () => {
    const endpoint = path.join(temporaryRoot, 'host-previous.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const dispatch = vi.fn(async () => ({ compatible: true }))
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch,
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'previous',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true, revision: 2 })
    client.write(
      encodeLocalSessionFrame({ kind: 'command', requestId: 'previous-command', payload: {} }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'response',
      requestId: 'previous-command',
      payload: { compatible: true },
    })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ negotiatedRevision: 2 }))
  })

  it('authenticates a newer client, reports blockers, and requests a safe drain', async () => {
    const endpoint = path.join(temporaryRoot, 'host-upgrade.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const releaseRun = liveness.acquire('run')
    const authenticate = vi.fn(async () => ({ callerId: 'local-user:trusted' }))
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate,
      describeUpgradeBlockers: async () => ({
        blockingRuns: [{ sessionId: 'session-live', runId: 'run-live' }],
        blockingOperations: [],
      }),
      requestUpgradeDrain: () => liveness.requestDrain('upgrade'),
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [4],
        clientKind: 'gui',
        clientVersion: 'future',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      accepted: false,
      code: 'host_upgrade_pending',
      blockingRuns: [{ sessionId: 'session-live', runId: 'run-live' }],
    })
    expect(authenticate).toHaveBeenCalledOnce()
    expect(liveness.isDraining()).toBe(true)
    expect(requestShutdown).not.toHaveBeenCalled()

    releaseRun()
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('does not let a restricted profile request a host upgrade drain', async () => {
    const endpoint = path.join(temporaryRoot, 'profile.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const requestUpgradeDrain = vi.fn()
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({
        callerId: 'profile:readonly',
        profileAuthority: {
          profileId: 'readonly',
          profileName: 'readonly',
          capabilities: ['sessions:read'],
          scope: { all: true },
          authorizationCeiling: 'ask-for-approval',
        },
      }),
      requestUpgradeDrain,
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [999],
        clientKind: 'mcp',
        clientVersion: 'untrusted',
      }),
    )

    await expect(reader.next()).resolves.toMatchObject({
      accepted: false,
      code: 'incompatible_protocol',
    })
    expect(requestUpgradeDrain).not.toHaveBeenCalled()
    expect(liveness.isDraining()).toBe(false)
  })
})
