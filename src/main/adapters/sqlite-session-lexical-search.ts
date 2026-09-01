import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { tokenizeSessionTranscriptTerms } from '../services/session-transcript-term-tokenizer'
import { SESSION_DISCOVERY_WINDOW_LIMIT } from './session-discovery-window-store'
import type { DiscoverySearchRequest, DiscoverySearchRow } from './sqlite-session-discovery-window'
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
  return {
    exactQuery,
    ftsQuery: lexicalFtsQuery(exactQuery),
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
  allSessionsAuthorized: boolean,
) {
  const { exactQuery, ftsQuery, fullTranscript } = parameters
  return sql`
    SELECT session_id, score, matched_field, snippet, exact_match
    FROM (
      SELECT session_id, bm25(session_title_search, 0.0, 6.0) AS score,
        ${'title'} AS matched_field,
        snippet(session_title_search, 1, '', '', ' … ', 12) AS snippet, 0 AS exact_match
      FROM session_title_search
      WHERE (${allSessionsAuthorized ? 1 : 0} = 1
          OR session_id IN (SELECT session_id FROM authorized_sessions))
        AND session_title_search MATCH ${ftsQuery}
      UNION ALL
      SELECT session_id, bm25(session_delegation_search, 0.0, 0.0, 5.0) AS score,
        ${'objective'} AS matched_field,
        snippet(session_delegation_search, 2, '', '', ' … ', 12) AS snippet, 0 AS exact_match
      FROM session_delegation_search
      WHERE (${allSessionsAuthorized ? 1 : 0} = 1
          OR session_id IN (SELECT session_id FROM authorized_sessions))
        AND session_delegation_search MATCH ${ftsQuery}
      UNION ALL
      SELECT session_node_discovery_search.session_id,
        bm25(session_node_discovery_search, 0.0, 3.0, 0.0),
        ${'initial-objective'},
        snippet(session_node_discovery_search, 1, '', '', ' … ', 12), 0
      FROM session_node_discovery_search
      WHERE (${allSessionsAuthorized ? 1 : 0} = 1
          OR session_node_discovery_search.session_id IN (SELECT session_id FROM authorized_sessions))
        AND ${fullTranscript} = 0
        AND initial_objective MATCH ${ftsQuery}
      UNION ALL
      SELECT session_node_discovery_search.session_id,
        bm25(session_node_discovery_search, 0.0, 0.0, 3.0),
        ${'current-preview'},
        snippet(session_node_discovery_search, 2, '', '', ' … ', 12), 0
      FROM session_node_discovery_search
      WHERE (${allSessionsAuthorized ? 1 : 0} = 1
          OR session_node_discovery_search.session_id IN (SELECT session_id FROM authorized_sessions))
        AND ${fullTranscript} = 0
        AND current_preview MATCH ${ftsQuery}
      UNION ALL
      SELECT sessions.id, -1000.0, ${'title'}, sessions.title, 1
      FROM sessions
      WHERE (${allSessionsAuthorized ? 1 : 0} = 1
          OR sessions.id IN (SELECT session_id FROM authorized_sessions))
        AND (lower(sessions.id) = lower(${exactQuery})
          OR lower(sessions.title) = lower(${exactQuery}))
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
  const candidates = lexicalCandidateRows(sql, parameters, allowed.all === 1)
  return Effect.gen(function* () {
    const seedTranscriptTerm = yield* loadSeedTranscriptTerm(sql, parameters)
    const transcriptCtes = transcriptSessionCtes(
      sql,
      request,
      parameters,
      seedTranscriptTerm,
      allowed.all === 1,
    )
    return yield* sql<DiscoverySearchRow>`
      WITH authorized_sessions AS (
      SELECT sessions.id AS session_id
      FROM sessions
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      WHERE (${allowed.all} = 1 OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
          IN ${sql.in(allowed.hiveRootSessionIds)})
    ), ${transcriptCtes}, candidates AS (
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
  })
}
