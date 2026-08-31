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

describe('Local Session subscription admission refresh', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-subscription-refresh-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps refresh fenced until in-flight event authorization and delivery finish', async () => {
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const authorizationStarted = Promise.withResolvers<void>()
    const releaseAuthorization = Promise.withResolvers<void>()
    let authorized = true
    const authorizeEvent = vi.fn(async () => {
      authorizationStarted.resolve()
      await releaseAuthorization.promise
      return authorized
    })
    handle = await listenLocalSessionServer(path.join(temporaryRoot, 'refresh.sock'), {
      hostInstanceId: 'host-current',
      eventHub,
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      authenticate: async () => ({
        callerId: 'profile:mutable',
        profileAuthority: {
          profileId: 'mutable',
          profileName: 'mutable',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['worker'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['worker'],
      }),
      refreshCaller: async (caller) => ({ ...caller, eventAdmissionSessionIds: [] }),
      authorizeEvent,
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(path.join(temporaryRoot, 'refresh.sock'))
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
        requestId: 'subscribe',
        after: eventHub.cursor(),
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })

    const event = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'worker',
      stateRevision: 1,
      operation: 'message',
    })
    await authorizationStarted.promise
    authorized = false
    let refreshCompleted = false
    const refresh = refreshLocalSessionProfileAdmissions('mutable').then(() => {
      refreshCompleted = true
    })
    await Promise.resolve()
    expect(refreshCompleted).toBe(false)

    releaseAuthorization.resolve()
    await expect(reader.next()).resolves.toEqual({
      kind: 'cursor-advanced',
      subscriptionId: expect.any(String),
      cursor: event.cursor,
    })
    await refresh
    expect(refreshCompleted).toBe(true)
  })
})
