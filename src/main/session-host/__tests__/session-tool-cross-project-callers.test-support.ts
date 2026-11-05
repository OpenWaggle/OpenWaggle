import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { resolveSessionToolAgentCaller } from '../session-tool-agent-caller'

/**
 * The Session agents `session-tool-cross-project-authority.unit.test.ts` authorizes: roots and a
 * Worker in gosafe, started by the desktop user, by a project-scoped or catalog-wide CLI profile,
 * or with a Run a profile started, resolved from a minimal durable catalog.
 */
export const GOSAFE = '/projects/gosafe'
export const OPENWAGGLE = '/projects/openwaggle'
const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'

export const PROJECT_BY_SESSION: Readonly<Record<string, string>> = {
  'gosafe-root': GOSAFE,
  'gosafe-worker': GOSAFE,
  'profile-root': GOSAFE,
  'all-profile-root': GOSAFE,
  'openwaggle-root': OPENWAGGLE,
  // A desktop root whose current Run a project-scoped CLI profile started.
  'driven-root': GOSAFE,
  // A yolo desktop root whose current Run an ask-for-approval CLI profile started.
  'asked-root': GOSAFE,
}

/** Who started each Session's current Run, as `session_runs.intent_json.callerId` records it. */
const RUN_INITIATOR_BY_SESSION: Readonly<Record<string, string>> = {
  'gosafe-root': 'gui:local-user',
  'gosafe-worker': 'session-agent:gosafe-root:run-gosafe-root',
  'profile-root': 'profile:project-profile',
  'all-profile-root': 'profile:all-profile',
  'openwaggle-root': 'gui:local-user',
  'driven-root': 'profile:project-profile',
  'asked-root': 'profile:asker-profile',
}

export async function resolveCallers(databasePath: string) {
  const database = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)`)
      yield* sql.unsafe(`CREATE TABLE session_runs (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT
      )`)
      yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
        session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
        authority_origin_caller_id TEXT NOT NULL, authority_scope_snapshot_json TEXT,
        authorization_ceiling TEXT NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE session_spawn_lineage (
        child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
        hive_root_session_id TEXT NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE session_lineage (
        session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE derived_child_management_grants (
        id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
        child_session_id TEXT NOT NULL UNIQUE, source_caller_id TEXT NOT NULL,
        capabilities_json TEXT NOT NULL, authorization_ceiling TEXT NOT NULL,
        revoked_at INTEGER
      )`)
      yield* sql.unsafe(`CREATE TABLE session_client_profiles (
        id TEXT PRIMARY KEY, capabilities_json TEXT NOT NULL,
        scope_json TEXT NOT NULL, authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
      )`)
      for (const [id, projectPath] of Object.entries(PROJECT_BY_SESSION)) {
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${id}, ${projectPath})`
        yield* sql`INSERT INTO session_runs (id, session_id, intent_json) VALUES (
          ${`run-${id}`}, ${id}, ${JSON.stringify({ callerId: RUN_INITIATOR_BY_SESSION[id] })}
        )`
      }
      for (const [id, origin] of [
        ['gosafe-root', 'gui:local-user'],
        ['gosafe-worker', 'gui:local-user'],
        ['openwaggle-root', 'gui:local-user'],
        ['driven-root', 'gui:local-user'],
        ['asked-root', 'gui:local-user'],
        ['profile-root', 'profile:project-profile'],
        ['all-profile-root', 'profile:all-profile'],
      ] as const) {
        yield* sql`INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id, authorization_ceiling
        ) VALUES (${id}, ${PROFILE_JSON}, ${origin}, ${'yolo'})`
      }
      yield* sql`INSERT INTO session_spawn_lineage (
        child_session_id, parent_session_id, hive_root_session_id
      ) VALUES (${'gosafe-worker'}, ${'gosafe-root'}, ${'gosafe-root'})`
      yield* sql`INSERT INTO derived_child_management_grants (
        id, parent_session_id, child_session_id, source_caller_id,
        capabilities_json, authorization_ceiling, revoked_at
      ) VALUES (
        ${'grant-worker'}, ${'gosafe-root'}, ${'gosafe-worker'}, ${'gui:local-user'},
        ${'["sessions:discover","sessions:read","sessions:create","sessions:start","sessions:message"]'},
        ${'yolo'}, ${null}
      )`
      yield* sql`INSERT INTO session_client_profiles (
        id, capabilities_json, scope_json, authorization_ceiling, revoked_at
      ) VALUES
        (
          ${'project-profile'},
          ${'["sessions:discover","sessions:read","sessions:create","sessions:start","sessions:message"]'},
          ${JSON.stringify({ projectPaths: [GOSAFE] })}, ${'yolo'}, ${null}
        ),
        (
          ${'asker-profile'},
          ${'["sessions:discover","sessions:read","sessions:message"]'},
          ${JSON.stringify({ projectPaths: [GOSAFE] })}, ${'ask-for-approval'}, ${null}
        ),
        (
          ${'all-profile'},
          ${'["sessions:discover","sessions:read","sessions:create","sessions:start","sessions:message"]'},
          ${JSON.stringify({ all: true })}, ${'yolo'}, ${null}
        )`
      const resolve = (sessionId: string) =>
        resolveSessionToolAgentCaller(sql, {
          sessionId,
          runId: `run-${sessionId}`,
          workingDirectory: GOSAFE,
        })
      return {
        independent: yield* resolve('gosafe-root'),
        worker: yield* resolve('gosafe-worker'),
        projectProfile: yield* resolve('profile-root'),
        allProfile: yield* resolve('all-profile-root'),
        drivenByProfile: yield* resolve('driven-root'),
        askedByProfile: yield* resolve('asked-root'),
      }
    }).pipe(Effect.provide(database)),
  )
}
