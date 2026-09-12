import type * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'
import type { DiscoverySearchRequest } from '../sqlite-session-discovery-window'
import { lexicalFtsQuery, loadLexicalDiscoveryRows } from '../sqlite-session-lexical-search'

export function nativeRankingRequest(
  overrides: Partial<DiscoverySearchRequest['query']> = {},
): DiscoverySearchRequest {
  return {
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: 'native-ranking',
    query: { operation: 'search', query: 'markernative', mode: 'lexical', limit: 50, ...overrides },
  }
}

export function seedNativeRankingSessions(sql: SqlClient.SqlClient, count = 1200) {
  return Effect.gen(function* () {
    yield* sql.unsafe(
      `
      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < ?
      )
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      SELECT printf('native-%04d', value), printf('pi-native-%04d', value),
        'Unrelated title', value, value FROM sequence;
    `,
      [count - 1],
    )
    yield* sql.unsafe(`
      INSERT INTO session_nodes (
        id, session_id, kind, role, timestamp_ms, content_json, metadata_json, created_order
      )
      SELECT id || '-node', id, 'message', 'user', 1,
        '{"text":"markernative filler"}', '{}', 0 FROM sessions WHERE id LIKE 'native-%';
    `)
  })
}

export function compareNativeRanking(
  sql: SqlClient.SqlClient,
  overrides: Partial<DiscoverySearchRequest['query']> = {},
) {
  return Effect.gen(function* () {
    const request = nativeRankingRequest(overrides)
    const rows = yield* loadLexicalDiscoveryRows(sql, undefined, request)
    const ftsQuery = lexicalFtsQuery(request.query.query)
    const reference = yield* sql<{ readonly session_id: string; readonly score: number }>`
      SELECT session_id, bm25(session_node_discovery_search, 0.0, 0.0, 3.0, 3.0) AS score
      FROM session_node_discovery_search
      WHERE (${request.query.includeArchived ? 1 : 0} = 1 OR archived = 0)
        AND session_node_discovery_search MATCH
          ${`initial_objective : (${ftsQuery}) OR current_preview : (${ftsQuery})`}
      ORDER BY score, session_id LIMIT 501
    `
    expect(rows.map(({ session_id, score }) => ({ session_id, score }))).toEqual(reference)
    return rows
  })
}

export function verifyNativeDiscoveryFacts(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const postings = yield* sql.unsafe(`
      SELECT session_id, term, search_rowid, initial_frequency, preview_frequency, token_count
      FROM session_discovery_term_postings ORDER BY session_id, term
    `)
    const reference = yield* sql.unsafe(`
      SELECT mapping.session_id, grouped.term, grouped.doc AS search_rowid,
        grouped.initial_frequency, grouped.preview_frequency,
        SUM(grouped.occurrences) OVER (PARTITION BY grouped.doc) AS token_count
      FROM (
        SELECT term, doc, SUM(col = 'initial_objective') AS initial_frequency,
          SUM(col = 'current_preview') AS preview_frequency, COUNT(*) AS occurrences
        FROM native_ranking_reference_vocabulary GROUP BY term, doc
      ) AS grouped
      JOIN session_discovery_search_rows AS mapping ON mapping.search_rowid = grouped.doc
      ORDER BY mapping.session_id, grouped.term
    `)
    expect(postings).toEqual(reference)
    const groups = yield* sql.unsafe(`
      SELECT term, initial_frequency, preview_frequency, token_count, member_count
      FROM session_discovery_term_signatures
      ORDER BY term, initial_frequency, preview_frequency, token_count
    `)
    const expectedGroups = yield* sql.unsafe(`
      SELECT term, initial_frequency, preview_frequency, token_count, COUNT(*) AS member_count
      FROM session_discovery_term_postings
      GROUP BY term, initial_frequency, preview_frequency, token_count
      ORDER BY term, initial_frequency, preview_frequency, token_count
    `)
    expect(groups).toEqual(expectedGroups)
    const missing = yield* sql.unsafe(`
      SELECT signatures.term FROM session_discovery_term_signatures AS signatures
      LEFT JOIN session_discovery_term_postings AS postings
        ON postings.term = signatures.term
        AND postings.search_rowid = signatures.representative_rowid
        AND postings.initial_frequency = signatures.initial_frequency
        AND postings.preview_frequency = signatures.preview_frequency
        AND postings.token_count = signatures.token_count
      WHERE postings.term IS NULL
    `)
    expect(missing).toEqual([])
    expect(yield* sql.unsafe('SELECT rowid FROM session_discovery_term_stage')).toEqual([])
    expect(yield* sql.unsafe('PRAGMA foreign_key_check')).toEqual([])
  })
}
