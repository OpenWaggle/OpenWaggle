import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mutateSessionQueue,
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

function request<Command>(name: string, command: Command) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${name}`,
    idempotencyKey: `idempotency-${name}`,
    command,
  }
}

describe('SQLite Session control: a re-authorized Follow-up', () => {
  let tmpRoot = ''

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-reauthorized-follow-up-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('keeps its writer as the author and stays readable', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'session-host.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO session_client_profiles (
          id, name, credential_verifier, capabilities_json, scope_json, authorization_ceiling,
          created_at, updated_at
        ) VALUES (
          ${'ci'}, ${'ci'}, ${'verifier'}, ${'[]'}, ${'{"all":true}'}, ${'yolo'}, ${1}, ${1}
        )`
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: request('message', {
            operation: 'message',
            sessionId: 'session-target',
            input: { text: 'Start working.', attachmentIds: [] },
          }),
        })
        // A catalog-wide CLI profile writes the Follow-up; the desktop user then re-authorizes it.
        yield* queueSessionFollowUp({
          callerId: 'profile:ci',
          request: request('follow-up', {
            operation: 'follow-up',
            sessionId: 'session-target',
            input: { text: 'Then list every project.', attachmentIds: [] },
          }),
        })
        const queued = yield* sql<{ readonly id: string }>`
          SELECT id FROM session_follow_ups WHERE session_id = ${'session-target'}
        `
        const followUpId = queued[0]?.id ?? ''
        const reauthorized = yield* mutateSessionQueue({
          callerId: 'local-user',
          request: request('reauthorize', {
            operation: 'queue-update-authorization',
            sessionId: 'session-target',
            followUpId,
            runAuthorizationOverride: 'ask-for-approval',
          }),
        })
        // Loading the Session's control state decodes the stored intent strictly.
        const state = yield* loadSessionControlState(sql, 'session-target')
        return { reauthorized, intent: state.followUpQueue.items[0]?.intent }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.intent).toMatchObject({
      callerId: 'local-user',
      authorCallerId: 'profile:ci',
      runAuthorizationOverride: 'ask-for-approval',
    })
    expect(result.reauthorized.outcome).toMatchObject({ effect: 'queue-updated' })
  })
})
