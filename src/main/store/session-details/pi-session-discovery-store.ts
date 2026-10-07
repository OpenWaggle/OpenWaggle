import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { AdoptDiscoveredPiSessionInput } from '../../ports/pi-session-discovery'
import { readPiProjectionFreshnessWithSql } from '../pi-session-file-freshness'
import { runStoreEffect } from '../store-runtime'
import { isAgentLoopAuditNode } from './agent-loop-audit-node'
import { discoveredPiEntryNodeIdPrefix } from './discovered-pi-entry-node-ids'

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
          yield* sql`
            UPDATE sessions
            SET pi_session_id = ${input.piSessionId}, pi_session_file = ${input.piSessionFile},
                created_at = ${input.createdAt}, updated_at = ${input.updatedAt}
            WHERE id = ${input.sessionId}
          `
          yield* sql`
            INSERT INTO pi_session_adoptions (session_id, adopted_at)
            VALUES (${input.sessionId}, ${Date.now()})
          `
          return true
        }),
      )
    }),
  )
}

export interface PiSessionProjectionStateRow {
  readonly sessionId: SessionId
  readonly piSessionFile: string | null
  readonly projectPath: string | null
  readonly piEntryNodeIdPrefix?: string
  readonly projectedPiEntryCount: number
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
        ...(session.adopted === 1
          ? { piEntryNodeIdPrefix: discoveredPiEntryNodeIdPrefix(sessionId) }
          : {}),
        projectedPiEntryCount: (counts[0]?.node_count ?? 0) - auditNodes,
        revision,
        fingerprint,
      }
    }),
  )
}
