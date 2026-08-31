import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { resolveSessionToolAgentCaller } from '../session-tool-gateway-installer'

describe('Sessions tool agent authority', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-tool-authority-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('gives a Queen project-scoped user authority and a Worker only its derived direct scope', async () => {
    const sqlite = SqliteClient.layer({
      filename: path.join(temporaryRoot, 'authority.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    const [queen, worker, restrictedBefore, restrictedAfter, exactQueen, exactWorker] =
      await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.unsafe(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)`)
          yield* sql.unsafe(`
          CREATE TABLE session_execution_profiles (
            session_id TEXT PRIMARY KEY,
            profile_json TEXT NOT NULL,
            authority_origin_caller_id TEXT NOT NULL,
            authority_scope_snapshot_json TEXT,
            authorization_ceiling TEXT NOT NULL
          )
        `)
          yield* sql.unsafe(`
          CREATE TABLE session_spawn_lineage (
            child_session_id TEXT PRIMARY KEY,
            parent_session_id TEXT NOT NULL,
            hive_root_session_id TEXT NOT NULL
          )
        `)
          yield* sql.unsafe(`
          CREATE TABLE derived_child_management_grants (
            id TEXT PRIMARY KEY,
            parent_session_id TEXT NOT NULL,
            child_session_id TEXT NOT NULL UNIQUE,
            source_caller_id TEXT NOT NULL,
            capabilities_json TEXT NOT NULL,
            authorization_ceiling TEXT NOT NULL,
            revoked_at INTEGER
          )
        `)
          yield* sql.unsafe(`
          CREATE TABLE session_client_profiles (
            id TEXT PRIMARY KEY,
            capabilities_json TEXT NOT NULL,
            scope_json TEXT NOT NULL,
            authorization_ceiling TEXT NOT NULL,
            revoked_at INTEGER
          )
        `)
          for (const id of [
            'queen',
            'worker',
            'grandchild',
            'restricted-root',
            'restricted-worker',
          ]) {
            yield* sql`INSERT INTO sessions (id, project_path) VALUES (${id}, ${'/project'})`
            yield* sql`
            INSERT INTO session_execution_profiles (
              session_id, profile_json, authority_origin_caller_id, authorization_ceiling
            ) VALUES (
              ${id}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
              ${'local-user'}, ${'ask-for-approval'}
            )
          `
          }
          yield* sql`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, hive_root_session_id
          ) VALUES
            (${'worker'}, ${'queen'}, ${'queen'}),
            (${'grandchild'}, ${'worker'}, ${'queen'}),
            (${'restricted-worker'}, ${'restricted-root'}, ${'restricted-root'})
        `
          yield* sql`
          INSERT INTO derived_child_management_grants (
            id, parent_session_id, child_session_id, source_caller_id,
            capabilities_json, authorization_ceiling, revoked_at
          ) VALUES (
            ${'grant-worker'}, ${'queen'}, ${'worker'}, ${'local-user'},
            ${'["sessions:spawn","sessions:read","unknown:grant"]'},
            ${'ask-for-approval'}, ${null}
          )
        `
          yield* sql`
          INSERT INTO session_client_profiles (
            id, capabilities_json, scope_json, authorization_ceiling, revoked_at
          ) VALUES (
            ${'origin-profile'}, ${'["sessions:read","sessions:spawn","sessions:report"]'},
            ${'{"projectPaths":["/project"]}'}, ${'yolo'}, ${null}
          )
        `
          yield* sql`
          UPDATE session_execution_profiles SET
            profile_json = ${'{"modelId":"provider/model","thinkingLevel":"medium","sessionCapabilities":["sessions:read","sessions:spawn","sessions:report"]}'},
            authority_origin_caller_id = ${'profile:origin-profile'},
            authorization_ceiling = ${'yolo'}
          WHERE session_id = ${'restricted-root'}
        `
          yield* sql`
          UPDATE session_execution_profiles SET
            profile_json = ${'{"modelId":"provider/model","thinkingLevel":"medium","sessionCapabilities":["sessions:read","sessions:spawn","sessions:report"]}'},
            authority_origin_caller_id = ${'profile:origin-profile'},
            authorization_ceiling = ${'yolo'}
          WHERE session_id = ${'restricted-worker'}
        `
          yield* sql`
          UPDATE session_client_profiles SET scope_json = ${'{"sessionIds":["restricted-root"]}'}
          WHERE id = ${'origin-profile'}
        `
          yield* sql`
          INSERT INTO derived_child_management_grants (
            id, parent_session_id, child_session_id, source_caller_id,
            capabilities_json, authorization_ceiling, revoked_at
          ) VALUES (
            ${'grant-restricted-worker'}, ${'restricted-root'}, ${'restricted-worker'},
            ${'profile:origin-profile'},
            ${'["sessions:read","sessions:spawn","sessions:report"]'}, ${'yolo'}, ${null}
          )
        `
          const exactQueen = yield* resolveSessionToolAgentCaller(sql, {
            sessionId: 'restricted-root',
            runId: 'run-exact-queen',
            workingDirectory: '/project',
          })
          const exactWorker = yield* resolveSessionToolAgentCaller(sql, {
            sessionId: 'restricted-worker',
            runId: 'run-exact-worker',
            workingDirectory: '/project',
          })
          yield* sql`
          UPDATE session_client_profiles SET scope_json = ${'{"projectPaths":["/project"]}'}
          WHERE id = ${'origin-profile'}
        `
          const initial = yield* Effect.all([
            resolveSessionToolAgentCaller(sql, {
              sessionId: 'queen',
              runId: 'run-queen',
              workingDirectory: '/project',
            }),
            resolveSessionToolAgentCaller(sql, {
              sessionId: 'worker',
              runId: 'run-worker',
              workingDirectory: '/project',
            }),
          ])
          const restrictedBefore = yield* resolveSessionToolAgentCaller(sql, {
            sessionId: 'restricted-root',
            runId: 'run-restricted-before',
            workingDirectory: '/project',
          })
          yield* sql`
          UPDATE session_client_profiles SET
            capabilities_json = ${'["sessions:read"]'},
            authorization_ceiling = ${'ask-for-approval'}
          WHERE id = ${'origin-profile'}
        `
          const restrictedAfter = yield* resolveSessionToolAgentCaller(sql, {
            sessionId: 'restricted-root',
            runId: 'run-restricted-after',
            workingDirectory: '/project',
          })
          return [...initial, restrictedBefore, restrictedAfter, exactQueen, exactWorker] as const
        }).pipe(Effect.provide(sqlite)),
      )

    expect(queen.profileAuthority).toMatchObject({
      scope: { projectPaths: ['/project'] },
    })
    expect(queen.profileAuthority?.capabilities).toContain('sessions:create')
    expect(queen.profileAuthority?.capabilities).not.toContain('sessions:respond')
    expect(queen.profileAuthority?.capabilities).not.toContain('sessions:approve')
    expect(worker.profileAuthority).toEqual({
      profileId: 'session-agent:worker',
      profileName: 'session-agent:worker',
      capabilities: ['sessions:spawn', 'sessions:read'],
      scope: {
        sessionIds: ['worker', 'grandchild'],
        exportRoots: ['/project'],
        attachmentRoots: ['/project'],
      },
      authorizationCeiling: 'ask-for-approval',
    })
    expect(restrictedBefore.profileAuthority).toMatchObject({
      capabilities: ['sessions:read', 'sessions:spawn', 'sessions:report'],
      authorizationCeiling: 'yolo',
      scope: { projectPaths: ['/project'] },
    })
    expect(restrictedAfter.profileAuthority).toMatchObject({
      capabilities: ['sessions:read'],
      authorizationCeiling: 'ask-for-approval',
      scope: { projectPaths: ['/project'] },
    })
    expect(exactQueen).toMatchObject({
      baseProfileScope: { sessionIds: ['restricted-root'] },
      derivedSessionAuthorities: [
        expect.objectContaining({
          sessionId: 'restricted-worker',
          capabilities: ['sessions:read', 'sessions:spawn', 'sessions:report'],
        }),
      ],
    })
    expect(exactWorker).toMatchObject({
      baseProfileScope: { sessionIds: [] },
      derivedSessionAuthorities: [
        expect.objectContaining({
          sessionId: 'restricted-worker',
          capabilities: ['sessions:read', 'sessions:spawn', 'sessions:report'],
        }),
      ],
    })
  })
})
