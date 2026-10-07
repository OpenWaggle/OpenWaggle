import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { piProjectionFingerprint, piProjectionRevision } from '../pi-session-file-freshness'
import { runStoreEffect } from '../store-runtime'
import { isAgentLoopAuditNode } from './agent-loop-audit-node'
import {
  type DiscoveredPiSessionInsert,
  insertDiscoveredPiSessionWithSql,
} from './session-creation'

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
      return {
        knownPiSessionIds,
        knownPiSessionFiles,
        sessionProjectPaths: projects.map((row) => row.project_path),
      }
    }),
  )
}

function isKnownWithSql(sql: SqlClient.SqlClient, row: DiscoveredPiSessionInsert) {
  return Effect.map(
    sql<{ readonly known: number }>`
      SELECT EXISTS (
        SELECT 1 FROM sessions
        WHERE id = ${row.piSessionId} OR pi_session_id = ${row.piSessionId}
          OR pi_session_file = ${row.piSessionFile}
      ) OR EXISTS (
        SELECT 1 FROM session_deletion_operations
        WHERE session_id = ${row.piSessionId} OR pi_session_file = ${row.piSessionFile}
      ) AS known
    `,
    (rows) => rows[0]?.known === 1,
  )
}

/** Lists each discovered Pi session once; a row already known by id or file is left alone. */
export async function insertDiscoveredPiSessions(
  rows: readonly DiscoveredPiSessionInsert[],
): Promise<readonly SessionId[]> {
  if (rows.length === 0) return []
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const inserted: SessionId[] = []
          for (const row of rows) {
            if (yield* isKnownWithSql(sql, row)) continue
            inserted.push(yield* insertDiscoveredPiSessionWithSql(sql, row))
          }
          return inserted
        }),
      )
    }),
  )
}

export interface PiSessionProjectionStateRow {
  readonly sessionId: SessionId
  readonly piSessionFile: string | null
  readonly projectPath: string | null
  readonly projectedPiEntryCount: number
  readonly revision: number
  readonly fingerprint: { readonly size: number; readonly mtimeMs: number } | null
}

export async function getPiSessionProjectionState(
  sessionId: SessionId,
): Promise<PiSessionProjectionStateRow | null> {
  // Read before the rows, so a snapshot persisted during the read makes this state stale.
  const revision = piProjectionRevision(sessionId)
  const fingerprint = piProjectionFingerprint(sessionId)
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* sql<{
        readonly pi_session_file: string | null
        readonly project_path: string | null
      }>`SELECT pi_session_file, project_path FROM sessions WHERE id = ${sessionId} LIMIT 1`
      const session = sessions[0]
      if (!session) return null
      const counts = yield* sql<{ readonly node_count: number }>`
        SELECT COUNT(*) AS node_count FROM session_nodes WHERE session_id = ${sessionId}
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
        projectedPiEntryCount: (counts[0]?.node_count ?? 0) - auditNodes,
        revision,
        fingerprint,
      }
    }),
  )
}
