import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { isRecord } from '../local-session-client-connection'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

function cursorFrom(frame: unknown) {
  if (!isRecord(frame)) throw new Error('Expected a Local Session frame.')
  const candidate = frame.kind === 'response' && isRecord(frame.payload) ? frame.payload : frame
  if (
    !isRecord(candidate.cursor) ||
    typeof candidate.cursor.hostInstanceId !== 'string' ||
    typeof candidate.cursor.sequence !== 'number'
  ) {
    throw new Error('Expected a Local Session event cursor.')
  }
  return {
    hostInstanceId: candidate.cursor.hostInstanceId,
    sequence: candidate.cursor.sequence,
  }
}

function subscriptionIdFrom(frame: unknown) {
  if (!isRecord(frame) || typeof frame.subscriptionId !== 'string') {
    throw new Error('Expected a Local Session subscription frame.')
  }
  return frame.subscriptionId
}

async function negotiate(client: Socket, reader: TestFrameReader, clientVersion: string) {
  client.write(
    encodeLocalSessionFrame({
      protocol: 'openwaggle-local-session',
      supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
      clientKind: 'cli',
      clientVersion,
    }),
  )
  await expect(reader.next()).resolves.toMatchObject({
    accepted: true,
    revision: LOCAL_SESSION_CURRENT_REVISION,
  })
}

describe('Local Session restricted event cursors', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  const clients: Socket[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cursor-view-'))
  })

  afterEach(async () => {
    for (const client of clients) client.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('uses opaque resumable capabilities for query, subscribe, event, and resync cursors', async () => {
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    handle = await listenLocalSessionServer(path.join(temporaryRoot, 'restricted.sock'), {
      hostInstanceId: 'host-internal',
      eventHub,
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      authenticate: async () => ({
        callerId: 'profile:worker',
        profileAuthority: {
          profileId: 'worker',
          profileName: 'worker',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['session-visible'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['session-visible'],
      }),
      authorizeEvent: async (_caller, event) =>
        event.payload.kind !== 'semantic-discovery-readiness-changed' &&
        event.payload.sessionId === 'session-visible',
      dispatch: async ({ eventCursor }) => ({ cursor: eventCursor }),
    })

    const firstClient = await connectLocalSessionTestClient(handle.endpoint)
    clients.push(firstClient)
    const firstReader = new TestFrameReader(firstClient)
    await negotiate(firstClient, firstReader, 'first')
    firstClient.write(
      encodeLocalSessionFrame({ kind: 'command', requestId: 'snapshot-one', payload: {} }),
    )
    const firstCursor = cursorFrom(await firstReader.next())
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-hidden',
      stateRevision: 1,
      operation: 'message',
    })
    firstClient.write(
      encodeLocalSessionFrame({ kind: 'command', requestId: 'snapshot-two', payload: {} }),
    )
    const secondCursor = cursorFrom(await firstReader.next())

    expect(firstCursor).toEqual({ hostInstanceId: expect.any(String), sequence: 0 })
    expect(secondCursor).toEqual({ hostInstanceId: expect.any(String), sequence: 0 })
    expect(secondCursor.hostInstanceId).not.toBe(firstCursor.hostInstanceId)
    expect(firstCursor.hostInstanceId).not.toContain('host-internal')

    firstClient.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'subscribe',
        after: firstCursor,
      }),
    )
    const subscribed = await firstReader.next()
    const subscriptionId = subscriptionIdFrom(subscribed)
    expect(cursorFrom(subscribed)).toEqual({ hostInstanceId: expect.any(String), sequence: 0 })
    const visible = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-visible',
      stateRevision: 1,
      operation: 'message',
    })
    const delivery = await firstReader.next()
    expect(delivery).toMatchObject({
      kind: 'event',
      subscriptionId,
      event: {
        cursor: { hostInstanceId: expect.any(String), sequence: 0 },
        timestamp: visible.timestamp,
        payload: visible.payload,
      },
    })
    if (!isRecord(delivery) || !isRecord(delivery.event)) throw new Error('Expected an event.')
    const deliveredCursor = cursorFrom(delivery.event)

    const resumedClient = await connectLocalSessionTestClient(handle.endpoint)
    clients.push(resumedClient)
    const resumedReader = new TestFrameReader(resumedClient)
    await negotiate(resumedClient, resumedReader, 'resumed')
    resumedClient.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'resume',
        after: deliveredCursor,
      }),
    )
    await expect(resumedReader.next()).resolves.toMatchObject({ kind: 'subscribed' })

    resumedClient.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'forged',
        after: eventHub.cursor(),
      }),
    )
    const resync = await resumedReader.next()
    expect(resync).toMatchObject({
      kind: 'resync-required',
      requestId: 'forged',
      reason: 'host-restarted',
      cursor: { hostInstanceId: expect.any(String), sequence: 0 },
    })
    expect(cursorFrom(resync).hostInstanceId).not.toContain('host-internal')
  })

  it('replays visible events after hidden traffic clears the global replay window', async () => {
    const eventHub = new SessionHostEventHub({
      hostInstanceId: 'host-internal',
      replayCapacity: 2,
      replayByteCapacity: 512,
    })
    handle = await listenLocalSessionServer(path.join(temporaryRoot, 'isolated-replay.sock'), {
      hostInstanceId: 'host-internal',
      eventHub,
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      authenticate: async () => ({
        callerId: 'profile:worker',
        profileAuthority: {
          profileId: 'worker',
          profileName: 'worker',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['session-visible'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['session-visible'],
      }),
      authorizeEvent: async (_caller, event) =>
        event.payload.kind !== 'semantic-discovery-readiness-changed' &&
        event.payload.sessionId === 'session-visible',
      dispatch: async ({ eventCursor }) => ({ cursor: eventCursor }),
    })

    const client = await connectLocalSessionTestClient(handle.endpoint)
    clients.push(client)
    const reader = new TestFrameReader(client)
    await negotiate(client, reader, 'isolated-replay')
    client.write(encodeLocalSessionFrame({ kind: 'command', requestId: 'snapshot', payload: {} }))
    const cursor = cursorFrom(await reader.next())
    const visible = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-visible',
      stateRevision: 1,
      operation: 'message',
    })
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-hidden',
      stateRevision: 2,
      operation: 'x'.repeat(1_024),
    })
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-hidden',
      stateRevision: 3,
      operation: 'message',
    })

    client.write(encodeLocalSessionFrame({ kind: 'subscribe', requestId: 'resume', after: cursor }))
    const subscribed = await reader.next()
    expect(subscribed).toMatchObject({ kind: 'subscribed', requestId: 'resume' })
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'event',
      subscriptionId: subscriptionIdFrom(subscribed),
      event: {
        cursor: { hostInstanceId: expect.any(String), sequence: 0 },
        timestamp: visible.timestamp,
        payload: visible.payload,
      },
    })
  })

  it('intersects replay with requested Sessions and capability-specific visibility', async () => {
    const eventHub = new SessionHostEventHub({
      hostInstanceId: 'host-internal',
      subscriberCapacity: 1,
    })
    handle = await listenLocalSessionServer(path.join(temporaryRoot, 'filtered-replay.sock'), {
      hostInstanceId: 'host-internal',
      eventHub,
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      authenticate: async () => ({
        callerId: 'profile:worker',
        profileAuthority: {
          profileId: 'worker',
          profileName: 'worker',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['session-requested', 'session-other'] },
          authorizationCeiling: 'ask-for-approval',
        },
        eventAdmissionSessionIds: ['session-requested', 'session-other'],
      }),
      authorizeEvent: async () => true,
      dispatch: async ({ eventCursor }) => ({ cursor: eventCursor }),
    })

    const client = await connectLocalSessionTestClient(handle.endpoint)
    clients.push(client)
    const reader = new TestFrameReader(client)
    await negotiate(client, reader, 'filtered-replay')
    client.write(encodeLocalSessionFrame({ kind: 'command', requestId: 'snapshot', payload: {} }))
    const cursor = cursorFrom(await reader.next())
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-other',
      stateRevision: 1,
      operation: 'message',
    })
    eventHub.publish({
      kind: 'session-transport',
      sessionId: 'session-requested',
      event: { type: 'agent_start', runId: 'hidden-run', timestamp: 1 },
    })
    const visible = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-requested',
      stateRevision: 2,
      operation: 'message',
    })

    client.write(
      encodeLocalSessionFrame({
        kind: 'subscribe',
        requestId: 'resume-filtered',
        after: cursor,
        sessionIds: ['session-requested'],
      }),
    )
    const subscribed = await reader.next()
    expect(subscribed).toMatchObject({ kind: 'subscribed', requestId: 'resume-filtered' })
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'event',
      subscriptionId: subscriptionIdFrom(subscribed),
      event: { payload: visible.payload },
    })
  })
})
