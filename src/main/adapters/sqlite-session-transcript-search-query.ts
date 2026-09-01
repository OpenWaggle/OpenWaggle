import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { SESSION_DISCOVERY_WINDOW_LIMIT } from './session-discovery-window-store'
import type { DiscoverySearchRequest } from './sqlite-session-discovery-window'
import { authorizedSessionScope } from './sqlite-session-query-support'

export const SESSION_TRANSCRIPT_LEXICAL_MATCH_SCAN_LIMIT = 8_192

interface TranscriptChunkScanRow {
  readonly search_rowid: number
  readonly session_id: string
}

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

export function loadTranscriptMatchRowids(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DiscoverySearchRequest,
  parameters: TranscriptSearchParameters,
) {
  if (parameters.phraseTranscriptSearch !== 1) return Effect.succeed<readonly number[]>([])
  const allowed = authorizedSessionScope(authority)
  return Effect.gen(function* () {
    const representativeRowids: number[] = []
    const seenSessionIds = new Set<string>()
    let afterRowid = 0
    while (representativeRowids.length < SESSION_DISCOVERY_WINDOW_LIMIT + 1) {
      const rows = yield* sql<TranscriptChunkScanRow>`
        SELECT session_transcript_search.rowid AS search_rowid,
          session_transcript_search.session_id
        FROM session_transcript_search
        JOIN sessions ON sessions.id = session_transcript_search.session_id
        LEFT JOIN session_spawn_lineage
          ON session_spawn_lineage.child_session_id = sessions.id
        WHERE session_transcript_search.rowid > ${afterRowid}
          AND session_transcript_search MATCH ${parameters.ftsQuery}
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
          AND (${allowed.all} = 1 OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
            OR sessions.id IN ${sql.in(allowed.sessionIds)}
            OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
              IN ${sql.in(allowed.hiveRootSessionIds)})
        ORDER BY session_transcript_search.rowid
        LIMIT ${SESSION_TRANSCRIPT_LEXICAL_MATCH_SCAN_LIMIT}
      `
      for (const row of rows) {
        afterRowid = row.search_rowid
        if (seenSessionIds.has(row.session_id)) continue
        seenSessionIds.add(row.session_id)
        representativeRowids.push(row.search_rowid)
        if (representativeRowids.length >= SESSION_DISCOVERY_WINDOW_LIMIT + 1) break
      }
      if (rows.length < SESSION_TRANSCRIPT_LEXICAL_MATCH_SCAN_LIMIT) break
    }
    return representativeRowids
  })
}

export function transcriptSessionCtes(
  sql: SqlClient.SqlClient,
  request: DiscoverySearchRequest,
  parameters: TranscriptSearchParameters,
  transcriptMatchRowids: readonly number[],
  seedTranscriptTerm: string,
  allSessionsAuthorized: boolean,
) {
  const transcriptTermsJson = JSON.stringify(parameters.transcriptTerms)
  const boundedRowids = transcriptMatchRowids.length > 0 ? transcriptMatchRowids : [-1]
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
            SELECT 1 FROM session_transcript_terms AS matching_term
            WHERE matching_term.term = required_term.term
              AND matching_term.session_id = seed_terms.session_id
          )
        ))
      ORDER BY seed_terms.session_id
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    ), term_transcript_sessions AS MATERIALIZED (
      SELECT matching_ids.session_id,
        -CAST(SUM(matching_terms.occurrences) AS REAL) /
          MAX(term_documents.token_count) AS score,
        NULL AS snippet,
        (
          SELECT evidence_term.first_node_id
          FROM session_transcript_terms AS evidence_term
          WHERE evidence_term.session_id = matching_ids.session_id
            AND evidence_term.term IN (SELECT term FROM query_transcript_terms)
          ORDER BY evidence_term.first_created_order, evidence_term.term
          LIMIT 1
        ) AS first_node_id,
        (
          SELECT evidence_term.first_created_order
          FROM session_transcript_terms AS evidence_term
          WHERE evidence_term.session_id = matching_ids.session_id
            AND evidence_term.term IN (SELECT term FROM query_transcript_terms)
          ORDER BY evidence_term.first_created_order, evidence_term.term
          LIMIT 1
        ) AS first_created_order
        ,(
          SELECT evidence_term.first_run_id
          FROM session_transcript_terms AS evidence_term
          WHERE evidence_term.session_id = matching_ids.session_id
            AND evidence_term.term IN (SELECT term FROM query_transcript_terms)
          ORDER BY evidence_term.first_created_order, evidence_term.term
          LIMIT 1
        ) AS first_run_id
      FROM matching_term_session_ids AS matching_ids
      JOIN session_transcript_terms AS matching_terms
        ON matching_terms.session_id = matching_ids.session_id
        AND matching_terms.term IN (SELECT term FROM query_transcript_terms)
      JOIN session_transcript_term_documents AS term_documents
        ON term_documents.session_id = matching_ids.session_id
      GROUP BY matching_ids.session_id
    ), matching_transcript_chunks AS MATERIALIZED (
      SELECT session_transcript_search.session_id,
        bm25(session_transcript_search, 0.0, 0.0, 1.0) AS score,
        snippet(session_transcript_search, 2, '', '', ' … ', 12) AS snippet
      FROM session_transcript_search
      WHERE session_transcript_search.rowid IN ${sql.in(boundedRowids)}
        AND ${parameters.phraseTranscriptSearch} = 1
        AND session_transcript_search MATCH ${parameters.ftsQuery}
    ), phrase_transcript_sessions AS MATERIALIZED (
      SELECT session_id, MIN(score) AS score, MAX(snippet) AS snippet,
        NULL AS first_node_id, NULL AS first_created_order, NULL AS first_run_id
      FROM matching_transcript_chunks
      GROUP BY session_id
      ORDER BY score, session_id
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    ), transcript_sessions AS MATERIALIZED (
      SELECT session_id, score, snippet, first_node_id, first_created_order, first_run_id
      FROM term_transcript_sessions
      UNION ALL
      SELECT session_id, score, snippet, first_node_id, first_created_order, first_run_id
      FROM phrase_transcript_sessions
    )
  `
}
