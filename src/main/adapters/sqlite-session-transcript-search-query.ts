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
  return indexRankedSingleTerm
    ? sql`seed_terms.term_frequency DESC, seed_terms.session_id`
    : sql`(
        SELECT SUM(ranked_terms.term_frequency)
        FROM session_transcript_terms AS ranked_terms
        WHERE ranked_terms.session_id = seed_terms.session_id
          AND ranked_terms.term IN (SELECT term FROM query_transcript_terms)
      ) DESC, seed_terms.session_id`
}

export function transcriptSessionCtes(
  sql: SqlClient.SqlClient,
  request: DiscoverySearchRequest,
  parameters: TranscriptSearchParameters,
  seedTranscriptTerm: string,
  allSessionsAuthorized: boolean,
) {
  const retainSingleTermEvidence =
    parameters.phraseTranscriptSearch === 0 && parameters.transcriptTerms.length === 1
  const nodeEvidenceSearch =
    parameters.phraseTranscriptSearch === 1 || parameters.transcriptTerms.length > 1
  return sql`
    ${matchingTranscriptSessionCtes(
      sql,
      request,
      parameters,
      seedTranscriptTerm,
      allSessionsAuthorized,
    )}
    term_transcript_sessions_unbounded AS MATERIALIZED (
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
    ), attributable_nodes AS MATERIALIZED (
      SELECT matching_ids.session_id,
        (
          SELECT search_rows.node_id
          FROM session_node_search_rows AS search_rows
          JOIN session_nodes AS evidence_nodes ON evidence_nodes.id = search_rows.node_id
          WHERE search_rows.session_id = matching_ids.session_id
            AND EXISTS (
              SELECT 1 FROM session_node_search
              WHERE session_node_search.rowid = search_rows.search_rowid
                AND session_node_search MATCH ${parameters.ftsQuery}
            )
          ORDER BY evidence_nodes.created_order, evidence_nodes.id
          LIMIT 1
        ) AS node_id
      FROM matching_term_session_ids AS matching_ids
      WHERE ${nodeEvidenceSearch ? 1 : 0} = 1
    ), term_transcript_sessions AS MATERIALIZED (
      SELECT terms.session_id, terms.score, NULL AS snippet,
        COALESCE(terms.first_node_id, nodes.id) AS first_node_id,
        COALESCE(terms.first_created_order, nodes.created_order) AS first_created_order,
        COALESCE(
          terms.first_run_id,
          json_extract(nodes.metadata_json, '$.openWaggle.runId')
        ) AS first_run_id
      FROM term_transcript_sessions_unbounded AS terms
      LEFT JOIN attributable_nodes AS attributable
        ON attributable.session_id = terms.session_id
      LEFT JOIN session_nodes AS nodes ON nodes.id = attributable.node_id
      WHERE ${parameters.phraseTranscriptSearch} = 0
      ORDER BY terms.score, terms.session_id
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    ), phrase_transcript_sessions AS MATERIALIZED (
      SELECT terms.session_id, terms.score, NULL AS snippet,
        nodes.id AS first_node_id, nodes.created_order AS first_created_order,
        json_extract(nodes.metadata_json, '$.openWaggle.runId') AS first_run_id
      FROM term_transcript_sessions_unbounded AS terms
      JOIN attributable_nodes AS attributable ON attributable.session_id = terms.session_id
      JOIN session_nodes AS nodes ON nodes.id = attributable.node_id
      WHERE ${parameters.phraseTranscriptSearch} = 1
      ORDER BY terms.score, terms.session_id
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    ), transcript_sessions AS MATERIALIZED (
      SELECT * FROM term_transcript_sessions
      UNION ALL
      SELECT * FROM phrase_transcript_sessions
    )
  `
}

function matchingTranscriptSessionCtes(
  sql: SqlClient.SqlClient,
  request: DiscoverySearchRequest,
  parameters: TranscriptSearchParameters,
  seedTranscriptTerm: string,
  allSessionsAuthorized: boolean,
) {
  const transcriptTermsJson = JSON.stringify(parameters.transcriptTerms)
  const matchingOrder = matchingSessionOrder(sql, parameters)
  const projectPath = request.query.projectPath ?? null
  const workingPath = request.query.workingPath ?? null
  const authorizationBypass = allSessionsAuthorized ? 1 : 0
  const multipleTerms = parameters.transcriptTerms.length > 1 ? 1 : 0
  return sql`
    query_transcript_terms AS MATERIALIZED (
      SELECT DISTINCT CAST(value AS TEXT) AS term FROM json_each(${transcriptTermsJson})
    ), matching_non_phrase_session_ids AS MATERIALIZED (
      SELECT seed_terms.session_id
      FROM session_transcript_terms AS seed_terms
      JOIN sessions ON sessions.id = seed_terms.session_id
      WHERE ${parameters.termTranscriptSearch} = 1
        AND ${parameters.phraseTranscriptSearch} = 0
        AND seed_terms.term = ${seedTranscriptTerm}
        AND (${authorizationBypass} = 1
          OR seed_terms.session_id IN (SELECT session_id FROM authorized_sessions))
        AND (${parameters.includeArchived} = 1 OR sessions.archived = 0)
        AND (${projectPath} IS NULL OR sessions.project_path = ${projectPath})
        AND (${workingPath} IS NULL OR EXISTS (
          SELECT 1 FROM session_workspace_bindings AS catalog_binding
          JOIN workspace_resources AS catalog_workspace
            ON catalog_workspace.id = catalog_binding.workspace_id
          WHERE catalog_binding.session_id = sessions.id
            AND catalog_workspace.working_path = ${workingPath}
        ))
        AND (${multipleTerms} = 0 OR NOT EXISTS (
          SELECT 1 FROM query_transcript_terms AS required_term
          WHERE NOT EXISTS (
            SELECT 1 FROM session_transcript_terms AS candidate_term
            WHERE candidate_term.term = required_term.term
              AND candidate_term.session_id = seed_terms.session_id
          )
        ))
      ORDER BY ${matchingOrder}
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    ), matching_phrase_session_ids AS MATERIALIZED (
      SELECT phrase_matches.session_id
      FROM (
        SELECT DISTINCT search_rows.session_id
        FROM session_node_search
        JOIN session_node_search_rows AS search_rows
          ON search_rows.search_rowid = session_node_search.rowid
        JOIN sessions ON sessions.id = search_rows.session_id
        WHERE ${parameters.phraseTranscriptSearch} = 1
          AND session_node_search MATCH ${parameters.ftsQuery}
          AND (${authorizationBypass} = 1
            OR search_rows.session_id IN (SELECT session_id FROM authorized_sessions))
          AND (${parameters.includeArchived} = 1 OR sessions.archived = 0)
          AND (${projectPath} IS NULL OR sessions.project_path = ${projectPath})
          AND (${workingPath} IS NULL OR EXISTS (
            SELECT 1 FROM session_workspace_bindings AS catalog_binding
            JOIN workspace_resources AS catalog_workspace
              ON catalog_workspace.id = catalog_binding.workspace_id
            WHERE catalog_binding.session_id = sessions.id
              AND catalog_workspace.working_path = ${workingPath}
          ))
      ) AS phrase_matches
      JOIN session_transcript_terms AS ranked_terms
        ON ranked_terms.session_id = phrase_matches.session_id
        AND ranked_terms.term IN (SELECT term FROM query_transcript_terms)
      GROUP BY phrase_matches.session_id
      ORDER BY SUM(ranked_terms.term_frequency) DESC, phrase_matches.session_id
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    ), matching_term_session_ids AS MATERIALIZED (
      SELECT session_id FROM matching_non_phrase_session_ids
      UNION ALL
      SELECT session_id FROM matching_phrase_session_ids
    ),
  `
}
