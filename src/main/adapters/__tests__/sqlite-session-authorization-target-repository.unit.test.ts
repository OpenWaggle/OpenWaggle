import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SqliteSessionAuthorizationTargetRepositoryLive } from '../sqlite-session-authorization-target-repository'

function makeLayer(filename: string) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          pi_session_id TEXT NOT NULL UNIQUE,
          project_path TEXT,
          title TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      for (const session of [
        { id: 'session-root', pi: 'pi-root' },
        { id: 'session-worker', pi: 'pi-worker' },
      ]) {
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, created_at, updated_at
          ) VALUES (
            ${session.id}, ${session.pi}, ${'/project'}, ${session.id}, ${1}, ${1}
          )
        `
      }
      for (const sessionId of ['session-root', 'session-worker']) {
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${sessionId}, ${JSON.stringify({ modelId: 'test', thinkingLevel: 'medium' })}, ${'local-user'},
            ${sessionId === 'session-root' ? 'yolo' : 'ask-for-approval'}, ${1}, ${1}
          )
        `
      }
      yield* sql`
        INSERT INTO session_runs (
          id, session_id, status, created_at, updated_at
        ) VALUES (${'run-root'}, ${'session-root'}, ${'active'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_spawn_lineage (
          child_session_id, parent_session_id, parent_run_id,
          hive_root_session_id, depth, created_at
        ) VALUES (
          ${'session-worker'}, ${'session-root'}, ${'run-root'},
          ${'session-root'}, ${1}, ${1}
        )
      `
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    SqliteSessionAuthorizationTargetRepositoryLive.pipe(Layer.provide(sqlite)),
  )
}

describe('SQLite Session authorization target repository', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-auth-target-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('resolves independent roots and Workers to canonical project and Hive scope', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'targets.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionAuthorizationTargetRepository
        return {
          root: yield* repository.resolve('session-root'),
          worker: yield* repository.resolve('session-worker'),
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      root: {
        sessionId: 'session-root',
        projectPath: '/project',
        hiveRootSessionId: 'session-root',
        authorizationCeiling: 'yolo',
      },
      worker: {
        sessionId: 'session-worker',
        projectPath: '/project',
        hiveRootSessionId: 'session-root',
        authorizationCeiling: 'ask-for-approval',
      },
    })
  })

  it('expands canonical workspace roots without admitting sibling or symlink-escaped projects', async () => {
    const allowedRoot = path.join(temporaryRoot, 'allowed')
    const allowedProject = path.join(allowedRoot, 'project')
    const privateProject = path.join(temporaryRoot, 'private')
    const escapedProject = path.join(allowedRoot, 'escaped')
    await Promise.all([fs.mkdir(allowedProject, { recursive: true }), fs.mkdir(privateProject)])
    await fs.symlink(privateProject, escapedProject)
    const canonicalAllowedRoot = await fs.realpath(allowedRoot)
    const canonicalAllowedProject = await fs.realpath(allowedProject)
    const layer = makeLayer(path.join(temporaryRoot, 'workspace-scope.sqlite'))

    const realpath = vi.spyOn(fs, 'realpath')

    const projects = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE sessions SET project_path = ${canonicalAllowedProject}
          WHERE id = ${'session-root'}
        `
        yield* sql`UPDATE sessions SET project_path = ${escapedProject} WHERE id = ${'session-worker'}`
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, created_at, updated_at
          ) VALUES (
            ${'session-private'}, ${'pi-private'}, ${privateProject}, ${'Private'}, ${1}, ${1}
          )
        `
        const repository = yield* SessionAuthorizationTargetRepository
        if (!repository.resolveWorkspaceProjectPaths) throw new Error('Workspace resolver missing.')
        return yield* repository.resolveWorkspaceProjectPaths([canonicalAllowedRoot])
      }).pipe(Effect.provide(layer)),
    )

    expect(projects).toEqual([canonicalAllowedProject])
    expect(realpath).not.toHaveBeenCalledWith(privateProject)
    realpath.mockRestore()
  })
})
