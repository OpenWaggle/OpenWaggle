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
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session command admission fences', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null

  beforeEach(async () => {
    handle = null
    client = null
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-command-admission-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('does not dispatch a stale command between the profile fence and refreshed policy', async () => {
    const endpoint = path.join(temporaryRoot, 'host.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    let liveCapabilities: readonly ['sessions:message'] | readonly [] = ['sessions:message']
    const dispatchedCapabilities: (readonly string[])[] = []
    const caller = () => ({
      callerId: 'profile:mutable',
      profileAuthority: {
        profileId: 'mutable',
        profileName: 'mutable',
        capabilities: liveCapabilities,
        scope: { sessionIds: ['session-allowed'] },
        authorizationCeiling: 'ask-for-approval' as const,
      },
      eventAdmissionSessionIds: ['session-allowed'],
    })
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => caller(),
      refreshCaller: async () => caller(),
      dispatch: async ({ caller: dispatchedCaller }) => {
        dispatchedCapabilities.push(dispatchedCaller.profileAuthority?.capabilities ?? [])
        return { accepted: true }
      },
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

    await fenceLocalSessionProfileAdmissions('mutable')
    client.write(
      encodeLocalSessionFrame({
        kind: 'command',
        requestId: 'stale-command',
        payload: { contract: 'test-command' },
      }),
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(dispatchedCapabilities).toEqual([])

    liveCapabilities = []
    await refreshLocalSessionProfileAdmissions('mutable', { consumeExistingFence: true })
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'response',
      requestId: 'stale-command',
    })
    expect(dispatchedCapabilities).toEqual([[]])
  })

  it('allows a profile to revoke itself without waiting on its own command reader', async () => {
    const endpoint = path.join(temporaryRoot, 'self-revoke.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const authenticatedCaller = {
      callerId: 'profile:mutable',
      profileAuthority: {
        profileId: 'mutable',
        profileName: 'mutable',
        capabilities: [],
        scope: { sessionIds: ['session-allowed'] },
        authorizationCeiling: 'ask-for-approval' as const,
      },
      eventAdmissionSessionIds: ['session-allowed'],
    }
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => authenticatedCaller,
      refreshCaller: async () => authenticatedCaller,
      dispatch: async () => {
        await fenceLocalSessionProfileAdmissions('mutable')
        return {
          contract: 'local-access-v1',
          response: {
            outcome: { effect: 'profile-revoked', profile: { id: 'mutable' } },
          },
        }
      },
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
        kind: 'command',
        requestId: 'self-revoke',
        payload: {
          contract: 'local-access-v1',
          request: {
            contractVersion: 1,
            requestId: 'self-revoke',
            idempotencyKey: 'self-revoke-key',
            command: { operation: 'revoke', profileName: 'mutable' },
          },
        },
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'response',
      requestId: 'self-revoke',
    })
  })

  it.each(['update', 'revoke'] as const)(
    'aborts a long wait before a concurrent profile %s drains its admission fence',
    async (operation) => {
      const endpoint = path.join(temporaryRoot, `${operation[0]}.sock`)
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
          capabilities: ['sessions:read'] as const,
          scope: { sessionIds: ['session-allowed'] },
          authorizationCeiling: 'ask-for-approval' as const,
        },
        eventAdmissionSessionIds: ['session-allowed'],
      }
      let markDispatchStarted: (() => void) | undefined
      let markDispatchAborted: (() => void) | undefined
      const dispatchStarted = new Promise<void>((resolve) => {
        markDispatchStarted = resolve
      })
      const dispatchAborted = new Promise<void>((resolve) => {
        markDispatchAborted = resolve
      })
      handle = await listenLocalSessionServer(endpoint, {
        hostInstanceId: 'host-current',
        eventHub,
        liveness,
        authenticate: async () => caller,
        refreshCaller: async () => caller,
        dispatch: async ({ signal }) =>
          new Promise((_resolve, reject) => {
            markDispatchStarted?.()
            const abort = () => {
              markDispatchAborted?.()
              reject(signal.reason)
            }
            if (signal.aborted) abort()
            else signal.addEventListener('abort', abort, { once: true })
          }),
      })
      client = await connectLocalSessionTestClient(endpoint)
      const connectionClosed = new Promise<void>((resolve) => client?.once('close', resolve))
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
          kind: 'command',
          requestId: 'long-wait',
          payload: { contract: 'test-long-wait' },
        }),
      )
      await dispatchStarted

      const drained = fenceLocalSessionProfileAdmissions('mutable')
      await dispatchAborted
      await drained
      if (operation === 'update') {
        await refreshLocalSessionProfileAdmissions('mutable', { consumeExistingFence: true })
        await expect(reader.next()).resolves.toMatchObject({
          kind: 'error',
          requestId: 'long-wait',
          code: 'profile_admission_changed',
          retryable: true,
        })
      } else {
        disconnectLocalSessionProfile('mutable')
        await connectionClosed
      }
    },
  )
})
