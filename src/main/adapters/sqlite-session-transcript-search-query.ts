import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION_DISCOVERY_WINDOW_LIMIT } from './session-discovery-window-store'
import type { DiscoverySearchRequest } from './sqlite-session-discovery-window'

interface TranscriptSearchParameters {
  readonly ftsQuery: string
  readonly includeArchived: number
  readonly phraseTranscriptSearch: number
  readonly termTranscriptSearch: number
  readonly transcriptTerms: readonly string[]
}

interface TranscriptTermRow {
  readonly term: string
}

export function loadSeedTranscriptTerm(
  sql: SqlClient.SqlClient,
  parameters: TranscriptSearchParameters,
) {
  const [onlyTerm] = parameters.transcriptTerms
  if (parameters.termTranscriptSearch !== 1 || !onlyTerm) return Effect.succeed('')
  if (parameters.transcriptTerms.length === 1) return Effect.succeed(onlyTerm)
  const termsJson = JSON.stringify(parameters.transcriptTerms)
  return Effect.map(
    sql<TranscriptTermRow>`
      SELECT CAST(query_terms.value AS TEXT) AS term
      FROM json_each(${termsJson}) AS query_terms
      ORDER BY (
        SELECT COUNT(*) FROM session_transcript_terms AS candidate_terms
        WHERE candidate_terms.term = CAST(query_terms.value AS TEXT)
      ), CAST(query_terms.value AS TEXT)
      LIMIT 1
    `,
    (rows) => rows[0]?.term ?? onlyTerm,
  )
}

function matchingSessionOrder(sql: SqlClient.SqlClient, parameters: TranscriptSearchParameters) {
  const indexRankedSingleTerm =
    parameters.phraseTranscriptSearch === 0 && parameters.transcriptTerms.length === 1
  return {
    limit: indexRankedSingleTerm ? SESSION_DISCOVERY_WINDOW_LIMIT + 1 : -1,
    order: indexRankedSingleTerm
      ? sql`seed_terms.term_frequency DESC, seed_terms.session_id`
      : sql`seed_terms.session_id`,
  }
}

export function transcriptSessionCtes(
  sql: SqlClient.SqlClient,
  request: DiscoverySearchRequest,
  parameters: TranscriptSearchParameters,
  seedTranscriptTerm: string,
  allSessionsAuthorized: boolean,
) {
  const transcriptTermsJson = JSON.stringify(parameters.transcriptTerms)
  const matching = matchingSessionOrder(sql, parameters)
  const retainSingleTermEvidence =
    parameters.phraseTranscriptSearch === 0 && parameters.transcriptTerms.length === 1
  const nodeEvidenceSearch =
    parameters.phraseTranscriptSearch === 1 || parameters.transcriptTerms.length > 1
  return sql`
    query_transcript_terms AS MATERIALIZED (
      SELECT DISTINCT CAST(value AS TEXT) AS term FROM json_each(${transcriptTermsJson})
    ), matching_term_session_ids AS MATERIALIZED (
      SELECT seed_terms.session_id
      FROM session_transcript_terms AS seed_terms
      JOIN sessions ON sessions.id = seed_terms.session_id
      WHERE ${parameters.termTranscriptSearch} = 1
        AND seed_terms.term = ${seedTranscriptTerm}
        AND (${allSessionsAuthorized ? 1 : 0} = 1
          OR seed_terms.session_id IN (SELECT session_id FROM authorized_sessions))
        AND (${parameters.includeArchived} = 1 OR sessions.archived = 0)
        AND (${request.query.projectPath ?? null} IS NULL
          OR sessions.project_path = ${request.query.projectPath ?? null})
        AND (${request.query.workingPath ?? null} IS NULL OR EXISTS (
          SELECT 1 FROM session_workspace_bindings AS catalog_binding
          JOIN workspace_resources AS catalog_workspace
            ON catalog_workspace.id = catalog_binding.workspace_id
          WHERE catalog_binding.session_id = sessions.id
            AND catalog_workspace.working_path = ${request.query.workingPath ?? null}
        ))
        AND (${parameters.transcriptTerms.length > 1 ? 1 : 0} = 0 OR NOT EXISTS (
          SELECT 1 FROM query_transcript_terms AS required_term
          WHERE NOT EXISTS (
            SELECT 1 FROM session_transcript_terms AS candidate_term
            WHERE candidate_term.term = required_term.term
              AND candidate_term.session_id = seed_terms.session_id
          )
        ))
      ORDER BY ${matching.order}
      LIMIT ${matching.limit}
    ), term_transcript_sessions_unbounded AS MATERIALIZED (
      SELECT matching_ids.session_id,
        -SUM(matching_terms.term_frequency) AS score,
        NULL AS snippet,
        CASE WHEN ${retainSingleTermEvidence ? 1 : 0} = 1
          THEN MAX(matching_terms.first_node_id) ELSE NULL END AS first_node_id,
        CASE WHEN ${retainSingleTermEvidence ? 1 : 0} = 1
          THEN MAX(matching_terms.first_created_order) ELSE NULL END AS first_created_order,
        CASE WHEN ${retainSingleTermEvidence ? 1 : 0} = 1
          THEN MAX(matching_terms.first_run_id) ELSE NULL END AS first_run_id
      FROM matching_term_session_ids AS matching_ids
      JOIN session_transcript_terms AS matching_terms
        ON matching_terms.session_id = matching_ids.session_id
        AND matching_terms.term IN (SELECT term FROM query_transcript_terms)
      GROUP BY matching_ids.session_id
    ), attributable_node_matches AS MATERIALIZED (
      SELECT session_node_search.session_id, session_node_search.rowid AS search_rowid,
        bm25(session_node_search, 0.0, 0.0, 1.0) AS score,
        snippet(session_node_search, 2, '', '', ' … ', 12) AS snippet,
        session_node_search.node_id
      FROM session_node_search
      WHERE ${nodeEvidenceSearch ? 1 : 0} = 1
        AND session_node_search.rowid IN (
          SELECT search_rows.search_rowid
          FROM session_node_search_rows AS search_rows
          WHERE search_rows.session_id IN (SELECT session_id FROM matching_term_session_ids)
        )
        AND session_node_search MATCH ${parameters.ftsQuery}
    ), ranked_attributable_nodes AS MATERIALIZED (
      SELECT attributable_node_matches.*,
        ROW_NUMBER() OVER (
          PARTITION BY session_id ORDER BY score, search_rowid
        ) AS evidence_rank
      FROM attributable_node_matches
    ), term_transcript_sessions AS MATERIALIZED (
      SELECT terms.session_id, terms.score, attributable.snippet,
        COALESCE(terms.first_node_id, nodes.id) AS first_node_id,
        COALESCE(terms.first_created_order, nodes.created_order) AS first_created_order,
        COALESCE(
          terms.first_run_id,
          json_extract(nodes.metadata_json, '$.openWaggle.runId')
        ) AS first_run_id
      FROM term_transcript_sessions_unbounded AS terms
      LEFT JOIN ranked_attributable_nodes AS attributable
        ON attributable.session_id = terms.session_id AND attributable.evidence_rank = 1
      LEFT JOIN session_nodes AS nodes ON nodes.id = attributable.node_id
      WHERE ${parameters.phraseTranscriptSearch} = 0
      ORDER BY terms.score, terms.session_id
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    ), phrase_transcript_sessions AS MATERIALIZED (
      SELECT ranked.session_id, ranked.score, ranked.snippet,
        nodes.id AS first_node_id, nodes.created_order AS first_created_order,
        json_extract(nodes.metadata_json, '$.openWaggle.runId') AS first_run_id
      FROM ranked_attributable_nodes AS ranked
      JOIN session_nodes AS nodes ON nodes.id = ranked.node_id
      WHERE ${parameters.phraseTranscriptSearch} = 1 AND ranked.evidence_rank = 1
      ORDER BY ranked.score, ranked.session_id
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    ), transcript_sessions AS MATERIALIZED (
      SELECT * FROM term_transcript_sessions
      UNION ALL
      SELECT * FROM phrase_transcript_sessions
    )
  `
}
