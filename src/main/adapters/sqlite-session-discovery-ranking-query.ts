import type * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_DISCOVERY_WINDOW_LIMIT } from './session-discovery-window-store'

const SINGLE_NATIVE_TERM_PATTERN = /^[A-Za-z0-9]+$/u
const MAX_SIGNATURE_GROUPS = 64
const CANDIDATE_WORK_RATIO = 2

interface DiscoveryRankingParameters {
  readonly exactQuery: string
  readonly discoveryFtsQuery: string
  readonly fullTranscript: number
  readonly includeArchived: number
}

function discoveryFtsRows(
  sql: SqlClient.SqlClient,
  parameters: DiscoveryRankingParameters,
  requiresEligibleSessionJoin: boolean,
  useFallbackGate = false,
) {
  const eligibleSessionJoin = requiresEligibleSessionJoin
    ? sql`JOIN eligible_sessions
        ON eligible_sessions.session_id = discovery_metadata.c0`
    : sql``
  // FTS5 documents c0/c1 as the stored session_id/archived values. Keep this read-only join aligned
  // with the search schema; using the virtual columns would add a content callback for every hit.
  return sql`
    SELECT discovery_metadata.c0 AS session_id,
      bm25(session_node_discovery_search, 0.0, 0.0, 3.0, 3.0) AS score
    FROM ${useFallbackGate ? sql`discovery_slow_path CROSS JOIN` : sql``}
      session_node_discovery_search
    JOIN session_node_discovery_search_content AS discovery_metadata
      ON discovery_metadata.id = session_node_discovery_search.rowid
    ${eligibleSessionJoin}
    WHERE ${parameters.fullTranscript} = 0
      AND (${parameters.includeArchived} = 1 OR discovery_metadata.c1 = ${0})
      AND session_node_discovery_search MATCH ${parameters.discoveryFtsQuery}
  `
}

function nativeDiscoveryRanking(sql: SqlClient.SqlClient, parameters: DiscoveryRankingParameters) {
  const candidateLimit = SESSION_DISCOVERY_WINDOW_LIMIT + 1
  const term = parameters.exactQuery.toLowerCase()
  // The control rows prevent the unused branch from opening another MATCH cursor. Unary + on the
  // rowid membership test keeps one cursor instead of reinitializing BM25 statistics per group.
  return sql`
    discovery_ranked_sessions AS MATERIALIZED (
      WITH discovery_signatures AS MATERIALIZED (
        SELECT initial_frequency, preview_frequency, token_count, representative_rowid, member_count
        FROM session_discovery_term_signatures
        WHERE term = ${term} LIMIT ${MAX_SIGNATURE_GROUPS + 1}
      ), discovery_admission AS MATERIALIZED (
        SELECT COUNT(*) <= ${MAX_SIGNATURE_GROUPS}
          AND SUM(MIN(member_count, ${candidateLimit})) * ${CANDIDATE_WORK_RATIO}
            < SUM(member_count) AS use_groups
        FROM discovery_signatures
      ), discovery_fast_path AS MATERIALIZED (
        SELECT 1 FROM discovery_admission WHERE use_groups = 1
      ), discovery_slow_path AS MATERIALIZED (
        SELECT 1 FROM discovery_admission WHERE use_groups IS NOT 1
      ), discovery_representative_scores AS MATERIALIZED (
        SELECT rowid, bm25(session_node_discovery_search, 0.0, 0.0, 3.0, 3.0) AS score
        FROM discovery_fast_path CROSS JOIN session_node_discovery_search
        WHERE session_node_discovery_search MATCH ${parameters.discoveryFtsQuery}
          AND +rowid IN (SELECT representative_rowid FROM discovery_signatures)
      ), discovery_native_scores AS MATERIALIZED (
        SELECT signatures.*, scores.score
        FROM discovery_signatures AS signatures
        JOIN discovery_representative_scores AS scores
          ON scores.rowid = signatures.representative_rowid
      ), discovery_group_candidates AS MATERIALIZED (
        SELECT members.value AS session_id, native_scores.score
        FROM discovery_native_scores AS native_scores CROSS JOIN json_each((
          SELECT json_group_array(session_id) FROM (
            SELECT postings.session_id
            FROM session_discovery_term_postings AS postings
              INDEXED BY idx_session_discovery_term_members
            JOIN session_node_discovery_search_content AS content
              ON content.id = postings.search_rowid
            WHERE postings.term = ${term}
              AND postings.initial_frequency = native_scores.initial_frequency
              AND postings.preview_frequency = native_scores.preview_frequency
              AND postings.token_count = native_scores.token_count
              AND (${parameters.includeArchived} = 1 OR content.c1 = ${0})
            ORDER BY postings.session_id LIMIT ${candidateLimit}
          )
        )) AS members
        ORDER BY native_scores.score, members.value LIMIT ${candidateLimit}
      ), discovery_fallback_candidates AS NOT MATERIALIZED (
        ${discoveryFtsRows(sql, parameters, false, true)}
      )
      SELECT session_id, score FROM discovery_group_candidates
      UNION ALL SELECT session_id, score FROM discovery_fallback_candidates
      ORDER BY score, session_id LIMIT ${candidateLimit}
    )
  `
}

/**
 * A single-token query has two column-filtered phrases. Equal per-column frequencies and total
 * native token length therefore have the same native BM25 score, including its exact arithmetic.
 * The bounded group union retains each group's first window before the final score/Session-ID sort.
 * All eligibility and fallback decisions share this statement's read snapshot.
 */
export function lexicalDiscoveryRankingCte(
  sql: SqlClient.SqlClient,
  parameters: DiscoveryRankingParameters,
  requiresEligibleSessionJoin: boolean,
) {
  if (
    parameters.fullTranscript === 0 &&
    !requiresEligibleSessionJoin &&
    SINGLE_NATIVE_TERM_PATTERN.test(parameters.exactQuery)
  ) {
    return nativeDiscoveryRanking(sql, parameters)
  }
  return sql`
    discovery_ranked_sessions AS MATERIALIZED (
      ${discoveryFtsRows(sql, parameters, requiresEligibleSessionJoin)}
      ORDER BY score, session_id LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    )
  `
}
