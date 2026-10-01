import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FollowUpEditHoldRepository } from '../../ports/follow-up-edit-hold-repository'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { readQueue } from '../sqlite-session-query-details'
import {
  activeRunWithQueuedFollowUp,
  edit,
  FOLLOW_UP,
  followUpEditLayer,
  HOLD,
  resetFollowUpEditRequests,
  SESSION,
  settleRun,
  USER,
} from './sqlite-follow-up-edit-hold.test-support'

let tmpRoot = ''

function layer(name: string) {
  return followUpEditLayer(tmpRoot, name)
}

describe('Follow-up edit holds in SQLite', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-edit-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('holds delivery across Run settlement and delivers the edited text on save', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* activeRunWithQueuedFollowUp
        const begun = yield* edit({
          operation: 'queue-edit-begin',
          sessionId: SESSION,
          followUpId: FOLLOW_UP,
        })
        const settled = yield* settleRun()
        const sql = yield* SqlClient.SqlClient
        const afterSettle = yield* loadSessionControlState(sql, SESSION)
        const saved = yield* edit({
          operation: 'queue-edit-save',
          sessionId: SESSION,
          followUpId: FOLLOW_UP,
          holdId: HOLD,
          expectedQueueRevision: afterSettle.followUpQueue.revision,
          input: { text: 'Edited', attachmentIds: [] },
        })
        const afterSave = yield* loadSessionControlState(sql, SESSION)
        return { begun, settled, afterSettle, saved, afterSave }
      }).pipe(Effect.provide(layer('settle.sqlite'))),
    )

    expect(result.begun.outcome).toMatchObject({
      operation: 'queue-edit-begin',
      effect: 'follow-up-edit-held',
      followUpId: FOLLOW_UP,
      holdId: HOLD,
    })
    expect(result.settled).toMatchObject({ accepted: true })
    expect(result.settled).not.toHaveProperty('scheduled')
    expect(result.afterSettle.run).toEqual({ state: 'idle' })
    expect(result.afterSettle.followUpQueue.items[0]?.editHold?.holdId).toBe(HOLD)
    expect(result.saved.outcome).toMatchObject({
      operation: 'queue-edit-save',
      effect: 'started-run',
      followUpId: FOLLOW_UP,
    })
    expect(result.afterSave.run).toMatchObject({
      state: 'starting',
      intent: { text: 'Edited', thinkingLevel: 'high', callerId: USER },
    })
    expect(result.afterSave.followUpQueue.items).toEqual([])
  })

  it('reports holds and editability in the queue list for the holder only', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* activeRunWithQueuedFollowUp
        yield* edit({ operation: 'queue-edit-begin', sessionId: SESSION, followUpId: FOLLOW_UP })
        const sql = yield* SqlClient.SqlClient
        const queueRequest = {
          contractVersion: 2,
          requestId: 'queue',
          query: { operation: 'queue-list', sessionId: SESSION, includeBodies: true },
        } as const
        const holder = yield* readQueue(sql, queueRequest, { callerId: USER, desktopUser: true })
        const agent = yield* readQueue(sql, queueRequest, {
          callerId: 'session-agent:queen:run',
          desktopUser: false,
        })
        const held = yield* (yield* FollowUpEditHoldRepository).heldSessions()
        return { holder, agent, held }
      }).pipe(Effect.provide(layer('queue-list.sqlite'))),
    )

    expect(result.holder.outcome).toMatchObject({
      operation: 'queue-list',
      items: [
        {
          followUpId: FOLLOW_UP,
          editable: true,
          attachments: [],
          editHold: { holdId: HOLD, holderIsCaller: true },
        },
      ],
    })
    expect(result.agent.outcome).toMatchObject({
      items: [{ editable: false, editHold: { holderIsCaller: false } }],
    })
    expect(JSON.stringify(result.agent.outcome)).not.toContain(HOLD)
    expect(result.held.has(SESSION)).toBe(true)
  })

  it('refuses edits from callers other than the desktop user and of other callers’ Follow-ups', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* activeRunWithQueuedFollowUp
        const fromAgent = yield* edit(
          { operation: 'queue-edit-begin', sessionId: SESSION, followUpId: FOLLOW_UP },
          'local-user:machine',
        )
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_follow_ups
          SET intent_json = json_set(intent_json, '$.callerId', ${'local-user:machine'})
          WHERE id = ${FOLLOW_UP}
        `
        const othersFollowUp = yield* edit({
          operation: 'queue-edit-begin',
          sessionId: SESSION,
          followUpId: FOLLOW_UP,
        })
        return { fromAgent, othersFollowUp }
      }).pipe(Effect.provide(layer('callers.sqlite'))),
    )

    expect(result.fromAgent.outcome).toMatchObject({
      effect: 'rejected',
      code: 'follow_up_edit_requires_desktop_user',
    })
    expect(result.othersFollowUp.outcome).toMatchObject({
      effect: 'rejected',
      code: 'follow_up_not_editable',
    })
  })

  it('renews live holds, refuses expired ones, and releases expired holds so the queue delivers', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* activeRunWithQueuedFollowUp
        yield* edit({ operation: 'queue-edit-begin', sessionId: SESSION, followUpId: FOLLOW_UP })
        const holds = yield* FollowUpEditHoldRepository
        const key = { sessionId: SESSION, followUpId: FOLLOW_UP, holdId: HOLD }
        const renewed = yield* holds.renew({ ...key, holderCallerId: USER })
        const otherCaller = yield* holds.renew({ ...key, holderCallerId: 'local-user:machine' })
        yield* settleRun()
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE temp.session_follow_up_edit_holds SET expires_at = ${1}`
        const afterExpiry = yield* loadSessionControlState(sql, SESSION)
        const renewedAfterExpiry = yield* holds.renew({ ...key, holderCallerId: USER })
        const expired = yield* holds.takeExpired()
        const kicked = yield* edit({
          operation: 'queue-edit-cancel',
          sessionId: SESSION,
          followUpId: FOLLOW_UP,
          holdId: HOLD,
        })
        return { renewed, otherCaller, afterExpiry, renewedAfterExpiry, expired, kicked }
      }).pipe(Effect.provide(layer('lease.sqlite'))),
    )

    expect(result.renewed).toBeGreaterThan(Date.now())
    expect(result.otherCaller).toBeUndefined()
    expect(result.afterExpiry.followUpQueue.items[0]?.editHold).toBeUndefined()
    expect(result.renewedAfterExpiry).toBeUndefined()
    expect(result.expired).toEqual([
      { sessionId: SESSION, followUpId: FOLLOW_UP, holdId: HOLD, holderCallerId: USER },
    ])
    expect(result.kicked.outcome).toMatchObject({
      operation: 'queue-edit-cancel',
      effect: 'started-run',
      followUpId: FOLLOW_UP,
    })
  })
})
