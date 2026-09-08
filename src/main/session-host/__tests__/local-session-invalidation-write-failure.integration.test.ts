import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { LocalSessionOutboundCapacityError } from '../local-session-outbound-budget'
import { fenceLocalSessionProfileAdmissions } from '../local-session-profile-invalidation'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { writeLocalSessionSocketFrame } from '../local-session-server-frame'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

function within<T>(promise: Promise<T>, stage: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out while ${stage}.`)), 1_000),
    ),
  ])
}

function command(operation: 'rotate' | 'revoke') {
  return {
    contract: 'local-access-v1' as const,
    request: {
      contractVersion: 1 as const,
      requestId: `${operation}-profile`,
      idempotencyKey: `${operation}-profile-key`,
      command:
        operation === 'rotate'
          ? { operation, profileName: 'mutable', credential: 'A'.repeat(43) }
          : { operation, profileName: 'mutable' },
    },
  }
}

describe('Local Session invalidation response failures', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  const clients: Socket[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-invalidation-write-'))
  })

  afterEach(async () => {
    for (const client of clients) client.destroy()
    clients.length = 0
    if (handle) await handle.close()
    handle = null
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each([
    ['rotate', 'write failure'],
    ['revoke', 'write failure'],
    ['rotate', 'outbound capacity'],
    ['revoke', 'outbound capacity'],
    ['rotate', 'stalled backpressure'],
    ['revoke', 'stalled backpressure'],
  ] as const)(
    'disconnects all matching sockets after %s when its response hits %s',
    async (operation, failure) => {
      const endpoint = path.join(temporaryRoot, `${operation}-${failure[0]}.sock`)
      const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
      const liveness = new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      })
      const requestId = `${operation}-profile`
      handle = await listenLocalSessionServer(endpoint, {
        hostInstanceId: 'host-current',
        eventHub,
        liveness,
        authenticate: async () => ({
          callerId: 'profile:mutable',
          profileAuthority: {
            profileId: 'mutable',
            profileName: 'mutable',
            capabilities: [],
            scope: { all: true },
            authorizationCeiling: 'ask-for-approval',
          },
        }),
        dispatch: async () => {
          await fenceLocalSessionProfileAdmissions('mutable')
          return {
            contract: 'local-access-v1',
            response: {
              outcome: {
                effect: operation === 'rotate' ? 'profile-rotated' : 'profile-revoked',
                profile: { id: 'mutable', name: 'mutable' },
              },
            },
          }
        },
        writeFrame: async (input) => {
          if (
            typeof input.value === 'object' &&
            input.value !== null &&
            Reflect.get(input.value, 'kind') === 'response' &&
            Reflect.get(input.value, 'requestId') === requestId
          ) {
            if (failure === 'outbound capacity') input.socket.destroy()
            if (failure === 'stalled backpressure') return new Promise<void>(() => undefined)
            throw failure === 'outbound capacity'
              ? new LocalSessionOutboundCapacityError()
              : new Error('Forced response write failure.')
          }
          return writeLocalSessionSocketFrame(input)
        },
        profileInvalidationCloseTimeoutMs: 25,
      })

      const issuer = await connectLocalSessionTestClient(endpoint)
      const peer = await connectLocalSessionTestClient(endpoint)
      clients.push(issuer, peer)
      const issuerReader = new TestFrameReader(issuer)
      const peerReader = new TestFrameReader(peer)
      const hello = encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
        clientKind: 'cli',
        clientVersion: 'test',
      })
      issuer.write(hello)
      peer.write(hello)
      await within(Promise.all([issuerReader.next(), peerReader.next()]), 'authenticating sockets')
      const issuerClosed = new Promise<void>((resolve) => issuer.once('close', () => resolve()))
      const peerClosed = new Promise<void>((resolve) => peer.once('close', () => resolve()))

      issuer.write(
        encodeLocalSessionFrame({
          kind: 'command',
          requestId,
          payload: command(operation),
        }),
      )

      await within(Promise.all([issuerClosed, peerClosed]), 'invalidating matching sockets')
      for (let attempt = 0; attempt < 100 && liveness.ownerCount() > 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      expect(liveness.ownerCount()).toBe(0)
    },
  )
})
