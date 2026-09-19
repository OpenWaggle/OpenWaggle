import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import type { SessionLifecycleResponse } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import {
  refreshAdmissionBeforeIdleLifecycleProjection,
  refreshAdmissionBeforeStartedLifecycleProjection,
} from '../../application/session-lifecycle-event-projection'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session lifecycle admission refresh', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-admission-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('releases the issuing reader before lifecycle projections refresh all profiles', async () => {
    const endpoint = path.join(temporaryRoot, 'l.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const caller = {
      callerId: 'profile:mutable',
      profileAuthority: {
        profileId: 'mutable',
        profileName: 'mutable',
        capabilities: ['sessions:spawn'] as const,
        scope: { sessionIds: ['session-allowed'] },
        authorizationCeiling: 'ask-for-approval' as const,
      },
      eventAdmissionSessionIds: ['session-allowed'],
    }
    let refreshCount = 0
    let dispatchCount = 0
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => caller,
      refreshCaller: async () => {
        refreshCount += 1
        return caller
      },
      profileAdmissionDrainTimeoutMs: 25,
      dispatch: async ({ releaseAdmissionReader }) => {
        dispatchCount += 1
        const response: SessionLifecycleResponse =
          dispatchCount === 1
            ? {
                contractVersion: 2,
                requestId: 'create-root',
                idempotencyKey: 'create-root-key',
                replayed: false,
                outcome: {
                  operation: 'create',
                  effect: 'created-root',
                  sessionId: 'created-session',
                  workspaceId: 'workspace-current',
                },
              }
            : {
                contractVersion: 2,
                requestId: 'launch-root',
                idempotencyKey: 'launch-root-key',
                replayed: false,
                outcome: {
                  operation: 'launch',
                  effect: 'launched-root',
                  sessionId: 'launched-session',
                  runId: 'run-current',
                  workspaceId: 'workspace-current',
                },
              }
        await Effect.runPromise(
          dispatchCount === 1
            ? refreshAdmissionBeforeIdleLifecycleProjection(response, releaseAdmissionReader)
            : refreshAdmissionBeforeStartedLifecycleProjection(response, releaseAdmissionReader),
        )
        return { contract: 'session-lifecycle-v2', response }
      },
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
        kind: 'command',
        requestId: 'create-root',
        payload: { contract: 'session-lifecycle-v2' },
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'response',
      requestId: 'create-root',
      payload: {
        contract: 'session-lifecycle-v2',
        response: { outcome: { effect: 'created-root' } },
      },
    })
    expect(refreshCount).toBe(1)
    expect(client.destroyed).toBe(false)

    client.write(
      encodeLocalSessionFrame({
        kind: 'command',
        requestId: 'launch-root',
        payload: { contract: 'session-lifecycle-v2' },
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'response',
      requestId: 'launch-root',
      payload: {
        contract: 'session-lifecycle-v2',
        response: { outcome: { effect: 'launched-root' } },
      },
    })
    expect(refreshCount).toBe(2)
    expect(client.destroyed).toBe(false)
  })
})
