import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { describe, expect, it } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { LocalSessionEventCursorProjection } from '../local-session-event-cursor-projection'

function restrictedCaller(profileId: string): LocalSessionCallerIdentity {
  return {
    callerId: `profile:${profileId}`,
    profileAuthority: {
      profileId,
      profileName: profileId,
      capabilities: ['sessions:discover'],
      scope: { sessionIds: ['session-visible'] },
      authorizationCeiling: 'ask-for-approval',
    },
  }
}

describe('Local Session restricted event cursor projection', () => {
  it('leaves trusted local-user cursors unchanged', () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    const projection = new LocalSessionEventCursorProjection(hub)
    const internal = hub.cursor()

    expect(projection.expose({ callerId: 'local-user' }, internal)).toBe(internal)
    expect(projection.resolve({ callerId: 'local-user' }, internal)).toEqual({
      status: 'ready',
      cursor: internal,
    })
  })

  it('issues fresh opaque capabilities without exposing unchanged or hidden sequence progress', () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    const projection = new LocalSessionEventCursorProjection(hub)
    const caller = restrictedCaller('worker')
    const before = projection.expose(caller, hub.cursor())
    const unchanged = projection.expose(caller, hub.cursor())
    hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-hidden',
      stateRevision: 1,
      operation: 'message',
    })
    const afterHidden = projection.expose(caller, hub.cursor())

    expect([before, unchanged, afterHidden]).toEqual([
      { hostInstanceId: expect.not.stringContaining('host-internal'), sequence: 0 },
      { hostInstanceId: expect.any(String), sequence: 0 },
      { hostInstanceId: expect.any(String), sequence: 0 },
    ])
    expect(
      new Set([before.hostInstanceId, unchanged.hostInstanceId, afterHidden.hostInstanceId]).size,
    ).toBe(3)
    expect(projection.resolve(caller, before)).toMatchObject({
      status: 'ready',
      cursor: { hostInstanceId: expect.any(String), sequence: 0 },
    })
    expect(projection.resolve(caller, afterHidden)).toMatchObject({
      status: 'ready',
      cursor: { hostInstanceId: expect.any(String), sequence: 1 },
    })
  })

  it('rejects foreign, restarted, and forged capabilities with an opaque resync cursor', () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    const projection = new LocalSessionEventCursorProjection(hub)
    const firstCaller = restrictedCaller('first')
    const secondCaller = restrictedCaller('second')
    const foreign = projection.expose(firstCaller, hub.cursor())

    expect(projection.resolve(secondCaller, foreign)).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
      cursor: { sequence: 0 },
    })
    expect(
      projection.resolve(firstCaller, { hostInstanceId: 'unknown-host.cursor', sequence: 0 }),
    ).toMatchObject({
      status: 'resync-required',
      reason: 'host-restarted',
      cursor: { sequence: 0 },
    })
    expect(projection.resolve(firstCaller, { ...foreign, sequence: 1 })).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-ahead',
      cursor: { sequence: 0 },
    })
    const tokenStart = foreign.hostInstanceId.indexOf('.') + 1
    const originalCharacter = foreign.hostInstanceId[tokenStart]
    const replacementCharacter = originalCharacter === 'A' ? 'B' : 'A'
    const tamperedHostInstanceId = `${foreign.hostInstanceId.slice(
      0,
      tokenStart,
    )}${replacementCharacter}${foreign.hostInstanceId.slice(tokenStart + 1)}`
    expect(
      projection.resolve(firstCaller, {
        ...foreign,
        hostInstanceId: tamperedHostInstanceId,
      }),
    ).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
      cursor: { sequence: 0 },
    })
  })

  it('expires a scoped cursor only after its visible replay capacity is exceeded', () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    const projection = new LocalSessionEventCursorProjection(hub, {
      replayEventsPerAuthority: 2,
    })
    const caller = restrictedCaller('worker')
    const cursor = projection.expose(caller, hub.cursor())
    for (let stateRevision = 1; stateRevision <= 3; stateRevision += 1) {
      hub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-visible',
        stateRevision,
        operation: 'message',
      })
    }

    const resolution = projection.resolve(caller, cursor)
    expect(resolution.status).toBe('ready')
    if (resolution.status !== 'ready') return
    expect(hub.subscribeAfter(resolution.cursor)).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
    })
  })

  it('expires a scoped cursor when one visible event exceeds its replay byte cap', () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    const projection = new LocalSessionEventCursorProjection(hub, {
      replayBytesPerAuthority: 256,
    })
    const caller = restrictedCaller('worker')
    const cursor = projection.expose(caller, hub.cursor())
    hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-visible',
      stateRevision: 1,
      operation: 'x'.repeat(512),
    })

    const resolution = projection.resolve(caller, cursor)
    expect(resolution.status).toBe('ready')
    if (resolution.status !== 'ready') return
    expect(hub.subscribeAfter(resolution.cursor)).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
    })
  })

  it('bounds authority replay state independently of hidden event churn', () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    const projection = new LocalSessionEventCursorProjection(hub, {
      maxReplayAuthorities: 2,
      replayEventsPerAuthority: 2,
      replayBytesPerAuthority: 256,
    })
    const firstCaller = restrictedCaller('first')
    const secondCaller = restrictedCaller('second')
    const firstCursor = projection.expose(firstCaller, hub.cursor())
    const secondCursor = projection.expose(secondCaller, hub.cursor())

    for (let stateRevision = 1; stateRevision <= 20; stateRevision += 1) {
      hub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-hidden',
        stateRevision,
        operation: 'message',
      })
    }
    expect(projection.replayUsage()).toEqual({
      authorities: 2,
      entries: 0,
      bytes: 0,
      maxAuthorities: 2,
      maxEntries: 4,
      maxBytes: 512,
    })
    expect(projection.resolve(firstCaller, firstCursor).status).toBe('ready')

    projection.expose(restrictedCaller('third'), hub.cursor())
    expect(projection.replayUsage()).toMatchObject({
      authorities: 2,
      maxAuthorities: 2,
      maxEntries: 4,
      maxBytes: 512,
    })
    expect(projection.resolve(secondCaller, secondCursor)).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
    })
  })

  it('forces active subscriptions to resync when their authority replay state is evicted', async () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    const projection = new LocalSessionEventCursorProjection(hub, {
      maxReplayAuthorities: 1,
    })
    const firstCaller = restrictedCaller('first')
    const firstCursor = projection.expose(firstCaller, hub.cursor())
    const resolution = projection.resolve(firstCaller, firstCursor)
    expect(resolution.status).toBe('ready')
    if (resolution.status !== 'ready') return
    const subscription = hub.subscribeAfter(resolution.cursor)
    expect(subscription.status).toBe('ready')
    if (subscription.status !== 'ready') return

    projection.expose(restrictedCaller('second'), hub.cursor())

    await expect(subscription.subscription.next()).resolves.toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
    })
  })

  it('rotates matching profile cursors while preserving other authority views', () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-internal' })
    const projection = new LocalSessionEventCursorProjection(hub)
    const firstCaller = restrictedCaller('first')
    const secondCaller = restrictedCaller('second')
    const firstCursor = projection.expose(firstCaller, hub.cursor())
    const secondCursor = projection.expose(secondCaller, hub.cursor())

    projection.rotateProfile('first')

    expect(projection.resolve(firstCaller, firstCursor)).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
    })
    expect(projection.resolve(secondCaller, secondCursor).status).toBe('ready')
  })
})
