import * as SqlClient from '@effect/sql/SqlClient'
import { DEFAULT_SESSION_TITLE } from '@shared/session-title-source'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { AdoptDiscoveredPiSessionInput } from '../../ports/pi-session-discovery'
import { readPiProjectionFreshnessWithSql } from '../pi-session-file-freshness'
import { runStoreEffect } from '../store-runtime'
import { isAgentLoopAuditNode } from './agent-loop-audit-node'
import { discoveredPiEntryNodeIdPrefix } from './discovered-pi-entry-node-ids'
import { deletionRefusalOf } from './pi-session-deletion-refusal'
import { assertSessionDeletable } from './session-deletion-preflight'

export interface PiSessionDiscoveryScopeRows {
  readonly knownPiSessionIds: ReadonlySet<string>
  readonly knownPiSessionFiles: ReadonlySet<string>
  readonly sessionProjectPaths: readonly string[]
}

interface KnownSessionRow {
  readonly id: string
  readonly pi_session_id: string
  readonly pi_session_file: string | null
}

/**
 * The Sessions and pending deletions Pi session discovery must not list again. A Session being
 * deleted still counts: its row goes before its Pi file does, and listing the file in between
 * would bring the deleted Session back.
 */
export async function readPiSessionDiscoveryScope(): Promise<PiSessionDiscoveryScopeRows> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* sql<KnownSessionRow>`
        SELECT id, pi_session_id, pi_session_file FROM sessions
      `
      const deletions = yield* sql<{
        readonly session_id: string
        readonly pi_session_file: string | null
      }>`SELECT session_id, pi_session_file FROM session_deletion_operations`
      const projects = yield* sql<{ readonly project_path: string }>`
        SELECT DISTINCT project_path FROM sessions
        WHERE archived = ${0} AND project_path IS NOT NULL
      `
      const knownPiSessionIds = new Set<string>()
      const knownPiSessionFiles = new Set<string>()
      for (const row of sessions) {
        knownPiSessionIds.add(row.id)
        knownPiSessionIds.add(row.pi_session_id)
        if (row.pi_session_file) knownPiSessionFiles.add(row.pi_session_file)
      }
      for (const row of deletions) {
        knownPiSessionIds.add(row.session_id)
        if (row.pi_session_file) knownPiSessionFiles.add(row.pi_session_file)
      }
      // A fork or copy still being prepared has written its Pi file before its Session exists.
      const preparing = yield* sql<{ readonly pi_session_file: string }>`
        SELECT pi_session_file FROM session_lifecycle_preparation_attempts
        WHERE pi_session_file IS NOT NULL
      `
      for (const row of preparing) knownPiSessionFiles.add(row.pi_session_file)
      const dismissals = yield* sql<{
        readonly pi_session_id: string
        readonly pi_session_file: string
      }>`SELECT pi_session_id, pi_session_file FROM pi_session_dismissals`
      for (const row of dismissals) {
        knownPiSessionIds.add(row.pi_session_id)
        knownPiSessionFiles.add(row.pi_session_file)
      }
      return {
        knownPiSessionIds,
        knownPiSessionFiles,
        sessionProjectPaths: projects.map((row) => row.project_path),
      }
    }),
  )
}

/**
 * Points a Session the Session Host just created at a discovered Pi session file, in place of the
 * empty Pi session it was created with (Pi writes that one only after its first reply, so there is
 * no file to remove). Refused when another Session already has the file or its id, or once the
 * Session holds a transcript of its own. The adoption marks the Session as discovered: its nodes
 * are keyed under a per-Session prefix, and deleting it keeps the file.
 */
export async function adoptDiscoveredPiSession(
  input: AdoptDiscoveredPiSessionInput,
): Promise<boolean> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const blocked = yield* sql<{ readonly blocked: number }>`
            SELECT EXISTS (
              SELECT 1 FROM sessions
              WHERE id <> ${input.sessionId}
                AND (pi_session_id = ${input.piSessionId} OR pi_session_file = ${input.piSessionFile})
            ) OR EXISTS (
              SELECT 1 FROM session_deletion_operations
              WHERE pi_session_file = ${input.piSessionFile}
            ) OR EXISTS (
              SELECT 1 FROM session_lifecycle_preparation_attempts
              WHERE pi_session_file = ${input.piSessionFile}
            ) OR EXISTS (
              SELECT 1 FROM pi_session_dismissals
              WHERE pi_session_file = ${input.piSessionFile}
                OR pi_session_id = ${input.piSessionId}
            ) OR EXISTS (
              SELECT 1 FROM session_nodes WHERE session_id = ${input.sessionId}
            ) OR NOT EXISTS (
              SELECT 1 FROM sessions WHERE id = ${input.sessionId}
            ) AS blocked
          `
          if (blocked[0]?.blocked !== 0) return false
          // Last, inside the transaction: a project removal that started after this check sees
          // the adopted Session when it reads the project's Sessions again.
          if (!input.isStillWanted()) return false
          // Discovery chose the title, not the user, so a later Pi `/name` may replace it.
          yield* sql`
            UPDATE sessions
            SET pi_session_id = ${input.piSessionId}, pi_session_file = ${input.piSessionFile},
                created_at = ${input.createdAt}, updated_at = ${input.updatedAt},
                title_source = CASE WHEN title = ${DEFAULT_SESSION_TITLE}
                  THEN ${'default'} ELSE ${'generated'} END
            WHERE id = ${input.sessionId}
          `
          yield* sql`
            INSERT INTO pi_session_adoptions (session_id, adopted_at, cwd)
            VALUES (${input.sessionId}, ${Date.now()}, ${input.cwd})
          `
          return true
        }),
      )
    }),
  )
}

/** See `PiSessionDiscoveryRepositoryShape.listUnattachedDiscoveredSessions`. */
export async function listUnattachedDiscoveredPiSessions(): Promise<readonly SessionId[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly session_id: string }>`
        SELECT DISTINCT sessions.id AS session_id FROM session_operations
        JOIN sessions ON sessions.id = json_extract(session_operations.outcome_json, '$.sessionId')
        JOIN pi_session_discovery_creates
          ON pi_session_discovery_creates.idempotency_key = session_operations.idempotency_key
        WHERE session_operations.operation = ${'create'}
          AND NOT EXISTS (SELECT 1 FROM pi_session_adoptions WHERE session_id = sessions.id)
          AND NOT EXISTS (SELECT 1 FROM session_nodes WHERE session_id = sessions.id)
      `
      return rows.map((row) => SessionId(row.session_id))
    }),
  )
}

/**
 * Why the Session cannot be deleted, as an Effect on the store's connection. The check ends with
 * a trial delete it rolls back to a savepoint; outside a transaction another fiber's statement
 * could land between the two on the one connection and be rolled back with it, so it holds the
 * connection in a transaction of its own throughout.
 */
export function piSessionDeletionRefusalWithSql(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql.withTransaction(
    Effect.gen(function* () {
      // The check throws, as the deletion it guards does; its rollback leaves nothing changed.
      return yield* deletionRefusalOf(yield* Effect.exit(assertSessionDeletable(sql, sessionId)))
    }),
  )
}

/** See `PiSessionDiscoveryRepositoryShape.deletionRefusal`. */
export async function piSessionDeletionRefusal(sessionId: SessionId) {
  return runStoreEffect(
    Effect.flatMap(SqlClient.SqlClient, (sql) => piSessionDeletionRefusalWithSql(sql, sessionId)),
  )
}

/** See `PiSessionDiscoveryRepositoryShape.listAdoptedPiSessionFiles`. */
export async function listAdoptedPiSessionFiles() {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly session_id: string; readonly pi_session_file: string }>`
        SELECT sessions.id AS session_id, sessions.pi_session_file FROM sessions
        JOIN pi_session_adoptions ON pi_session_adoptions.session_id = sessions.id
        WHERE sessions.pi_session_file IS NOT NULL
      `
      return rows.map((row) => ({
        sessionId: SessionId(row.session_id),
        piSessionFile: row.pi_session_file,
      }))
    }),
  )
}

/** See `PiSessionDiscoveryRepositoryShape.listCreatedPiSessionFiles`. */
export async function listCreatedPiSessionFiles() {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly session_id: string; readonly pi_session_file: string }>`
        SELECT sessions.id AS session_id, sessions.pi_session_file FROM sessions
        WHERE sessions.pi_session_file IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pi_session_adoptions WHERE session_id = sessions.id)
          AND EXISTS (SELECT 1 FROM session_nodes WHERE session_id = sessions.id)
      `
      return rows.map((row) => ({
        sessionId: SessionId(row.session_id),
        piSessionFile: row.pi_session_file,
      }))
    }),
  )
}

/** See `PiSessionDiscoveryRepositoryShape.recordDiscoveryCreate`. */
export async function recordPiSessionDiscoveryCreate(idempotencyKey: string) {
  await runStoreEffect(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        INSERT INTO pi_session_discovery_creates (idempotency_key, created_at)
        VALUES (${idempotencyKey}, ${Date.now()})
        ON CONFLICT (idempotency_key) DO NOTHING
      `,
    ),
  )
}

/** See `PiSessionDiscoveryRepositoryShape.forgetDiscoveryCreates`. */
export async function forgetPiSessionDiscoveryCreates(idempotencyKeys?: readonly string[]) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (!idempotencyKeys) {
        yield* sql`DELETE FROM pi_session_discovery_creates`
        return
      }
      for (const key of idempotencyKeys) {
        yield* sql`DELETE FROM pi_session_discovery_creates WHERE idempotency_key = ${key}`
      }
    }),
  )
}

export interface PiSessionProjectionStateRow {
  readonly sessionId: SessionId
  readonly piSessionFile: string | null
  readonly projectPath: string | null
  readonly piEntryNodeIdPrefix?: string
  readonly projectedPiEntryCount: number
  /** The ids of the projected nodes, so a file rewritten under new ids is not taken as projected. */
  readonly projectedNodeIds: ReadonlySet<string>
  readonly revision: number
  readonly fingerprint: { readonly size: number; readonly mtimeMs: number } | null
}

export async function getPiSessionProjectionState(
  sessionId: SessionId,
): Promise<PiSessionProjectionStateRow | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* sql<{
        readonly pi_session_file: string | null
        readonly project_path: string | null
        readonly adopted: number
      }>`
        SELECT pi_session_file, project_path,
          EXISTS (SELECT 1 FROM pi_session_adoptions WHERE session_id = sessions.id) AS adopted
        FROM sessions WHERE id = ${sessionId} LIMIT 1
      `
      const session = sessions[0]
      if (!session) return null
      const { revision, fingerprint } = yield* readPiProjectionFreshnessWithSql(sql, sessionId)
      const nodes = yield* sql<{ readonly id: string }>`
        SELECT id FROM session_nodes WHERE session_id = ${sessionId}
      `
      const customNodes = yield* sql<{ readonly kind: string; readonly content_json: string }>`
        SELECT kind, content_json FROM session_nodes
        WHERE session_id = ${sessionId} AND kind = ${'custom'}
      `
      const auditNodes = customNodes.filter((node) =>
        isAgentLoopAuditNode({ kind: node.kind, contentJson: node.content_json }),
      ).length
      return {
        sessionId: SessionId(String(sessionId)),
        piSessionFile: session.pi_session_file,
        projectPath: session.project_path,
        ...(session.adopted === 1
          ? { piEntryNodeIdPrefix: discoveredPiEntryNodeIdPrefix(sessionId) }
          : {}),
        projectedPiEntryCount: nodes.length - auditNodes,
        projectedNodeIds: new Set(nodes.map((node) => String(node.id))),
        revision,
        fingerprint,
      }
    }),
  )
}
