import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { followUpEditLayer, idleQueue } from './sqlite-follow-up-edit-hold.test-support'
import {
  adopt,
  PROFILE,
  SESSION,
  STUCK_INTENT,
  startRunAndQueueStuckFollowUp,
  USER,
} from './sqlite-session-control-follow-up-adopt.test-support'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

describe('SQLite Session control: adopting a needs-attention Follow-up', () => {
  let tmpRoot = ''

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-adopt-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('re-authors it as the desktop user, keeping its author, without an override', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'adopt.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const revision = yield* startRunAndQueueStuckFollowUp()
        const stale = yield* adopt({
          key: 'stale',
          desktopUser: true,
          expectedQueueRevision: revision - 1,
        })
        const adopted = yield* adopt({
          key: 'adopt',
          desktopUser: true,
          expectedQueueRevision: revision,
        })
        const replayed = yield* adopt({
          key: 'adopt',
          desktopUser: true,
          expectedQueueRevision: revision,
        })
        const rows = yield* sql<{
          readonly delivery_state: string
          readonly attention_reason: string | null
          readonly intent_json: string
        }>`SELECT delivery_state, attention_reason, intent_json FROM session_follow_ups`
        return { stale, adopted, replayed, rows }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.stale.outcome).toMatchObject({
      effect: 'rejected',
      code: 'queue_revision_changed',
    })
    expect(result.adopted.outcome).toMatchObject({
      operation: 'queue-adopt',
      effect: 'queue-updated',
      followUpIds: ['follow-up-stuck'],
    })
    expect(result.replayed.replayed).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ delivery_state: 'pending', attention_reason: null })
    const intent: unknown = JSON.parse(result.rows[0]?.intent_json ?? 'null')
    expect(intent).toEqual({ ...STUCK_INTENT, callerId: USER, authorCallerId: PROFILE })
  })

  it('refuses every caller but the desktop user', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'refused.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const revision = yield* startRunAndQueueStuckFollowUp()
        // The same user through the CLI is not the desktop app.
        const refused = yield* adopt({
          key: 'cli',
          desktopUser: false,
          callerId: 'local-user',
          expectedQueueRevision: revision,
        })
        return { refused, state: yield* loadSessionControlState(sql, SESSION) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.refused.outcome).toMatchObject({
      effect: 'rejected',
      code: 'follow_up_adopt_requires_desktop_user',
    })
    expect(result.state.followUpQueue.items[0]).toMatchObject({
      deliveryState: 'needs_attention',
      intent: { callerId: PROFILE },
    })
  })

  it("starts the adopted Follow-up when it heads an idle Session's running queue", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* idleQueue([{ id: 'follow-up-stuck' }])
        yield* sql`
          UPDATE session_follow_ups
          SET delivery_state = ${'needs_attention'}, attention_reason = ${'authority_changed'},
            intent_json = ${JSON.stringify(STUCK_INTENT)}
          WHERE id = ${'follow-up-stuck'}
        `
        const revision = (yield* loadSessionControlState(sql, SESSION)).followUpQueue.revision
        const adopted = yield* adopt({
          key: 'idle',
          desktopUser: true,
          expectedQueueRevision: revision,
        })
        const runs = yield* sql<{ readonly intent_json: string }>`
          SELECT intent_json FROM session_runs WHERE session_id = ${SESSION}
        `
        const runIntent: unknown = JSON.parse(runs[0]?.intent_json ?? 'null')
        return { adopted, runIntent }
      }).pipe(Effect.provide(followUpEditLayer(tmpRoot, 'idle.sqlite'))),
    )

    expect(result.adopted.outcome).toMatchObject({
      operation: 'queue-adopt',
      effect: 'started-run',
      followUpId: 'follow-up-stuck',
    })
    // The Run acts for the desktop user; who queued it stays as provenance.
    expect(result.runIntent).toMatchObject({ callerId: USER, authorCallerId: PROFILE })
  })
})
