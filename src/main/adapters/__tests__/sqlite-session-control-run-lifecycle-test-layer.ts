import type * as SqlClient from '@effect/sql/SqlClient'
import { SqlClient as SqlClientTag } from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { FollowUpId, ReportCorrelationId, ReportId, RunId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { submitSessionMessage } from '../../application/session-control-service'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SqliteSessionControlRepositoryLive } from '../sqlite-session-control-repository'
import { SqliteSessionControlRunLifecycleRepositoryLive } from '../sqlite-session-control-run-lifecycle-repository'

export function makeSessionControlRunLifecycleTestLayer(databasePath: string) {
  const sqlite = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClientTag
      yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)')
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO sessions (id, project_path) VALUES (${'session-target'}, ${'/project'})
      `
      yield* sql`
        INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id,
          authorization_ceiling, created_at, updated_at
        ) VALUES (
          ${'session-target'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
          ${'local-user'}, ${'ask-for-approval'}, ${1000}, ${1000}
        )
      `
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
        ) VALUES (${'session-target'}, ${0}, ${null}, ${'running'}, ${0}, ${1000})
      `
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    SqliteSessionControlRepositoryLive.pipe(Layer.provide(sqlite)),
    SqliteSessionControlRunLifecycleRepositoryLive.pipe(Layer.provide(sqlite)),
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-next')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-next')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(1234),
    }),
  )
}

export function prepareWorkerDelegation(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`INSERT INTO sessions (id) VALUES (${'queen'}), (${'worker'})`
    yield* sql`
      INSERT INTO session_control_states (
        session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
      ) VALUES (${'worker'}, ${0}, ${null}, ${'running'}, ${0}, ${1000})
    `
    yield* sql`
      INSERT INTO delegation_contracts (
        id, parent_session_id, child_session_id, state,
        current_specification_revision, created_at, updated_at
      ) VALUES (
        ${'delegation-worker'}, ${'queen'}, ${'worker'}, ${'working'}, ${1}, ${1000}, ${1000}
      )
    `
    yield* sql`
      INSERT INTO delegation_specifications (
        delegation_id, revision, specification_json, authored_by, created_at
      ) VALUES (${'delegation-worker'}, ${1}, ${'{"objective":"Validate migration"}'}, ${'queen'}, ${1000})
    `
  })
}

export const startWorkerRun = submitSessionMessage({
  callerId: 'local-user',
  request: {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: 'request-worker-start',
    idempotencyKey: 'idempotency-worker-start',
    command: {
      operation: 'message',
      sessionId: 'worker',
      input: { text: 'Validate migration.', attachmentIds: [] },
    },
  },
})
