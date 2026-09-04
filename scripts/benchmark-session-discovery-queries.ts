import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from '../src/main/adapters/multilingual-e5-session-embedding-model'
import { SessionDiscoveryWindowStore } from '../src/main/adapters/session-discovery-window-store'
import { searchSessions } from '../src/main/adapters/sqlite-session-discovery'
import { loadLexicalDiscoveryRows } from '../src/main/adapters/sqlite-session-lexical-search'
import { listSessions } from '../src/main/adapters/sqlite-session-query-catalog'
import { readItems } from '../src/main/adapters/sqlite-session-query-items'
import { SqliteSessionSemanticSearch } from '../src/main/adapters/sqlite-session-semantic-search'
import { SqliteSessionTranscriptSemanticSearch } from '../src/main/adapters/sqlite-session-transcript-semantic-search'
import {
  BENCHMARK_QUERY_PAGE_SIZE,
  BENCHMARK_SESSION_ID,
  benchmarkTranscriptTerminalCursor,
  COMMON_LEXICAL_TERM,
  RARE_LEXICAL_PHRASE,
  RARE_LEXICAL_TERM,
  validateSessionDiscoveryBenchmarkPreflight,
} from './benchmark-session-discovery-preflight'
import { sessionDiscoveryBenchmarkQueryExecutor } from './benchmark-session-discovery-runtime'

const MEASURED_RUNS = 20
const WARMUP_RUNS = 3
const P95 = 0.95

function percentile(values: readonly number[], fraction: number) {
  const sorted = values.toSorted((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index] ?? 0
}

async function measure(run: () => Promise<unknown>) {
  const timings: number[] = []
  for (let iteration = 0; iteration < WARMUP_RUNS + MEASURED_RUNS; iteration += 1) {
    const startedAt = performance.now()
    await run()
    const elapsed = performance.now() - startedAt
    if (iteration >= WARMUP_RUNS) timings.push(elapsed)
  }
  return { p95Ms: percentile(timings, P95), timings }
}

async function createQueryOperations(
  runtime: ReturnType<typeof sessionDiscoveryBenchmarkQueryExecutor>,
  model: SessionEmbeddingModel,
) {
  const hybridResources = await runtime.run(
    Effect.map(SqlClient.SqlClient, (sql) => ({
      sql,
      windows: new SessionDiscoveryWindowStore(),
      semantic: new SqliteSessionSemanticSearch(sql, model),
      transcriptSemantic: new SqliteSessionTranscriptSemanticSearch(sql, model),
    })),
  )
  const list = (workingPath?: string) =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        listSessions(sql, undefined, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-list',
          query: {
            operation: 'list',
            limit: BENCHMARK_QUERY_PAGE_SIZE,
            ...(workingPath ? { workingPath } : {}),
          },
        }),
      ),
    )
  const lexical = (
    query: string,
    requestId: string,
    searchScope: 'discovery' | 'full-transcript' = 'discovery',
  ) =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        loadLexicalDiscoveryRows(sql, undefined, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId,
          query: {
            operation: 'search',
            query,
            limit: BENCHMARK_QUERY_PAGE_SIZE,
            mode: 'lexical',
            searchScope,
          },
        }),
      ),
    )
  const transcript = (afterCreatedOrder?: number) =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        readItems(sql, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-transcript',
          query: {
            operation: 'items',
            sessionId: BENCHMARK_SESSION_ID,
            limit: BENCHMARK_QUERY_PAGE_SIZE,
            ...(afterCreatedOrder === undefined ? {} : { afterCreatedOrder }),
          },
        }),
      ),
    )
  const hybrid = () =>
    runtime.run(
      searchSessions(
        hybridResources.sql,
        undefined,
        {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-hybrid',
          query: {
            operation: 'search',
            query: RARE_LEXICAL_TERM,
            limit: BENCHMARK_QUERY_PAGE_SIZE,
            mode: 'hybrid',
            searchScope: 'discovery',
          },
        },
        hybridResources.windows,
        hybridResources.semantic,
        hybridResources.transcriptSemantic,
      ),
    )
  return { list, lexical, transcript, hybrid }
}

type QueryOperations = Awaited<ReturnType<typeof createQueryOperations>>

function assertHybridBenchmarkResult(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('outcome' in value) ||
    typeof value.outcome !== 'object' ||
    value.outcome === null ||
    !('sessions' in value.outcome) ||
    !Array.isArray(value.outcome.sessions) ||
    value.outcome.sessions.length === 0
  ) {
    throw new Error('Session discovery benchmark preflight failed: hybrid query returned no rows.')
  }
}

async function runQueryPreflight(operations: QueryOperations, sparseWorkingPath: string) {
  const coldStartedAt = performance.now()
  const coldSparseWorkingPathList = await operations.list(sparseWorkingPath)
  const coldWorkingPathListMs = performance.now() - coldStartedAt
  const preflight = {
    list: await operations.list(),
    sparseWorkingPathList: coldSparseWorkingPathList,
    missingWorkingPathList: await operations.list('/benchmark/missing'),
    rareLexical: await operations.lexical(
      RARE_LEXICAL_TERM,
      'benchmark-preflight-rare-lexical',
    ),
    commonLexical: await operations.lexical(
      COMMON_LEXICAL_TERM,
      'benchmark-preflight-common-lexical',
    ),
    rareFullTranscriptLexical: await operations.lexical(
      RARE_LEXICAL_TERM,
      'benchmark-preflight-rare-full-transcript',
      'full-transcript',
    ),
    commonFullTranscriptLexical: await operations.lexical(
      COMMON_LEXICAL_TERM,
      'benchmark-preflight-common-full-transcript',
      'full-transcript',
    ),
    phraseFullTranscriptLexical: await operations.lexical(
      RARE_LEXICAL_PHRASE,
      'benchmark-preflight-phrase-full-transcript',
      'full-transcript',
    ),
    hybrid: await operations.hybrid(),
    transcriptHead: await operations.transcript(),
  }
  const terminalCursor = benchmarkTranscriptTerminalCursor(preflight.transcriptHead)
  assertHybridBenchmarkResult(preflight.hybrid)
  validateSessionDiscoveryBenchmarkPreflight({
    ...preflight,
    transcriptTerminal: await operations.transcript(terminalCursor.afterCreatedOrder),
    sparseWorkingPath,
  })
  return coldWorkingPathListMs
}

async function measureQueries(operations: QueryOperations, sparseWorkingPath: string) {
  return {
    list: await measure(() => operations.list()),
    sparseWorkingPathList: await measure(() => operations.list(sparseWorkingPath)),
    missingWorkingPathList: await measure(() => operations.list('/benchmark/missing')),
    lexical: await measure(() => operations.lexical('benchmarktoken', 'benchmark-lexical')),
    commonLexical: await measure(() =>
      operations.lexical('commonterm', 'benchmark-common-lexical'),
    ),
    fullTranscriptLexical: await measure(() =>
      operations.lexical(
        'benchmarktoken',
        'benchmark-full-transcript-lexical',
        'full-transcript',
      ),
    ),
    commonFullTranscriptLexical: await measure(() =>
      operations.lexical(
        'commonterm',
        'benchmark-common-full-transcript-lexical',
        'full-transcript',
      ),
    ),
    phraseFullTranscriptLexical: await measure(() =>
      operations.lexical(
        RARE_LEXICAL_PHRASE,
        'benchmark-phrase-full-transcript-lexical',
        'full-transcript',
      ),
    ),
    hybrid: await measure(operations.hybrid),
    transcript: await measure(operations.transcript),
  }
}

export async function benchmarkSessionDiscoveryQueries(
  databasePath: string,
  sparseWorkingPath: string,
  model: SessionEmbeddingModel,
) {
  const runtime = sessionDiscoveryBenchmarkQueryExecutor(databasePath)
  try {
    const operations = await createQueryOperations(runtime, model)
    const coldWorkingPathListMs = await runQueryPreflight(operations, sparseWorkingPath)
    return {
      coldWorkingPathListMs,
      ...(await measureQueries(operations, sparseWorkingPath)),
    }
  } finally {
    await runtime.dispose()
  }
}
