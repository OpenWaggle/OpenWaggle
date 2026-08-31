import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

describe('SQLite queued Follow-up derived authority', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('schedules a queued message authorized only by the exact Worker grant', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-derived-'))
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'authority.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE settings_store (
          key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
        )`)
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'queen'}, ${'/project'})`
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
          VALUES
            (${'run-queen'}, ${'queen'}, ${'completed'}, ${1}, ${1}),
            (${'run-active'}, ${'session-target'}, ${'active'}, ${2}, ${2})
        `
        yield* sql`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, parent_run_id,
            hive_root_session_id, depth, created_at
          ) VALUES (
            ${'session-target'}, ${'queen'}, ${'run-queen'}, ${'queen'}, ${1}, ${2}
          )
        `
        yield* sql`
          INSERT INTO delegation_contracts (
            id, parent_session_id, child_session_id, state,
            current_specification_revision, created_at, updated_at
          ) VALUES (
            ${'delegation-target'}, ${'queen'}, ${'session-target'}, ${'working'}, ${1}, ${2}, ${2}
          )
        `
        yield* sql`
          INSERT INTO derived_child_management_grants (
            id, parent_session_id, child_session_id, delegation_id,
            source_caller_id, capabilities_json, authorization_ceiling, created_at
          ) VALUES (
            ${'grant-target'}, ${'queen'}, ${'session-target'}, ${'delegation-target'},
            ${'profile:origin'}, ${JSON.stringify(['sessions:message'])},
            ${'ask-for-approval'}, ${2}
          )
        `
        yield* sql`
          INSERT INTO session_client_profiles (
            id, name, credential_verifier, capabilities_json, scope_json,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${'origin'}, ${'origin'}, ${'verifier'}, ${JSON.stringify(['sessions:message'])},
            ${JSON.stringify({ sessionIds: ['queen'] })},
            ${'ask-for-approval'}, ${2}, ${2}
          )
        `
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${'run-active'}
          WHERE session_id = ${'session-target'}
        `
        yield* submitSessionMessage({
          callerId: 'profile:origin',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'queue-derived',
            idempotencyKey: 'queue-derived-once',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Continue.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        const settled = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-active'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
        })
        const followUps = yield* sql<{
          readonly delivery_state: string
          readonly attention_reason: string | null
        }>`SELECT delivery_state, attention_reason FROM session_follow_ups`
        return { settled, followUp: followUps[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      settled: { accepted: true, scheduled: { runId: RunId('run-after') } },
      followUp: undefined,
    })
  })
})
