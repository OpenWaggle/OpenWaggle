import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { SessionExportManifest } from '@shared/types/session-export'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionExportArtifactError } from '../../errors'
import {
  SessionExportArtifactWriter,
  type SessionExportArtifactWriterShape,
} from '../../ports/session-export-artifact-writer'
import {
  type SessionExportOperationRecord,
  SessionExportOperationRepository,
  type SessionExportOperationRepositoryShape,
} from '../../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { runSessionExportOperation } from '../session-export-operation-service'
import { recoverSessionExportsAfterHostLoss } from '../session-export-recovery'
import { forkSupervisedSessionExport } from '../session-export-supervision'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'

const manifest: SessionExportManifest = {
  schemaVersion: 1,
  sessionId: 'session-export',
  title: 'Export',
  branchScope: 'active-branch',
  activeBranchId: null,
  selectedBranchId: null,
  snapshot: { nodeHighWaterMark: 0, stateRevision: 1, queueRevision: 1, capturedAt: 10 },
  activeRunId: null,
  activeTurnIncomplete: false,
  queue: {
    state: 'running',
    pendingCount: 0,
    bodyScope: 'omitted-by-choice',
    omittedBodyCount: 0,
    items: [],
  },
}

const operation: SessionExportOperationRecord = {
  exportOperationId: 'export-1',
  sessionId: 'session-export',
  callerId: 'local-user',
  idempotencyKey: 'export-once',
  format: 'jsonl',
  destinationPath: '/tmp/session-export.jsonl',
  temporaryPath: '/tmp/session-export.jsonl.partial',
  overwriteExisting: false,
  cancelRequested: false,
  cleanupPending: false,
  status: 'running',
  branchScope: 'active-branch',
  includeQueueBodies: false,
  resources: [],
  progress: { recordsWritten: 0, resourcesWritten: 0, bytesWritten: 0 },
  createdAt: 1,
  updatedAt: 1,
}

function repository(overrides: Partial<SessionExportOperationRepositoryShape> = {}) {
  return {
    create: () => Effect.die('unused create'),
    requestCancellation: () => Effect.die('unused cancellation'),
    read: () => Effect.succeed(null),
    claimExecution: () => Effect.succeed({ status: 'claimed' as const, operation }),
    persistSnapshot: () => Effect.void,
    updateProgress: () => Effect.void,
    cancellationRequested: () => Effect.succeed(false),
    complete: () => Effect.void,
    fail: () => Effect.void,
    cancel: () => Effect.void,
    completeCleanup: () => Effect.void,
    listPendingCleanup: Effect.succeed([]),
    recoverAfterHostLoss: () => Effect.succeed([]),
    ...overrides,
  } satisfies SessionExportOperationRepositoryShape
}

function testDependencies(
  operations: SessionExportOperationRepositoryShape,
  artifacts: SessionExportArtifactWriterShape,
  queries = Layer.succeed(SessionQueryRepository, {
    execute: ({ request }) =>
      Effect.succeed({
        contractVersion: 2 as const,
        requestId: request.requestId,
        outcome: { operation: 'export' as const, manifest, records: [] },
      }),
  }),
  resourceResolver = Layer.succeed(SessionExportResourceResolver, {
    resolve: () => Effect.die('unused resource resolver'),
  }),
) {
  return Layer.mergeAll(
    Layer.succeed(SessionExportOperationRepository, operations),
    Layer.succeed(SessionExportArtifactWriter, artifacts),
    queries,
    resourceResolver,
  )
}

function testLayer(
  operations: SessionExportOperationRepositoryShape,
  artifacts: SessionExportArtifactWriterShape,
) {
  return Layer.mergeAll(
    testDependencies(operations, artifacts),
    Layer.succeed(SqlClient.SqlClient, fromPartial({})),
  )
}

describe('Session export operation service', () => {
  const runtimeReleases: Array<() => void> = []
  const livenessInstances: SessionHostLiveness[] = []

  afterEach(() => {
    for (const release of runtimeReleases.splice(0)) release()
    for (const liveness of livenessInstances.splice(0)) liveness.close()
  })

  it('durably fails an export when artifact opening fails, then attempts operation cleanup', async () => {
    const order: string[] = []
    const fail = vi.fn(() =>
      Effect.sync(() => {
        order.push('failed')
      }),
    )
    const discard = vi.fn(() =>
      Effect.sync(() => {
        order.push('discarded')
      }),
    )
    const operations = repository({ fail })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.fail(new SessionExportArtifactError({ operation: 'open', message: 'open failed' })),
      discard,
    }

    await Effect.runPromise(
      runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(testLayer(operations, artifacts)),
      ),
    )

    expect(fail).toHaveBeenCalledOnce()
    expect(discard).toHaveBeenCalledOnce()
    expect(order).toEqual(['failed', 'discarded'])
  })

  it('keeps the durable terminal transition when best-effort sink cleanup defects', async () => {
    const order: string[] = []
    const fail = vi.fn(() =>
      Effect.sync(() => {
        order.push('failed')
      }),
    )
    const sinkDiscard = vi.fn(() =>
      Effect.sync(() => {
        order.push('discarded')
        throw new Error('discard defect')
      }),
    )
    const operations = repository({ fail })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.succeed({
          writeManifest: () =>
            Effect.fail(
              new SessionExportArtifactError({
                operation: 'write-manifest',
                message: 'write failed',
              }),
            ),
          writeRecords: () => Effect.succeed(0),
          writeResource: () => Effect.succeed(0),
          finalize: () => Effect.void,
          discard: sinkDiscard,
        }),
      discard: () => Effect.void,
    }

    await Effect.runPromise(
      runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(testLayer(operations, artifacts)),
      ),
    )

    expect(fail).toHaveBeenCalledOnce()
    expect(sinkDiscard).toHaveBeenCalledOnce()
    expect(order).toEqual(['failed', 'discarded'])
  })

  it('persists an artifact receipt before installation and completes only after installation', async () => {
    const order: string[] = []
    const operations = repository({
      persistArtifactPreparation: () =>
        Effect.sync(() => {
          order.push('receipt-persisted')
        }),
      beginArtifactInstallation: () =>
        Effect.sync(() => {
          order.push('install-claimed')
          return true
        }),
      complete: () =>
        Effect.sync(() => {
          order.push('completed')
        }),
    })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.succeed({
          writeManifest: () => Effect.succeed(0),
          writeRecords: () => Effect.succeed(0),
          writeResource: () => Effect.succeed(0),
          prepareFinalization: () =>
            Effect.sync(() => {
              order.push('prepared')
              return { sha256: 'artifact-digest', sizeBytes: 10 }
            }),
          finalize: () =>
            Effect.sync(() => {
              order.push('installed')
            }),
          discard: () => Effect.void,
        }),
      discard: () => Effect.void,
    }

    await Effect.runPromise(
      runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(testLayer(operations, artifacts)),
      ),
    )

    expect(order).toEqual([
      'prepared',
      'receipt-persisted',
      'install-claimed',
      'installed',
      'completed',
    ])
  })

  it('stops a profile export when required capabilities are reduced between pages', async () => {
    const temporaryRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-revoke-')),
    )
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
          yield* sql.unsafe(`
            CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)
          `)
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
          yield* sql.unsafe(`
            CREATE TABLE session_client_profiles (
              id TEXT PRIMARY KEY,
              capabilities_json TEXT NOT NULL,
              scope_json TEXT NOT NULL,
              authorization_ceiling TEXT NOT NULL,
              revoked_at INTEGER
            )
          `)
          yield* sql`
            INSERT INTO sessions (id, project_path)
            VALUES (${'session-export'}, ${temporaryRoot})
          `
          yield* sql`
            INSERT INTO session_execution_profiles (
              session_id, authority_scope_snapshot_json
            ) VALUES (${'session-export'}, ${null})
          `
          yield* sql`
            INSERT INTO session_client_profiles (
              id, capabilities_json, scope_json, authorization_ceiling, revoked_at
            ) VALUES (
              ${'exporter'},
              ${JSON.stringify(['sessions:export', 'sessions:read', 'sessions:queue'])},
              ${JSON.stringify({ all: true, exportRoots: [temporaryRoot] })},
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
              destinationPath: path.join(temporaryRoot, 'conversation.jsonl'),
              destinationRoot: temporaryRoot,
              includeQueueBodies: true,
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
                SET capabilities_json = ${JSON.stringify(['sessions:export'])}
                WHERE id = ${'exporter'}
              `,
            )
          }),
        fail,
        complete,
      })
      let queryCount = 0
      const queries = Layer.succeed(SessionQueryRepository, {
        execute: ({ request }) => {
          queryCount += 1
          return Effect.succeed({
            contractVersion: 2 as const,
            requestId: request.requestId,
            outcome: {
              operation: 'export' as const,
              manifest,
              records: [],
              ...(queryCount === 1 ? { nextCreatedOrder: 1 } : {}),
            },
          })
        },
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
      const database = Layer.provideMerge(schema, sqlite)

      await Effect.runPromise(
        runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
          Effect.provide(Layer.merge(testDependencies(operations, artifacts, queries), database)),
        ),
      )

      expect(fail).toHaveBeenCalledOnce()
      expect(complete).not.toHaveBeenCalled()
      expect(failureMessage).toContain('authority changed')
      expect(queryCount).toBe(2)
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('stops before reading a bundled resource when its live workspace export root is revoked', async () => {
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
  })

  it('drains the Host when an unsatisfied durable export failure escapes its worker', async () => {
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const release = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
    runtimeReleases.push(release)
    livenessInstances.push(liveness)

    await Effect.runPromise(
      forkSupervisedSessionExport({ operation, effect: Effect.die('repository unavailable') }),
    )

    await vi.waitFor(() => expect(requestShutdown).toHaveBeenCalledOnce())
    expect(liveness.isDraining()).toBe(true)
  })

  it('quarantines one stale artifact cleanup failure without blocking later export recovery', async () => {
    const broken = { ...operation, exportOperationId: 'export-broken', status: 'queued' as const }
    const healthy = { ...operation, exportOperationId: 'export-healthy', status: 'queued' as const }
    const fail = vi.fn(() => Effect.void)
    const claimExecution = vi.fn((operationId: string) =>
      Effect.succeed({
        status: 'claimed' as const,
        operation: operationId === healthy.exportOperationId ? healthy : broken,
      }),
    )
    const operations = repository({
      recoverAfterHostLoss: () => Effect.succeed([broken, healthy]),
      claimExecution,
      fail,
    })
    const artifacts: SessionExportArtifactWriterShape = {
      discard: (candidate) =>
        candidate.exportOperationId === broken.exportOperationId
          ? Effect.fail(
              new SessionExportArtifactError({
                operation: 'discard',
                message: 'permission denied',
              }),
            )
          : Effect.void,
      open: () =>
        Effect.succeed({
          writeManifest: () => Effect.succeed(0),
          writeRecords: () => Effect.succeed(0),
          writeResource: () => Effect.succeed(0),
          finalize: () => Effect.void,
          discard: () => Effect.void,
        }),
    }

    await Effect.runPromise(
      recoverSessionExportsAfterHostLoss().pipe(Effect.provide(testLayer(operations, artifacts))),
    )

    expect(fail).toHaveBeenCalledWith(
      broken.exportOperationId,
      expect.objectContaining({ code: 'export_recovery_cleanup_failed' }),
      expect.any(Number),
    )
    await vi.waitFor(() =>
      expect(claimExecution).toHaveBeenCalledWith(healthy.exportOperationId, expect.any(Number)),
    )
  })
})
