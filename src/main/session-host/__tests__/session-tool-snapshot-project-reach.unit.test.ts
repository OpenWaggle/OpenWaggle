import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { encodeSessionAuthoritySnapshot } from '../session-authority-snapshot'
import { resolveSessionToolAgentCaller } from '../session-tool-agent-caller'

const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'

/**
 * The authority snapshot stored with a Session bounds its reach even when the live origin would
 * reach every project. Snapshot roots must be real canonical directories, so this suite uses them.
 */
describe('Sessions tool reach bounded by the stored authority snapshot', () => {
  let root = ''
  let project = ''

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-snapshot-project-reach-')),
    )
    project = path.join(root, 'project')
    await fs.mkdir(project)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function resolveCaller(input: {
    readonly snapshotScope: object
    readonly worker?: boolean
  }) {
    const database = SqliteClient.layer({
      filename: path.join(root, 'authority.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    const sessionId = input.worker ? 'worker' : 'root'
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)`)
        yield* sql.unsafe(
          `CREATE TABLE session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT)`,
        )
        yield* sql`INSERT INTO session_runs (id, session_id, intent_json) VALUES (
          ${`run-${sessionId}`}, ${sessionId}, ${JSON.stringify({ callerId: 'gui:local-user' })}
        )`
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
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${sessionId}, ${project})`
        const snapshot = encodeSessionAuthoritySnapshot({
          scope: input.snapshotScope,
          projectPath: project,
          workingPath: project,
        })
        yield* sql`INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id, authority_scope_snapshot_json,
          authorization_ceiling
        ) VALUES (${sessionId}, ${PROFILE_JSON}, ${'gui:local-user'}, ${snapshot}, ${'yolo'})`
        if (input.worker) {
          yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'queen'}, ${project})`
          yield* sql`INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, hive_root_session_id
          ) VALUES (${'worker'}, ${'queen'}, ${'queen'})`
          yield* sql`INSERT INTO derived_child_management_grants (
            id, parent_session_id, child_session_id, source_caller_id,
            capabilities_json, authorization_ceiling, revoked_at
          ) VALUES (
            ${'grant-worker'}, ${'queen'}, ${'worker'}, ${'gui:local-user'},
            ${'["sessions:discover","sessions:read"]'}, ${'yolo'}, ${null}
          )`
        }
        return yield* resolveSessionToolAgentCaller(sql, {
          sessionId,
          runId: `run-${sessionId}`,
          workingDirectory: project,
        })
      }).pipe(Effect.provide(database)),
    )
  }

  it('keeps a desktop root whose snapshot names one project inside that project', async () => {
    const caller = await resolveCaller({ snapshotScope: { projectPaths: [project] } })

    expect(caller.profileAuthority?.scope).toEqual({
      projectPaths: [project],
      exportRoots: [project],
      attachmentRoots: [project],
    })
  })

  it('lets a desktop root whose snapshot is catalog-wide reach every project', async () => {
    const caller = await resolveCaller({ snapshotScope: { all: true } })

    expect(caller.profileAuthority?.scope).toEqual({
      all: true,
      exportRoots: [project],
      attachmentRoots: [project],
    })
  })

  it('limits a Worker to itself even when its snapshot is catalog-wide', async () => {
    const caller = await resolveCaller({ snapshotScope: { all: true }, worker: true })

    expect(caller.profileAuthority?.scope).toEqual({
      sessionIds: ['worker'],
      exportRoots: [project],
      attachmentRoots: [project],
    })
  })
})
