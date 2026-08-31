import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { FollowUpId, ReportCorrelationId, ReportId, RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import {
  SessionWorkspaceHandoffService,
  type SessionWorkspaceHandoffServiceShape,
} from '../../ports/session-workspace-handoff-service'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SqliteSessionControlOperationJournalLive } from '../sqlite-session-control-operation-journal'
import { SqliteSessionControlRepositoryLive } from '../sqlite-session-control-repository'
import { SqliteSessionControlRunLifecycleRepositoryLive } from '../sqlite-session-control-run-lifecycle-repository'
import { SqliteSessionOrganizationRepositoryLive } from '../sqlite-session-organization-repository'

export function makeSessionControlTestLayer(
  databasePath: string,
  handoffService?: SessionWorkspaceHandoffServiceShape,
) {
  const sqliteLayer = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schemaLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT,
        title TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        environment_mode TEXT NOT NULL DEFAULT 'local',
        worktree_path TEXT,
        worktree_base_ref TEXT,
        worktree_start_from_origin INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      )`)
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO sessions (id, project_path) VALUES (${'session-target'}, ${'/project'})
      `
      yield* sql`
        INSERT INTO workspace_resources (
          id, project_path, kind, working_path, lifecycle_state,
          worktree_start_from_origin, created_at, updated_at
        ) VALUES (
          ${'workspace-local'}, ${'/project'}, ${'local'}, ${'/project'}, ${'ready'},
          ${0}, ${1000}, ${1000}
        )
      `
      yield* sql`
        INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
        VALUES (${'session-target'}, ${'workspace-local'}, ${1000})
      `
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
        ) VALUES (${'session-target'}, ${0}, ${null}, ${'running'}, ${0}, ${1000})
      `
    }).pipe(Effect.provide(sqliteLayer)),
  )
  const repositoryLayer = SqliteSessionControlRepositoryLive.pipe(Layer.provide(sqliteLayer))
  const operationJournalLayer = SqliteSessionControlOperationJournalLive.pipe(
    Layer.provide(sqliteLayer),
  )
  const organizationLayer = SqliteSessionOrganizationRepositoryLive.pipe(Layer.provide(sqliteLayer))
  const runLifecycleLayer = SqliteSessionControlRunLifecycleRepositoryLive.pipe(
    Layer.provide(sqliteLayer),
  )
  const identityLayer = Layer.succeed(SessionControlIdentityService, {
    nextRunId: Effect.succeed(RunId('run-next')),
    nextFollowUpId: Effect.succeed(FollowUpId('follow-up-next')),
    nextReportId: Effect.succeed(ReportId('report-next')),
    nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-next')),
    now: Effect.succeed(1234),
  })
  const handoffLayer = Layer.succeed(
    SessionWorkspaceHandoffService,
    handoffService ?? {
      prepare: () => Effect.succeed(undefined),
      apply: () => Effect.void,
      rollback: () => Effect.void,
      complete: () => Effect.void,
    },
  )
  return Layer.mergeAll(
    sqliteLayer,
    schemaLayer,
    repositoryLayer,
    operationJournalLayer,
    organizationLayer,
    runLifecycleLayer,
    handoffLayer,
    identityLayer,
  )
}
