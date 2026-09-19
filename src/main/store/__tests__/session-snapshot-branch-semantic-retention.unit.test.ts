import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { CURRENT_SESSION_SCHEMA_STATEMENTS } from '../../services/database-schema'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { persistSessionSnapshotWithSql } from '../session-details/persist-snapshot'
import { transcriptNode } from './session-snapshot-semantic-retention.test-support'

describe('Session snapshot branch semantic retention', () => {
  it('retains transcript embeddings when navigating to another existing branch', async () => {
    const sessionId = SessionId('semantic-branch-retention')
    const nodes = [
      transcriptNode('root', null, 0, 'shared objective', 'run-root'),
      transcriptNode('main-head', 'root', 1, 'main response', 'run-main'),
      { ...transcriptNode('side-head', 'root', 2, 'side response', 'run-side'), pathDepth: 1 },
    ]
    const snapshot = { sessionId, piSessionId: 'pi-semantic-branch-retention', nodes }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('PRAGMA foreign_keys = ON')
        for (const statement of [
          ...CURRENT_SESSION_SCHEMA_STATEMENTS,
          ...SESSION_HOST_TARGET_SCHEMA_STATEMENTS,
        ]) {
          yield* sql.unsafe(statement)
        }
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES (${sessionId}, ${snapshot.piSessionId}, ${'Branch retention'}, ${1}, ${1})
        `
        yield* sql.withTransaction(
          persistSessionSnapshotWithSql(sql, { ...snapshot, activeNodeId: 'main-head' }, 1),
        )
        yield* sql`
          INSERT INTO session_transcript_embeddings (
            node_id, session_id, model_id, model_revision, dimensions,
            source_hash, vector, snapshot_revision, created_order, updated_at
          )
          SELECT id, session_id, ${'test/model'}, ${'revision-1'}, ${2},
            ${'stable-source'}, ${Buffer.from(new Float32Array([1, 0]).buffer)},
            ${1}, created_order, ${1}
          FROM session_nodes WHERE session_id = ${sessionId}
        `
        const before = yield* sql<{ readonly branch_hint_id: string }>`
          SELECT branch_hint_id FROM session_nodes WHERE id = ${'root'}
        `
        yield* sql.withTransaction(
          persistSessionSnapshotWithSql(sql, { ...snapshot, activeNodeId: 'side-head' }, 2),
        )
        const after = yield* sql<{
          readonly branch_hint_id: string
          readonly embedding_count: number
        }>`
          SELECT branch_hint_id,
            (SELECT COUNT(*) FROM session_transcript_embeddings
              WHERE session_id = ${sessionId}) AS embedding_count
          FROM session_nodes WHERE id = ${'root'}
        `
        return { before, after }
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' }))),
    )

    expect(result.after[0]?.branch_hint_id).not.toBe(result.before[0]?.branch_hint_id)
    expect(result.after[0]?.embedding_count).toBe(nodes.length)
  })
})
