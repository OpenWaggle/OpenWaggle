import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorizeLocalSessionCommand } from '../../application/local-session-command-dispatcher'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SettingsService } from '../../services/settings-service'
import { sessionCommandFailureMessage } from '../session-command-failure-message'
import { resolveSessionToolAgentCaller } from '../session-tool-agent-caller'

const GOSAFE = '/projects/gosafe'
const OPENWAGGLE = '/projects/openwaggle'
const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'

const PROJECT_BY_SESSION: Readonly<Record<string, string>> = {
  'gosafe-root': GOSAFE,
  'gosafe-worker': GOSAFE,
  'profile-root': GOSAFE,
  'all-profile-root': GOSAFE,
  'openwaggle-root': OPENWAGGLE,
}

const authorizationLayer = Layer.mergeAll(
  Layer.succeed(SessionAuthorizationTargetRepository, {
    resolve: (sessionId) =>
      Effect.succeed({
        sessionId,
        projectPath: PROJECT_BY_SESSION[sessionId] ?? '/projects/unknown',
        hiveRootSessionId: sessionId === 'gosafe-worker' ? 'gosafe-root' : sessionId,
        authorizationCeiling: 'yolo',
      }),
    resolveDelegation: (delegationId) =>
      Effect.succeed({
        sessionId: delegationId,
        projectPath: OPENWAGGLE,
        hiveRootSessionId: delegationId,
        authorizationCeiling: 'yolo',
      }),
    listLiveDerivedAuthorities: () => Effect.succeed([]),
  }),
  Layer.succeed(SettingsService, {
    get: () => Effect.succeed(DEFAULT_SETTINGS),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  }),
)

function queryPayload(
  query: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>['request']['query'],
): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: { contractVersion: 2, requestId: 'request-query', query },
  }
}

function controlPayload(
  command: Extract<
    LocalSessionCommandPayload,
    { contract: 'session-control-v2' }
  >['request']['command'],
): LocalSessionCommandPayload {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${command.operation}`,
      idempotencyKey: `idempotency-${command.operation}`,
      command,
    },
  }
}

function lifecyclePayload(
  command: Extract<
    LocalSessionCommandPayload,
    { contract: 'session-lifecycle-v2' }
  >['request']['command'],
): LocalSessionCommandPayload {
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${command.operation}`,
      idempotencyKey: `idempotency-${command.operation}`,
      command,
    },
  }
}

const crossProjectPayloads = {
  list: queryPayload({ operation: 'list', limit: 50, projectPath: OPENWAGGLE }),
  search: queryPayload({
    operation: 'search',
    query: 'handoff',
    limit: 20,
    projectPath: OPENWAGGLE,
  }),
  read: queryPayload({ operation: 'read', sessionId: 'openwaggle-root' }),
  launch: lifecyclePayload({
    operation: 'launch',
    projectPath: OPENWAGGLE,
    objective: 'Fix the scratch-directory bug.',
    attachmentIds: [],
    workspace: { mode: 'new-worktree' },
  }),
  create: lifecyclePayload({ operation: 'create', projectPath: OPENWAGGLE }),
  followUp: controlPayload({
    operation: 'follow-up',
    sessionId: 'openwaggle-root',
    input: { text: 'Here is the report.', attachmentIds: [] },
  }),
} satisfies Record<string, LocalSessionCommandPayload>

async function resolveCallers(databasePath: string) {
  const database = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)`)
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
      }
      for (const [id, origin] of [
        ['gosafe-root', 'gui:local-user'],
        ['gosafe-worker', 'gui:local-user'],
        ['openwaggle-root', 'gui:local-user'],
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
      }
    }).pipe(Effect.provide(database)),
  )
}

function authorize(caller: LocalSessionCallerIdentity, payload: LocalSessionCommandPayload) {
  return Effect.runPromise(
    authorizeLocalSessionCommand({ caller, payload }).pipe(Effect.provide(authorizationLayer)),
  )
}

describe('Sessions tool cross-project authority', () => {
  let root = ''
  let callers: Awaited<ReturnType<typeof resolveCallers>>

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cross-project-authority-'))
    callers = await resolveCallers(path.join(root, 'authority.sqlite'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('gives a user-originated root Session agent every project in the local catalog', () => {
    expect(callers.independent.profileAuthority?.scope).toEqual({
      all: true,
      exportRoots: [GOSAFE],
      attachmentRoots: [GOSAFE],
    })
    expect(callers.allProfile.profileAuthority?.scope).toMatchObject({ all: true })
  })

  it.each(Object.entries(crossProjectPayloads))(
    'lets an Independent Session in one project %s in another project',
    async (_name, payload) => {
      await expect(authorize(callers.independent, payload)).resolves.toBeUndefined()
      await expect(authorize(callers.allProfile, payload)).resolves.toBeUndefined()
    },
  )

  it.each(Object.entries(crossProjectPayloads))(
    'keeps a Worker and a project-scoped profile out of another project for %s',
    async (_name, payload) => {
      await expect(authorize(callers.worker, payload)).rejects.toThrow()
      await expect(authorize(callers.projectProfile, payload)).rejects.toThrow()
    },
  )

  it('names the refusal reason instead of a generic failure', async () => {
    const failure = await authorize(callers.projectProfile, crossProjectPayloads.launch).then(
      () => undefined,
      (error: unknown) => error,
    )
    const message = sessionCommandFailureMessage(failure)
    expect(message).not.toContain('An error has occurred')
    expect(message).toContain('target_scope_denied')
    expect(message).toContain('outside the authorized scope')
  })
})
