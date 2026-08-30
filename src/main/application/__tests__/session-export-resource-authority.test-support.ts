import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect, vi } from 'vitest'
import type { SessionExportArtifactWriterShape } from '../../ports/session-export-artifact-writer'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { runSessionExportOperation } from '../session-export-operation-service'
import {
  exportOperation as operation,
  exportRepository as repository,
  exportTestDependencies as testDependencies,
} from './session-export-operation-service.test-support'

export async function verifyRevokedWorkspaceRootStopsExport() {
  const temporaryRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-resource-revoke-')),
  )
  const destinationRoot = path.join(temporaryRoot, 'exports')
  const workspaceRoot = path.join(temporaryRoot, 'workspace')
  await Promise.all([
    fs.mkdir(destinationRoot, { recursive: true }),
    fs.mkdir(workspaceRoot, { recursive: true }),
  ])
  try {
    const sqlite = SqliteClient.layer({
      filename: path.join(temporaryRoot, 'export.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    let databaseSql: SqlClient.SqlClient | undefined
    const schema = Layer.effectDiscard(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        databaseSql = sql
        yield* sql.unsafe(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)`)
        yield* sql.unsafe(`
          CREATE TABLE session_spawn_lineage (
            child_session_id TEXT PRIMARY KEY,
            hive_root_session_id TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_execution_profiles (
            session_id TEXT PRIMARY KEY,
            authority_scope_snapshot_json TEXT
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
        yield* sql.unsafe(`
          CREATE TABLE workspace_resources (
            id TEXT PRIMARY KEY,
            working_path TEXT NOT NULL,
            lifecycle_state TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_workspace_bindings (
            session_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL
          )
        `)
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-export'}, ${workspaceRoot})`
        yield* sql`
          INSERT INTO session_execution_profiles (session_id, authority_scope_snapshot_json)
          VALUES (${'session-export'}, ${null})
        `
        yield* sql`
          INSERT INTO workspace_resources (id, working_path, lifecycle_state)
          VALUES (${'workspace-1'}, ${workspaceRoot}, ${'ready'})
        `
        yield* sql`
          INSERT INTO session_workspace_bindings (session_id, workspace_id)
          VALUES (${'session-export'}, ${'workspace-1'})
        `
        yield* sql`
          INSERT INTO session_client_profiles (
            id, capabilities_json, scope_json, authorization_ceiling, revoked_at
          ) VALUES (
            ${'exporter'},
            ${JSON.stringify(['sessions:export', 'sessions:read'])},
            ${JSON.stringify({ all: true, exportRoots: [destinationRoot, workspaceRoot] })},
            ${'ask-for-approval'},
            ${null}
          )
        `
      }),
    )
    let progressUpdates = 0
    let failureMessage = ''
    const fail = vi.fn((_operationId: string, error: { readonly message: string }) =>
      Effect.sync(() => {
        failureMessage = error.message
      }),
    )
    const complete = vi.fn(() => Effect.void)
    const operations = repository({
      claimExecution: () =>
        Effect.succeed({
          status: 'claimed' as const,
          operation: {
            ...operation,
            callerId: 'profile:exporter',
            format: 'bundle',
            destinationPath: path.join(destinationRoot, 'conversation.openwaggle'),
            destinationRoot,
            resourceSourceRoot: workspaceRoot,
            resources: [{ kind: 'workspace-file', path: 'notes.md' }],
          },
        }),
      updateProgress: () =>
        Effect.gen(function* () {
          progressUpdates += 1
          if (progressUpdates !== 1) return
          const sql = databaseSql
          if (!sql) return yield* Effect.die('test database was not initialized')
          yield* Effect.orDie(
            sql`
              UPDATE session_client_profiles
              SET scope_json = ${JSON.stringify({ all: true, exportRoots: [destinationRoot] })}
              WHERE id = ${'exporter'}
            `,
          )
        }),
      fail,
      complete,
    })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.succeed({
          writeManifest: () => Effect.succeed(0),
          writeRecords: () => Effect.succeed(0),
          writeResource: () => Effect.succeed(0),
          finalize: () => Effect.void,
          discard: () => Effect.void,
        }),
      discard: () => Effect.void,
    }
    const resolveResource = vi.fn(() => Effect.die('resource authority was not revalidated'))
    const resourceResolver = Layer.succeed(SessionExportResourceResolver, {
      resolve: resolveResource,
    })
    const database = Layer.provideMerge(schema, sqlite)

    await Effect.runPromise(
      runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(
          Layer.merge(
            testDependencies(operations, artifacts, undefined, resourceResolver),
            database,
          ),
        ),
      ),
    )

    expect(fail).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
    expect(resolveResource).not.toHaveBeenCalled()
    expect(failureMessage).toContain('source root is no longer authorized')
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  }
}
