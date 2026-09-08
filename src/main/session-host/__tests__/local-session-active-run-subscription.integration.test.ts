import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
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
        supportedRevisions: [7],
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
})
