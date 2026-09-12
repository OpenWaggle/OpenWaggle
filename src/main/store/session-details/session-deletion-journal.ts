import { randomUUID } from 'node:crypto'
import { isMatching, P } from '@diegogbrisa/ts-match'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'

export type SessionDeletionPhase =
  | 'prepared'
  | 'durable-delete-complete'
  | 'checkpoint-ref-cleanup-pending'
  | 'external-cleanup-complete'
  | 'pi-file-cleanup-pending'
  | 'pi-file-cleanup-complete'

export interface SessionDeletionRecord {
  readonly phase: SessionDeletionPhase
  readonly resumed: boolean
  readonly piSessionFile: string | null
  readonly stagedPiSessionFile: string | null
  readonly projectPath: string | null
  readonly worktreeProjectPath: string | null
  readonly worktreePath: string | null
  readonly checkpointRefs: readonly SessionDeletionCheckpointRef[]
}

export interface SessionDeletionCheckpointRef {
  readonly name: string
  readonly objectId: string
}

function checkpointRefs(raw: string | null): readonly SessionDeletionCheckpointRef[] {
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!isMatching(P.array({ name: P.string, objectId: P.string }), parsed)) {
    throw new Error('Session deletion journal contains invalid checkpoint refs.')
  }
  return parsed
}

interface SessionDeletionRow {
  readonly phase: SessionDeletionPhase
  readonly pi_session_file: string | null
  readonly staged_pi_session_file: string | null
  readonly project_path: string | null
  readonly worktree_project_path: string | null
  readonly worktree_path: string | null
  readonly checkpoint_refs_json: string | null
}

function deletionRecord(row: SessionDeletionRow, resumed: boolean): SessionDeletionRecord {
  return {
    phase: row.phase,
    resumed,
    piSessionFile: row.pi_session_file,
    stagedPiSessionFile: row.staged_pi_session_file,
    projectPath: row.project_path,
    worktreeProjectPath: row.worktree_project_path,
    worktreePath: row.worktree_path,
    checkpointRefs: checkpointRefs(row.checkpoint_refs_json),
  }
}

function readDeletion(sql: SqlClient.SqlClient, id: SessionId) {
  return sql<SessionDeletionRow>`
    SELECT phase, pi_session_file, staged_pi_session_file, project_path,
           worktree_project_path, worktree_path, checkpoint_refs_json
    FROM session_deletion_operations WHERE session_id = ${id} LIMIT 1
  `
}

export async function getSessionDeletion(id: SessionId): Promise<SessionDeletionRecord | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* readDeletion(sql, id)
      return rows[EMPTY_INDEX] ? deletionRecord(rows[EMPTY_INDEX], true) : null
    }),
  )
}

function assertSessionHasNoForks(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly derived_session_id: string }>`
      SELECT derived_session_id
      FROM session_derivations
      WHERE source_session_id = ${id}
      ORDER BY created_at, derived_session_id
      LIMIT 1
    `
    const fork = rows[EMPTY_INDEX]
    if (fork) {
      throw new Error(
        `Session deletion was refused because fork ${fork.derived_session_id} still depends on it.`,
      )
    }
  })
}

function assertSessionHasNoWorkers(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly child_session_id: string }>`
      SELECT child_session_id
      FROM session_spawn_lineage
      WHERE parent_session_id = ${id} OR hive_root_session_id = ${id}
      ORDER BY depth, created_at, child_session_id
      LIMIT 1
    `
    const worker = rows[EMPTY_INDEX]
    if (worker) {
      throw new Error(
        `Session deletion was refused because worker ${worker.child_session_id} still depends on it.`,
      )
    }
  })
}

function assertSessionDeleteSatisfiesForeignKeys(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.gen(function* () {
    yield* sql.unsafe('SAVEPOINT session_deletion_preflight')
    const deletion = yield* Effect.either(sql`DELETE FROM sessions WHERE id = ${id}`)
    yield* sql.unsafe('ROLLBACK TO SAVEPOINT session_deletion_preflight')
    yield* sql.unsafe('RELEASE SAVEPOINT session_deletion_preflight')
    if (deletion._tag === 'Left') {
      throw new Error(
        'Session deletion was refused because related durable state still depends on it.',
        { cause: deletion.left },
      )
    }
  })
}

export async function prepareSessionDeletion(id: SessionId): Promise<SessionDeletionRecord> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* readDeletion(sql, id)
          if (existing[EMPTY_INDEX]) return deletionRecord(existing[EMPTY_INDEX], true)
          yield* assertSessionHasNoForks(sql, id)
          yield* assertSessionHasNoWorkers(sql, id)
          yield* assertSessionDeleteSatisfiesForeignKeys(sql, id)
          const sessions = yield* sql<{
            readonly project_path: string | null
            readonly pi_session_file: string | null
            readonly worktree_project_path: string | null
            readonly worktree_path: string | null
          }>`
            SELECT sessions.project_path, sessions.pi_session_file,
                   COALESCE(workspaces.project_path, sessions.project_path) AS worktree_project_path,
                   CASE WHEN workspaces.kind = 'managed-worktree'
                        THEN workspaces.working_path ELSE sessions.worktree_path END AS worktree_path
            FROM sessions
            LEFT JOIN session_workspace_bindings AS bindings ON bindings.session_id = sessions.id
            LEFT JOIN workspace_resources AS workspaces ON workspaces.id = bindings.workspace_id
            WHERE sessions.id = ${id}
            LIMIT 1
          `
          const session = sessions[EMPTY_INDEX]
          if (!session) throw new Error(`Session ${id} does not exist.`)
          const now = Date.now()
          yield* sql`
            INSERT INTO session_deletion_operations (
              session_id, phase, project_path, worktree_project_path, worktree_path,
              pi_session_file, created_at, updated_at
            ) VALUES (
              ${id}, ${'prepared'}, ${session.project_path}, ${session.worktree_project_path},
              ${session.worktree_path}, ${session.pi_session_file}, ${now}, ${now}
            )
          `
          return {
            phase: 'prepared',
            resumed: false,
            piSessionFile: session.pi_session_file,
            stagedPiSessionFile: null,
            projectPath: session.project_path,
            worktreeProjectPath: session.worktree_project_path,
            worktreePath: session.worktree_path,
            checkpointRefs: [],
          } as const
        }),
      )
    }),
  )
}

export async function commitSessionDeletion(id: SessionId): Promise<SessionDeletionRecord> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* assertSessionHasNoForks(sql, id)
          yield* assertSessionHasNoWorkers(sql, id)
          const bindings = yield* sql<{ readonly workspace_id: string }>`
            SELECT workspace_id FROM session_workspace_bindings WHERE session_id = ${id} LIMIT 1
          `
          yield* sql`DELETE FROM sessions WHERE id = ${id}`
          const workspaceId = bindings[EMPTY_INDEX]?.workspace_id
          if (workspaceId) {
            yield* sql`
              DELETE FROM workspace_resources WHERE id = ${workspaceId}
                AND NOT EXISTS (
                  SELECT 1 FROM session_workspace_bindings WHERE workspace_id = ${workspaceId}
                )
            `
          }
          yield* sql`
            UPDATE session_deletion_operations
            SET phase = ${'durable-delete-complete'}, updated_at = ${Date.now()}
            WHERE session_id = ${id} AND phase = ${'prepared'}
          `
          const rows = yield* readDeletion(sql, id)
          const row = rows[EMPTY_INDEX]
          if (!row) throw new Error(`Session deletion journal disappeared for ${id}.`)
          return deletionRecord(row, true)
        }),
      )
    }),
  )
}

export async function prepareSessionCheckpointRefCleanup(
  id: SessionId,
  refs: readonly SessionDeletionCheckpointRef[],
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_deletion_operations
        SET phase = ${'checkpoint-ref-cleanup-pending'},
            checkpoint_refs_json = ${JSON.stringify(refs)}, updated_at = ${Date.now()}
        WHERE session_id = ${id} AND phase = ${'durable-delete-complete'}
      `
    }),
  )
}

export async function prepareSessionPiFileCleanup(
  id: SessionId,
  piSessionFile: string | null,
): Promise<SessionDeletionRecord> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const stagedPiSessionFile = piSessionFile ? `${piSessionFile}.${randomUUID()}.delete` : null
      yield* sql`
        UPDATE session_deletion_operations
        SET phase = ${'pi-file-cleanup-pending'}, pi_session_file = ${piSessionFile},
            staged_pi_session_file = ${stagedPiSessionFile}, updated_at = ${Date.now()}
        WHERE session_id = ${id} AND phase = ${'external-cleanup-complete'}
      `
      const rows = yield* readDeletion(sql, id)
      const row = rows[EMPTY_INDEX]
      if (!row) throw new Error(`Session deletion journal disappeared for ${id}.`)
      return deletionRecord(row, true)
    }),
  )
}

export async function markSessionPiFileCleanupComplete(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_deletion_operations
        SET phase = ${'pi-file-cleanup-complete'}, updated_at = ${Date.now()}
        WHERE session_id = ${id} AND phase = ${'pi-file-cleanup-pending'}
      `
    }),
  )
}

export async function markSessionDeletionExternalCleanupComplete(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_deletion_operations
        SET phase = ${'external-cleanup-complete'}, updated_at = ${Date.now()}
        WHERE session_id = ${id}
      `
    }),
  )
}

export async function abandonSessionDeletion(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM session_deletion_operations WHERE session_id = ${id}`
    }),
  )
}

export async function listPendingSessionDeletions(): Promise<SessionId[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly session_id: string }>`
        SELECT session_id FROM session_deletion_operations ORDER BY created_at, session_id
      `
      return rows.map((row) => SessionId(row.session_id))
    }),
  )
}
