import { DatabaseSync } from 'node:sqlite'
import { assertMatching, P } from '@diegogbrisa/ts-match'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Statement from '@effect/sql/Statement'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'
import type { DiscoverySearchRequest } from '../sqlite-session-discovery-window'
import { loadLexicalDiscoveryRows } from '../sqlite-session-lexical-search'

export function captureNativeRanking(
  sql: SqlClient.SqlClient,
  request: DiscoverySearchRequest,
  authority?: LocalSessionProfileAuthority,
) {
  return Effect.gen(function* () {
    let captured: Statement.Statement<unknown> | undefined
    const rows = yield* Statement.withTransformer(
      loadLexicalDiscoveryRows(sql, authority, request),
      (statement) => {
        captured = statement
        return Effect.succeed(statement)
      },
    )
    if (!captured) throw new Error('No discovery statement executed.')
    const [query, parameters] = captured.compile()
    return { rows, query, parameters }
  })
}

export function nativeScoreCalls(
  filename: string,
  captured: { readonly query: string; readonly parameters: readonly unknown[] },
) {
  const database = new DatabaseSync(filename, { readOnly: true })
  let groups = 0
  let fallback = 0
  try {
    database.function('record_group_score', (value) => {
      assertMatching(P.number, value)
      groups += 1
      return value
    })
    database.function('record_fallback_score', (value) => {
      assertMatching(P.number, value)
      fallback += 1
      return value
    })
    let occurrences = 0
    const query = captured.query.replaceAll(
      /bm25\(session_node_discovery_search,\s*0\.0,\s*0\.0,\s*3\.0,\s*3\.0\)/gu,
      (expression) => {
        occurrences += 1
        return `${occurrences === 1 ? 'record_group_score' : 'record_fallback_score'}(${expression})`
      },
    )
    expect(occurrences).toBe(2)
    const parameters = captured.parameters
    assertMatching(
      P.array(P.union(P.string, P.number, P.bigint, P.null, P.instanceOf(Uint8Array))),
      parameters,
    )
    database.prepare(query).all(...parameters)
    return { groups, fallback }
  } finally {
    database.close()
  }
}

export function legacyDiscoveryRanking(sql: SqlClient.SqlClient, request: DiscoverySearchRequest) {
  const match = `initial_objective : ("${request.query.query}") OR current_preview : ("${request.query.query}")`
  const legacy = sql`
    discovery_ranked_sessions AS MATERIALIZED (
      SELECT metadata.c0 AS session_id,
        bm25(session_node_discovery_search, 0.0, 0.0, 3.0, 3.0) AS score
      FROM session_node_discovery_search
      JOIN session_node_discovery_search_content AS metadata
        ON metadata.id = session_node_discovery_search.rowid
      WHERE (${request.query.includeArchived ? 1 : 0} = 1 OR metadata.c1 = 0)
        AND session_node_discovery_search MATCH ${match}
      ORDER BY score, metadata.c0 LIMIT 501
    ),
  `.compile()
  return Statement.withTransformer(
    loadLexicalDiscoveryRows(sql, undefined, request),
    (statement) => {
      const [query, parameters] = statement.compile()
      const start = query.indexOf('discovery_ranked_sessions AS MATERIALIZED')
      const end = query.indexOf('query_transcript_terms AS MATERIALIZED', start)
      if (start < 0 || end < 0) throw new Error('Missing discovery ranking CTE.')
      const before = query.slice(0, start)
      const parameterStart = before.match(/\?/gu)?.length ?? 0
      const replacedCount = query.slice(start, end).match(/\?/gu)?.length ?? 0
      return Effect.succeed(
        sql.unsafe(before + legacy[0] + query.slice(end), [
          ...parameters.slice(0, parameterStart),
          ...legacy[1],
          ...parameters.slice(parameterStart + replacedCount),
        ]),
      )
    },
  )
}
