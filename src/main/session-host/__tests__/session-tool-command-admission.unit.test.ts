import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { admitSessionToolCommand } from '../session-tool-command-admission'
import { insertRunInitiators } from './session-run-initiators.test-support'

const PROJECT = '/projects/gosafe'
const KNOWN_PROJECT = '/projects/openwaggle'
const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'

function launch(projectPath: string): LocalSessionCommandPayload {
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-launch',
      idempotencyKey: 'launch-once',
      command: {
        operation: 'launch',
        projectPath,
        objective: 'Investigate.',
        attachmentIds: [],
        workspace: { mode: 'local' },
      },
    },
  }
}

describe('Sessions tool command admission', () => {
  let root = ''
  let databaseCount = 0

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-tool-admission-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function admit(payload: LocalSessionCommandPayload) {
    databaseCount += 1
    const database = SqliteClient.layer({
      filename: path.join(root, `admission-${databaseCount}.sqlite`),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)')
        yield* sql.unsafe(
          'CREATE TABLE workspace_resources (id TEXT PRIMARY KEY, project_path TEXT NOT NULL)',
        )
        yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
          authority_origin_caller_id TEXT NOT NULL, authority_scope_snapshot_json TEXT,
          authorization_ceiling TEXT NOT NULL
        )`)
        yield* sql.unsafe(`CREATE TABLE session_spawn_lineage (
          child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
          hive_root_session_id TEXT NOT NULL
        )`)
        yield* sql.unsafe(
          'CREATE TABLE session_lineage (session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL)',
        )
        yield* sql.unsafe(`CREATE TABLE derived_child_management_grants (
          id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL, child_session_id TEXT NOT NULL,
          source_caller_id TEXT NOT NULL, capabilities_json TEXT NOT NULL,
          authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql.unsafe(`CREATE TABLE session_client_profiles (
          id TEXT PRIMARY KEY, capabilities_json TEXT NOT NULL, scope_json TEXT NOT NULL,
          authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql`INSERT INTO sessions (id, project_path) VALUES
          (${'root'}, ${PROJECT}), (${'other'}, ${KNOWN_PROJECT})`
        yield* sql`INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id, authorization_ceiling
        ) VALUES (${'root'}, ${PROFILE_JSON}, ${'gui:local-user'}, ${'yolo'})`
        // The desktop user started this Run, so the agent reaches every project.
        yield* insertRunInitiators(sql, [['run-root', 'root', 'gui:local-user']])
        return yield* Effect.promise(() =>
          admitSessionToolCommand(sql, {
            sourceSessionId: 'root',
            sourceRunId: 'run-root',
            workingDirectory: PROJECT,
            payload,
          }),
        )
      }).pipe(Effect.provide(database)),
    )
  }

  it('refuses a catalog-wide agent launching into a directory OpenWaggle does not know', async () => {
    await expect(admit(launch('/Users/me/Downloads/untrusted-repo'))).rejects.toThrow(
      'is not a project in OpenWaggle',
    )
  })

  it('admits the same agent launching into a known project', async () => {
    const { caller, payload } = await admit(launch(KNOWN_PROJECT))

    expect(caller.profileAuthority.scope).toMatchObject({ all: true })
    expect(payload).toEqual(launch(KNOWN_PROJECT))
  })

  it('matches a known project named with a trailing slash and dispatches its stored path', async () => {
    const { payload } = await admit(launch(`${KNOWN_PROJECT}/./`))

    expect(payload).toEqual(launch(KNOWN_PROJECT))
  })
})
