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
import { writeLocalSessionSocketFrame } from '../local-session-server-frame'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session admission backpressure', () => {
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

  it.each(['update', 'revoke'] as const)(
    'disconnects a stalled subscriber so a profile %s fence drains within its bound',
    async (mutation) => {
      const endpoint = path.join(temporaryRoot, 'backpressured-fence.sock')
      const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
      const liveness = new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      })
      let eventWriteStarted!: () => void
      const eventWrite = new Promise<void>((resolve) => {
        eventWriteStarted = resolve
      })
      handle = await listenLocalSessionServer(endpoint, {
        hostInstanceId: 'host-current',
        eventHub,
        liveness,
        profileAdmissionDrainTimeoutMs: 25,
        writeFrame: async (input) => {
          if (
            typeof input.value !== 'object' ||
            input.value === null ||
            Reflect.get(input.value, 'kind') !== 'event'
          ) {
            return writeLocalSessionSocketFrame(input)
          }
          eventWriteStarted()
          await new Promise<void>((_resolve, reject) => {
            input.signal.addEventListener(
              'abort',
              () => reject(new Error('Stalled write aborted.')),
              { once: true },
            )
          })
        },
        authenticate: async () => ({
          callerId: 'profile:mutable',
          profileAuthority: {
            profileId: 'mutable',
            profileName: 'mutable',
            capabilities: ['sessions:discover'],
            scope: { sessionIds: ['session-allowed'] },
            authorizationCeiling: 'ask-for-approval',
          },
          eventAdmissionSessionIds: ['session-allowed'],
        }),
        authorizeEvent: async () => true,
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
      client.write(
        encodeLocalSessionFrame({
          kind: 'subscribe',
          requestId: 'request-subscribe',
        }),
      )
      await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })

      const closed = new Promise<void>((resolve) => client?.once('close', () => resolve()))
      eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-allowed',
        stateRevision: 1,
        operation: 'message',
      })
      await eventWrite

      await expect(fenceLocalSessionProfileAdmissions('mutable')).resolves.toBeUndefined()
      if (mutation === 'update') {
        await refreshLocalSessionProfileAdmissions('mutable', { consumeExistingFence: true })
      } else {
        disconnectLocalSessionProfile('mutable')
      }
      await expect(closed).resolves.toBeUndefined()
    },
  )
})
