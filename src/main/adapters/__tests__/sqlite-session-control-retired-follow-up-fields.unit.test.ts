import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { followUpDeliveryView, followUpIntentView } from '../sqlite-session-follow-up-view'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

/** A Follow-up stored before Follow-ups stopped carrying Session settings. */
const RETIRED_INTENT = {
  text: 'Then list every project.',
  attachmentIds: [],
  thinkingLevel: 'high',
  runAuthorizationOverride: 'yolo',
  callerId: 'gui:local-user',
  authorCallerId: 'profile:ci',
  acceptedAt: 1,
  idempotencyKey: 'stored-follow-up',
}

describe('SQLite Session control: Follow-ups stored with retired Session settings', () => {
  let tmpRoot = ''

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-retired-follow-up-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('loads them without a thinking level, an authorization override, or an authorization block', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'session-host.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-message',
            idempotencyKey: 'message',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        yield* sql`
          INSERT INTO session_follow_ups (
            id, session_id, position, delivery_state, attention_reason, intent_json,
            created_at, updated_at
          ) VALUES (
            ${'follow-up-stored'}, ${'session-target'}, ${0}, ${'needs_attention'},
            ${'authorization_ceiling_changed'}, ${JSON.stringify(RETIRED_INTENT)}, ${1}, ${1}
          )
        `
        const state = yield* loadSessionControlState(sql, 'session-target')
        return state.followUpQueue.items[0]
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      id: 'follow-up-stored',
      deliveryState: 'pending',
      intent: {
        text: 'Then list every project.',
        attachmentIds: [],
        callerId: 'gui:local-user',
        // Who queued it stays as provenance.
        authorCallerId: 'profile:ci',
        acceptedAt: 1,
        idempotencyKey: 'stored-follow-up',
      },
    })
  })

  it('shows them to queue readers the same way', () => {
    expect(
      followUpDeliveryView({
        delivery_state: 'needs_attention',
        attention_reason: 'authorization_ceiling_changed',
      }),
    ).toEqual({ deliveryState: 'pending' })
    expect(
      followUpDeliveryView({
        delivery_state: 'needs_attention',
        attention_reason: 'profile_revoked',
      }),
    ).toEqual({ deliveryState: 'needs_attention', attentionReason: 'profile_revoked' })
    expect(followUpIntentView(JSON.stringify(RETIRED_INTENT))).toEqual({
      text: 'Then list every project.',
      attachmentIds: [],
      callerId: 'gui:local-user',
      authorCallerId: 'profile:ci',
      acceptedAt: 1,
      idempotencyKey: 'stored-follow-up',
    })
  })
})
