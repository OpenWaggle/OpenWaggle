import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { tokenizeSessionTranscriptTerms } from '../services/session-transcript-term-tokenizer'
import { SESSION_DISCOVERY_WINDOW_LIMIT } from './session-discovery-window-store'
import type { DiscoverySearchRequest } from './sqlite-session-discovery-window'
import {
  decorateLexicalDiscoveryRows,
  type LexicalDiscoverySearchRow,
} from './sqlite-session-lexical-evidence'
import { authorizedSessionScope } from './sqlite-session-query-support'
import {
  loadSeedTranscriptTerm,
  transcriptSessionCtes,
} from './sqlite-session-transcript-search-query'

const QUOTED_QUERY_DELIMITER_COUNT = 2
/**
 * Plain multiword input uses tokenized AND semantics. Wrapping the complete input in quotes is the
 * explicit phrase form. Quoting every term keeps FTS operators out of the generated expression.
 */
export function lexicalFtsQuery(value: string) {
  const input = value.trim()
  const explicitPhrase =
    input.length >= QUOTED_QUERY_DELIMITER_COUNT && input.startsWith('"') && input.endsWith('"')
  const terms = explicitPhrase ? [input.slice(1, -1)] : input.split(/\s+/u)
  const query = terms
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(explicitPhrase ? '' : ' AND ')
  if (!query) throw new Error('Lexical search requires at least one searchable term.')
  return query
}

function lexicalSearchParameters(request: DiscoverySearchRequest) {
  const exactQuery = request.query.query.trim()
  const explicitPhrase =
    exactQuery.length >= QUOTED_QUERY_DELIMITER_COUNT &&
    exactQuery.startsWith('"') &&
    exactQuery.endsWith('"')
  const transcriptTerms = [
    ...new Set(
      tokenizeSessionTranscriptTerms(explicitPhrase ? exactQuery.slice(1, -1) : exactQuery),
    ),
  ]
  const fullTranscript = request.query.searchScope === 'full-transcript' ? 1 : 0
  const termTranscriptSearch = fullTranscript === 1 && transcriptTerms.length > 0
  const ftsQuery = lexicalFtsQuery(exactQuery)
  return {
    exactQuery,
    ftsQuery,
    discoveryFtsQuery: `initial_objective : (${ftsQuery}) OR current_preview : (${ftsQuery})`,
    fullTranscript,
    phraseTranscriptSearch: fullTranscript === 1 && explicitPhrase ? 1 : 0,
    termTranscriptSearch: termTranscriptSearch ? 1 : 0,
    transcriptTerms,
    includeArchived: request.query.includeArchived ? 1 : 0,
  }
}

function lexicalCandidateRows(
  sql: SqlClient.SqlClient,
  parameters: ReturnType<typeof lexicalSearchParameters>,
) {
  const { exactQuery, ftsQuery } = parameters
  return sql`
    SELECT session_id, score, matched_field, snippet, exact_match
    FROM (
      SELECT ranked.session_id, ranked.score, ${'title'} AS matched_field,
        snippet(session_title_search, 1, '', '', ' … ', 12) AS snippet, 0 AS exact_match
      FROM (
        SELECT session_title_search.rowid AS search_rowid,
          session_title_search.session_id,
          bm25(session_title_search, 0.0, 6.0) AS score
        FROM session_title_search
        JOIN eligible_sessions ON eligible_sessions.session_id = session_title_search.session_id
        WHERE session_title_search MATCH ${ftsQuery}
        ORDER BY score, session_title_search.session_id
        LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
      ) AS ranked
      JOIN session_title_search ON session_title_search.rowid = ranked.search_rowid
      UNION ALL
      SELECT ranked.session_id, ranked.score, ${'project'} AS matched_field,
        snippet(session_project_search, 1, '', '', ' … ', 12) AS snippet, 0 AS exact_match
      FROM (
        SELECT session_project_search.rowid AS search_rowid,
          session_project_search.session_id,
          bm25(session_project_search, 0.0, 4.0) AS score
        FROM session_project_search
        JOIN eligible_sessions ON eligible_sessions.session_id = session_project_search.session_id
        WHERE session_project_search MATCH ${ftsQuery}
        ORDER BY score, session_project_search.session_id
        LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
      ) AS ranked
      JOIN session_project_search ON session_project_search.rowid = ranked.search_rowid
      UNION ALL
      SELECT ranked.session_id, ranked.score, ${'objective'} AS matched_field,
        snippet(session_delegation_search, 2, '', '', ' … ', 12) AS snippet, 0 AS exact_match
      FROM (
        SELECT session_delegation_search.rowid AS search_rowid,
          session_delegation_search.session_id,
          bm25(session_delegation_search, 0.0, 0.0, 5.0) AS score
        FROM session_delegation_search
        JOIN eligible_sessions
          ON eligible_sessions.session_id = session_delegation_search.session_id
        WHERE session_delegation_search MATCH ${ftsQuery}
        ORDER BY score, session_delegation_search.session_id
        LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
      ) AS ranked
      JOIN session_delegation_search ON session_delegation_search.rowid = ranked.search_rowid
      UNION ALL
      SELECT ranked.session_id, ranked.score, ${'discovery'},
        NULL, 0
      FROM discovery_ranked_sessions AS ranked
      UNION ALL
      SELECT exact.session_id, exact.score, exact.matched_field, exact.snippet, exact.exact_match
      FROM (
        SELECT exact_matches.session_id, exact_matches.score,
          exact_matches.matched_field, exact_matches.snippet, exact_matches.exact_match
        FROM (
          SELECT exact_id.id AS session_id, -1000.0 AS score,
            ${'title'} AS matched_field, exact_id.title AS snippet, 1 AS exact_match
          FROM sessions AS exact_id INDEXED BY idx_sessions_exact_id_nocase
          JOIN eligible_sessions ON eligible_sessions.session_id = exact_id.id
          WHERE exact_id.id = ${exactQuery} COLLATE NOCASE
          UNION
          SELECT exact_title.id AS session_id, -1000.0 AS score,
            ${'title'} AS matched_field, exact_title.title AS snippet, 1 AS exact_match
          FROM sessions AS exact_title INDEXED BY idx_sessions_exact_title_nocase
          JOIN eligible_sessions ON eligible_sessions.session_id = exact_title.id
          WHERE exact_title.title = ${exactQuery} COLLATE NOCASE
        ) AS exact_matches
        ORDER BY exact_matches.session_id
        LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
      ) AS exact
    )
  `
}

function lexicalDiscoveryRankingCte(
  sql: SqlClient.SqlClient,
  parameters: ReturnType<typeof lexicalSearchParameters>,
  requiresEligibleSessionJoin: boolean,
) {
  const eligibleSessionJoin = requiresEligibleSessionJoin
    ? sql`JOIN eligible_sessions
        ON eligible_sessions.session_id = session_node_discovery_search.session_id`
    : sql``
  return sql`
    discovery_ranked_sessions AS MATERIALIZED (
      SELECT session_node_discovery_search.session_id,
        bm25(session_node_discovery_search, 0.0, 0.0, 3.0, 3.0) AS score
      FROM session_node_discovery_search
      ${eligibleSessionJoin}
      WHERE ${parameters.fullTranscript} = 0
        AND (${parameters.includeArchived} = 1 OR session_node_discovery_search.archived = ${0})
        AND session_node_discovery_search MATCH ${parameters.discoveryFtsQuery}
      ORDER BY score, session_node_discovery_search.session_id
      LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    )
  `
}

export function loadLexicalDiscoveryRows(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DiscoverySearchRequest,
) {
  const allowed = authorizedSessionScope(authority)
  const parameters = lexicalSearchParameters(request)
  const { includeArchived } = parameters
  const candidates = lexicalCandidateRows(sql, parameters)
  const eligibleAuthorityJoin =
    allowed.all === 1
      ? sql``
      : sql`LEFT JOIN session_spawn_lineage
          ON session_spawn_lineage.child_session_id = sessions.id`
  const eligibleAuthorityPredicate =
    allowed.all === 1
      ? sql`1 = 1`
      : sql`(sessions.project_path IN ${sql.in(allowed.projectPaths)}
          OR sessions.id IN ${sql.in(allowed.sessionIds)}
          OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
            IN ${sql.in(allowed.hiveRootSessionIds)})`
  return Effect.gen(function* () {
    const seedTranscriptTerm = yield* loadSeedTranscriptTerm(sql, parameters)
    const transcriptCtes = transcriptSessionCtes(
      sql,
      request,
      parameters,
      seedTranscriptTerm,
      allowed.all === 1,
    )
    const discoveryRankingCte = lexicalDiscoveryRankingCte(
      sql,
      parameters,
      allowed.all !== 1 || Boolean(request.query.projectPath || request.query.workingPath),
    )
    const rows = yield* sql<LexicalDiscoverySearchRow>`
      WITH authorized_sessions AS (
      SELECT sessions.id AS session_id
      FROM sessions
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      WHERE (${allowed.all} = 1 OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
          IN ${sql.in(allowed.hiveRootSessionIds)})
    ), eligible_sessions AS NOT MATERIALIZED (
      SELECT sessions.id AS session_id
      FROM sessions
      ${eligibleAuthorityJoin}
      WHERE ${eligibleAuthorityPredicate}
        AND (${includeArchived} = 1 OR sessions.archived = 0)
        AND (${request.query.projectPath ?? null} IS NULL
          OR sessions.project_path = ${request.query.projectPath ?? null})
        AND (${request.query.workingPath ?? null} IS NULL OR EXISTS (
          SELECT 1 FROM session_workspace_bindings AS catalog_binding
          JOIN workspace_resources AS catalog_workspace
            ON catalog_workspace.id = catalog_binding.workspace_id
          WHERE catalog_binding.session_id = sessions.id
            AND catalog_workspace.working_path = ${request.query.workingPath ?? null}
        ))
    ), ${discoveryRankingCte}, ${transcriptCtes}, candidates AS (
      ${candidates}
      UNION ALL
      SELECT session_id, score, ${'transcript'}, snippet, 0
      FROM transcript_sessions
    ), matches AS (
      SELECT session_id, MIN(score) AS score,
        GROUP_CONCAT(DISTINCT matched_field) AS matched_fields,
        MAX(snippet) AS snippet, MAX(exact_match) AS exact_match
      FROM candidates GROUP BY session_id
    ), transcript_matches AS (
      SELECT session_id, first_node_id, first_created_order, first_run_id
      FROM transcript_sessions
    )
    SELECT sessions.id AS session_id, sessions.title, sessions.project_path, sessions.archived,
      sessions.created_at, sessions.updated_at, matches.score,
      matches.matched_fields,
      matches.snippet,
      matches.exact_match,
      transcript_matches.first_node_id AS transcript_node_id,
      transcript_matches.first_run_id AS transcript_run_id,
      transcript_matches.first_created_order AS transcript_created_order,
      COALESCE(discovery_rows.initial_objective, '') AS discovery_initial_objective,
      COALESCE(discovery_rows.current_preview, '') AS discovery_current_preview,
      session_spawn_lineage.parent_session_id, session_spawn_lineage.hive_root_session_id,
      (SELECT COUNT(*) FROM session_spawn_lineage AS direct_lineage
        WHERE direct_lineage.parent_session_id = sessions.id) AS direct_worker_count,
      session_execution_profiles.profile_json, delegation_contracts.id AS delegation_id,
      delegation_contracts.state AS delegation_state
    FROM matches JOIN sessions ON sessions.id = matches.session_id
    LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
    LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
    LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
    LEFT JOIN transcript_matches ON transcript_matches.session_id = sessions.id
    LEFT JOIN session_discovery_search_rows AS discovery_rows
      ON discovery_rows.session_id = sessions.id
    WHERE (${includeArchived} = 1 OR sessions.archived = 0)
      AND (${request.query.projectPath ?? null} IS NULL OR sessions.project_path = ${request.query.projectPath ?? null})
      AND (${request.query.workingPath ?? null} IS NULL OR EXISTS (
        SELECT 1 FROM session_workspace_bindings AS catalog_binding
        JOIN workspace_resources AS catalog_workspace ON catalog_workspace.id = catalog_binding.workspace_id
        WHERE catalog_binding.session_id = sessions.id
          AND catalog_workspace.working_path = ${request.query.workingPath ?? null}
      ))
      AND (${allowed.all} = 1 OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id) IN ${sql.in(allowed.hiveRootSessionIds)})
    ORDER BY matches.score ASC, sessions.id ASC
    LIMIT ${SESSION_DISCOVERY_WINDOW_LIMIT + 1}
    `
    return decorateLexicalDiscoveryRows(rows, parameters.exactQuery)
  })
}
