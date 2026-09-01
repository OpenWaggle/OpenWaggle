import { isMatching, P } from '@diegogbrisa/ts-match'

export const BENCHMARK_QUERY_PAGE_SIZE = 50
export const BENCHMARK_SESSION_ID = 'session-000000'
export const RARE_LEXICAL_TERM = 'benchmarktoken'
export const COMMON_LEXICAL_TERM = 'commonterm'
const BENCHMARK_TRANSCRIPT_FIRST_NODE_ID = 'node-00000000'
const TERMINAL_TRANSCRIPT_MARKER = 'skewed long session terminal marker'

const listResultPattern = {
  outcome: {
    operation: 'list',
    sessions: P.array({ sessionId: P.string, projectPath: P.union(P.string, P.null) }),
    nextCursor: P.optional(P.string),
  },
}

const lexicalResultPattern = P.array({
  session_id: P.string,
  matched_fields: P.string,
  snippet: P.union(P.string, P.null),
})

const transcriptResultPattern = {
  outcome: {
    operation: 'items',
    sessionId: BENCHMARK_SESSION_ID,
    highWaterMark: P.integer,
    snapshotHeadNodeId: P.string,
    items: P.array({
      nodeId: P.string,
      parentNodeId: P.union(P.string, P.null),
      createdOrder: P.integer,
      content: P._,
    }),
  },
}

interface BenchmarkPreflightInput {
  readonly list: unknown
  readonly sparseWorkingPathList: unknown
  readonly missingWorkingPathList: unknown
  readonly rareLexical: unknown
  readonly commonLexical: unknown
  readonly transcriptHead: unknown
  readonly transcriptTerminal: unknown
  readonly sparseWorkingPath: string
}

function benchmarkValidationFailure(message: string): never {
  throw new Error(`Session discovery benchmark preflight failed: ${message}`)
}

function requireListResult(value: unknown, label: string) {
  if (!isMatching(listResultPattern, value)) {
    return benchmarkValidationFailure(`${label} returned an invalid or error response.`)
  }
  return value.outcome
}

function requireLexicalResult(value: unknown, term: string, label: string) {
  if (!isMatching(lexicalResultPattern, value)) {
    return benchmarkValidationFailure(`${label} returned invalid rows.`)
  }
  if (
    value.length === 0 ||
    !value.some(
      (row) =>
        row.matched_fields.length > 0 &&
        typeof row.snippet === 'string' &&
        row.snippet.toLowerCase().includes(term),
    )
  ) {
    return benchmarkValidationFailure(`${label} did not return evidence for ${term}.`)
  }
}

function requireTranscriptResult(value: unknown, label: string) {
  if (!isMatching(transcriptResultPattern, value)) {
    return benchmarkValidationFailure(`${label} returned an invalid or error response.`)
  }
  return value.outcome
}

export function benchmarkTranscriptTerminalCursor(transcriptHead: unknown) {
  const outcome = requireTranscriptResult(transcriptHead, 'transcript head query')
  const first = outcome.items[0]
  if (
    outcome.items.length !== BENCHMARK_QUERY_PAGE_SIZE ||
    first?.nodeId !== BENCHMARK_TRANSCRIPT_FIRST_NODE_ID ||
    first.parentNodeId !== null ||
    !JSON.stringify(first.content).toLowerCase().includes(COMMON_LEXICAL_TERM) ||
    outcome.highWaterMark < 1
  ) {
    return benchmarkValidationFailure('transcript head query omitted the fixture head evidence.')
  }
  return {
    afterCreatedOrder: outcome.highWaterMark - 1,
    snapshotHeadNodeId: outcome.snapshotHeadNodeId,
  }
}

export function validateSessionDiscoveryBenchmarkPreflight(input: BenchmarkPreflightInput) {
  const list = requireListResult(input.list, 'catalog list query')
  if (list.sessions.length !== BENCHMARK_QUERY_PAGE_SIZE || !list.nextCursor) {
    return benchmarkValidationFailure('catalog list query did not return one complete page.')
  }

  const sparse = requireListResult(input.sparseWorkingPathList, 'sparse working-path query')
  if (
    sparse.sessions.length === 0 ||
    sparse.sessions.length > BENCHMARK_QUERY_PAGE_SIZE ||
    sparse.sessions.some((session) => session.projectPath !== input.sparseWorkingPath)
  ) {
    return benchmarkValidationFailure('sparse working-path query returned the wrong Sessions.')
  }

  const missing = requireListResult(input.missingWorkingPathList, 'missing working-path query')
  if (missing.sessions.length !== 0 || missing.nextCursor !== undefined) {
    return benchmarkValidationFailure('missing working-path query unexpectedly returned Sessions.')
  }

  requireLexicalResult(input.rareLexical, RARE_LEXICAL_TERM, 'rare lexical query')
  requireLexicalResult(input.commonLexical, COMMON_LEXICAL_TERM, 'common lexical query')

  const terminalCursor = benchmarkTranscriptTerminalCursor(input.transcriptHead)
  const terminal = requireTranscriptResult(input.transcriptTerminal, 'transcript terminal query')
  const last = terminal.items.at(-1)
  if (
    terminal.items.length !== 1 ||
    terminal.snapshotHeadNodeId !== terminalCursor.snapshotHeadNodeId ||
    last?.nodeId !== terminal.snapshotHeadNodeId ||
    last.createdOrder !== terminal.highWaterMark ||
    !JSON.stringify(last.content).includes(TERMINAL_TRANSCRIPT_MARKER)
  ) {
    return benchmarkValidationFailure(
      'transcript terminal query omitted the active-branch terminal evidence.',
    )
  }
}
