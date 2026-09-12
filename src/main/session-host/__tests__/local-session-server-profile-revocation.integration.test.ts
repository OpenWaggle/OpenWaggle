import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

function cursorFromResponse(frame: unknown) {
  if (typeof frame !== 'object' || frame === null) throw new Error('Expected a response frame.')
  const payload = Reflect.get(frame, 'payload')
  if (typeof payload !== 'object' || payload === null)
    throw new Error('Expected a response payload.')
  const cursor = Reflect.get(payload, 'cursor')
  if (typeof cursor !== 'object' || cursor === null) throw new Error('Expected an event cursor.')
  const hostInstanceId = Reflect.get(cursor, 'hostInstanceId')
  const sequence = Reflect.get(cursor, 'sequence')
  if (typeof hostInstanceId !== 'string' || typeof sequence !== 'number') {
    throw new Error('Expected a valid event cursor.')
  }
  return { hostInstanceId, sequence }
}

function within<T>(promise: Promise<T>, stage: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out while ${stage}.`)), 1_000),
    ),
  ])
}

function connectHalfOpen(endpoint: string) {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ path: endpoint, allowHalfOpen: true })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

describe('Local Session server profile revocation', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-host-revoke-'))
  })

  afterEach(async () => {
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('disconnects every live connection for a profile after revocation is acknowledged', async () => {
    const endpoint = path.join(temporaryRoot, 'host-revoke.sock')
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
        callerId: 'profile:worker',
        profileAuthority: {
          profileId: 'worker',
          profileName: 'worker',
          capabilities: ['sessions:read'],
          scope: { all: true },
          authorizationCeiling: 'ask-for-approval',
        },
      }),
      dispatch: async ({ eventCursor, payload }) =>
        typeof payload === 'object' &&
        payload !== null &&
        Reflect.get(payload, 'operation') === 'snapshot'
          ? { cursor: eventCursor }
          : {
              contract: 'local-access-v1',
              response: {
                outcome: {
                  effect: 'profile-revoked',
                  profile: { id: 'worker', name: 'worker' },
                },
              },
            },
      profileInvalidationCloseTimeoutMs: 25,
    })
    const first = await connectLocalSessionTestClient(endpoint)
    const second = await connectHalfOpen(endpoint)
    const firstReader = new TestFrameReader(first)
    const secondReader = new TestFrameReader(second)
    const hello = encodeLocalSessionFrame({
      protocol: 'openwaggle-local-session',
      supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
      clientKind: 'cli',
      clientVersion: 'test',
    })
    first.write(hello)
    second.write(hello)
    await within(
      Promise.all([firstReader.next(), secondReader.next()]),
      'authenticating old sockets',
    )
    first.write(
      encodeLocalSessionFrame({
        kind: 'command',
        requestId: 'snapshot-cursor',
        payload: { operation: 'snapshot' },
      }),
    )
    const oldCursor = cursorFromResponse(
      await within(firstReader.next(), 'receiving the snapshot cursor'),
    )
    const firstClosed = new Promise<void>((resolve) => first.once('close', () => resolve()))
    const secondEnded = new Promise<void>((resolve) => second.once('end', () => resolve()))

    first.write(
      encodeLocalSessionFrame({
        kind: 'command',
        requestId: 'revoke-profile',
        payload: { operation: 'revoke' },
      }),
    )

    await expect(
      within(firstReader.next(), 'receiving the rotation response'),
    ).resolves.toMatchObject({
      kind: 'response',
      requestId: 'revoke-profile',
    })
    await within(Promise.all([firstClosed, secondEnded]), 'closing rotated sockets')
    for (let attempt = 0; attempt < 100 && liveness.ownerCount() > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(liveness.ownerCount()).toBe(0)
    second.destroy()

    const replacement = await connectLocalSessionTestClient(endpoint)
    const replacementReader = new TestFrameReader(replacement)
    replacement.write(hello)
    await within(replacementReader.next(), 'authenticating the replacement socket')
    replacement.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'resume-revoked-view',
        after: oldCursor,
      }),
    )
    await expect(
      within(replacementReader.next(), 'rejecting the revoked replay view'),
    ).resolves.toMatchObject({
      kind: 'resync-required',
      requestId: 'resume-revoked-view',
      reason: 'cursor-expired',
    })
    replacement.destroy()
  })

  it('disconnects old authenticated sockets after rotation and accepts only the new secret', async () => {
    const endpoint = path.join(temporaryRoot, 'host-rotate.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const oldCredential = 'B'.repeat(43)
    const newCredential = 'C'.repeat(43)
    let currentCredential = oldCredential
    const authority = {
      callerId: 'profile:worker',
      profileAuthority: {
        profileId: 'worker',
        profileName: 'worker',
        capabilities: ['sessions:read'] as const,
        scope: { all: true },
        authorizationCeiling: 'ask-for-approval' as const,
      },
    }
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async (hello) => {
        if (hello.profile !== 'worker' || hello.credential !== currentCredential) {
          throw new Error('invalid credential')
        }
        return authority
      },
      dispatch: async () => {
        currentCredential = newCredential
        return {
          contract: 'local-access-v1',
          response: {
            outcome: { effect: 'profile-rotated', profile: { id: 'worker', name: 'worker' } },
          },
        }
      },
    })
    const hello = (credential: string) =>
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
        clientKind: 'cli',
        clientVersion: 'test',
        profile: 'worker',
        credential,
      })
    const first = await connectLocalSessionTestClient(endpoint)
    const second = await connectLocalSessionTestClient(endpoint)
    const firstReader = new TestFrameReader(first)
    const secondReader = new TestFrameReader(second)
    first.write(hello(oldCredential))
    second.write(hello(oldCredential))
    await within(
      Promise.all([firstReader.next(), secondReader.next()]),
      'authenticating old sockets',
    )
    const firstClosed = new Promise<void>((resolve) => first.once('close', () => resolve()))
    const secondClosed = new Promise<void>((resolve) => second.once('close', () => resolve()))
    first.write(
      encodeLocalSessionFrame({
        kind: 'command',
        requestId: 'rotate-profile',
        payload: { operation: 'rotate' },
      }),
    )
    await expect(
      within(firstReader.next(), 'receiving the rotation response'),
    ).resolves.toMatchObject({
      kind: 'response',
      requestId: 'rotate-profile',
    })
    await within(Promise.all([firstClosed, secondClosed]), 'closing rotated sockets')

    const stale = await connectLocalSessionTestClient(endpoint)
    const staleReader = new TestFrameReader(stale)
    stale.write(hello(oldCredential))
    await expect(
      within(staleReader.next(), 'rejecting the stale credential'),
    ).resolves.toMatchObject({
      kind: 'error',
      code: 'authentication_failed',
    })
    stale.destroy()

    const fresh = await connectLocalSessionTestClient(endpoint)
    const freshReader = new TestFrameReader(fresh)
    fresh.write(hello(newCredential))
    await expect(
      within(freshReader.next(), 'accepting the fresh credential'),
    ).resolves.toMatchObject({ accepted: true })
    fresh.destroy()
  })
})
