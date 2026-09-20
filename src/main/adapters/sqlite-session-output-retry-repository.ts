import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionOutputRetryRepositoryError } from '../errors'
import {
  type PendingSessionOutput,
  SessionOutputRetryRepository,
  type SessionOutputRetryRepositoryShape,
} from '../ports/session-output-retry-repository'

interface PendingOutputRow {
  readonly id: string
  readonly session_id: string
  readonly kind: 'commit' | 'change-request'
  readonly commit_hash: string | null
  readonly summary: string | null
  readonly title: string | null
  readonly url: string | null
  readonly node_id: string | null
  readonly branch_id: string | null
  readonly created_at: number
  readonly updated_at: number
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionOutputRetryRepositoryError({ operation, cause })
}

function decodeRow(row: PendingOutputRow): PendingSessionOutput {
  const base = {
    id: row.id,
    sessionId: SessionId(row.session_id),
    nodeId: row.node_id,
    branchId: row.branch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.kind === 'commit' && row.commit_hash !== null && row.summary !== null) {
    return { ...base, kind: 'commit', commitHash: row.commit_hash, summary: row.summary }
  }
  if (row.kind === 'change-request' && row.title !== null && row.url !== null) {
    return { ...base, kind: 'change-request', title: row.title, url: row.url }
  }
  throw new Error(`Invalid pending session Output row: ${row.id}`)
}

export const SqliteSessionOutputRetryRepositoryLive = Layer.effect(
  SessionOutputRetryRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionOutputRetryRepository.of({
      put: (output) =>
        sql<PendingOutputRow>`
          INSERT INTO session_output_retries (
            id, session_id, kind, commit_hash, summary, title, url,
            node_id, branch_id, created_at, updated_at
          ) VALUES (
            ${output.id},
            ${output.sessionId},
            ${output.kind},
            ${output.kind === 'commit' ? output.commitHash : null},
            ${output.kind === 'commit' ? output.summary : null},
            ${output.kind === 'change-request' ? output.title : null},
            ${output.kind === 'change-request' ? output.url : null},
            ${output.nodeId},
            ${output.branchId},
            ${output.createdAt},
            ${output.updatedAt}
          )
          ON CONFLICT(id) DO UPDATE SET
            commit_hash = CASE
              WHEN excluded.updated_at >= session_output_retries.updated_at
                THEN excluded.commit_hash
              ELSE session_output_retries.commit_hash
            END,
            summary = CASE
              WHEN excluded.updated_at >= session_output_retries.updated_at
                THEN excluded.summary
              ELSE session_output_retries.summary
            END,
            title = CASE
              WHEN excluded.updated_at >= session_output_retries.updated_at
                THEN excluded.title
              ELSE session_output_retries.title
            END,
            url = CASE
              WHEN excluded.updated_at >= session_output_retries.updated_at
                THEN excluded.url
              ELSE session_output_retries.url
            END,
            updated_at = MAX(session_output_retries.updated_at, excluded.updated_at)
          WHERE session_output_retries.session_id = excluded.session_id
            AND session_output_retries.kind = excluded.kind
          RETURNING id, session_id, kind, commit_hash, summary, title, url,
                    node_id, branch_id, created_at, updated_at
        `.pipe(
          Effect.mapError((cause) => repositoryError('put', cause)),
          Effect.flatMap((rows) => {
            const row = rows[0]
            return row
              ? Effect.try({
                  try: () => decodeRow(row),
                  catch: (cause) => repositoryError('put', cause),
                })
              : Effect.fail(
                  repositoryError(
                    'put',
                    new Error(`Pending Session Output identity conflict: ${output.id}`),
                  ),
                )
          }),
        ),
      list: (sessionId) =>
        sql<PendingOutputRow>`
          SELECT id, session_id, kind, commit_hash, summary, title, url,
                 node_id, branch_id, created_at, updated_at
          FROM session_output_retries
          WHERE session_id = ${sessionId}
          ORDER BY created_at ASC, id ASC
        `.pipe(
          Effect.map((rows) => rows.map(decodeRow)),
          Effect.mapError((cause) => repositoryError('list', cause)),
        ),
      remove: (output) =>
        sql`
          DELETE FROM session_output_retries
          WHERE id = ${output.id}
            AND session_id = ${output.sessionId}
            AND kind = ${output.kind}
            AND commit_hash IS ${output.kind === 'commit' ? output.commitHash : null}
            AND summary IS ${output.kind === 'commit' ? output.summary : null}
            AND title IS ${output.kind === 'change-request' ? output.title : null}
            AND url IS ${output.kind === 'change-request' ? output.url : null}
            AND node_id IS ${output.nodeId}
            AND branch_id IS ${output.branchId}
            AND created_at = ${output.createdAt}
            AND updated_at = ${output.updatedAt}
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) => repositoryError('remove', cause)),
        ),
    } satisfies SessionOutputRetryRepositoryShape)
  }),
)
