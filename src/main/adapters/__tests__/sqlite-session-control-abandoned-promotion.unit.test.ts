import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

let temporaryRoot = ''

describe('SQLite pending promotion recovery', () => {
  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('only recovers a pending promotion after host loss', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-abandoned-promotion-'))
    const layer = makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, 'state.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-start',
            idempotencyKey: 'idempotency-start',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        yield* queueSessionFollowUp({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-follow-up',
            idempotencyKey: 'idempotency-follow-up',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Continue.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${'local-user'}, ${'promote'}, ${'session-target'}, ${'abandoned-promotion'},
            ${JSON.stringify({
              operation: 'promote',
              sessionId: 'session-target',
              followUpId: 'follow-up-next',
            })},
            ${'pending'}, ${null}, ${1}, ${1}
          )
        `
        const recovered = yield* lifecycle.recoverHostLoss
        const operations = yield* sql<{ readonly status: string; readonly outcome_json: string }>`
          SELECT status, outcome_json
          FROM session_operations
          WHERE idempotency_key = ${'abandoned-promotion'}
        `
        return { recovered, operation: operations[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.recovered).toEqual([
      { sessionId: SessionId('session-target'), runId: RunId('run-next') },
    ])
    expect(result.operation).toEqual({
      status: 'completed',
      outcome_json: JSON.stringify({
        operation: 'promote',
        effect: 'rejected',
        sessionId: 'session-target',
        code: 'host_lost',
      }),
    })
  })
})
