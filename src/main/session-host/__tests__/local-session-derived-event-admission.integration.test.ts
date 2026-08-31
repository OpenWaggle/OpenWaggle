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

describe('Local Session derived event admission', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-derived-event-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('delivers exact derived read events after over-capacity base-denied traffic', async () => {
    const endpoint = path.join(temporaryRoot, 'derived-read.sock')
    const eventHub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      subscriberCapacity: 1,
    })
    const authorizeEvent = vi.fn(async () => true)
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      authenticate: async () => ({
        callerId: 'profile:queen',
        profileAuthority: {
          profileId: 'queen',
          profileName: 'queen',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['queen-session'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['queen-session'],
        derivedSessionAuthorities: [
          {
            sessionId: 'worker-session',
            capabilities: ['sessions:read'],
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
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true })
    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'request-subscribe',
        after: eventHub.cursor(),
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })

    const firstDenied = eventHub.publish({
      kind: 'session-transport',
      sessionId: 'queen-session',
      event: { type: 'agent_start', runId: 'run-1', timestamp: 1 },
    })
    let lastDenied = firstDenied
    for (let sequence = 2; sequence <= 300; sequence += 1) {
      lastDenied = eventHub.publish({
        kind: 'session-transport',
        sessionId: 'queen-session',
        event: { type: 'agent_start', runId: `run-${sequence}`, timestamp: sequence },
      })
    }
    const visible = eventHub.publish({
      kind: 'session-transport',
      sessionId: 'worker-session',
      event: { type: 'agent_start', runId: 'run-visible', timestamp: 301 },
    })

    await expect(reader.next()).resolves.toMatchObject({ cursor: firstDenied.cursor })
    await expect(reader.next()).resolves.toMatchObject({ cursor: lastDenied.cursor })
    await expect(reader.next()).resolves.toEqual({
      kind: 'event',
      subscriptionId: expect.any(String),
      event: visible,
    })
    expect(authorizeEvent).toHaveBeenCalledOnce()
    expect(authorizeEvent).toHaveBeenCalledWith(expect.any(Object), visible)
  })
})
