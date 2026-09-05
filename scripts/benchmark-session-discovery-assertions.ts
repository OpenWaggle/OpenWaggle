import { SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY } from '../src/main/domain/session-semantic-discovery-storage-policy'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY } from '../src/main/domain/session-transcript-semantic-storage-policy'
import type {
  benchmarkCommonTermIncrementalProjection,
  benchmarkSessionDiscoveryBackfills,
  benchmarkSessionDiscoveryQueries,
  sessionDiscoveryBenchmarkCounts,
} from './benchmark-session-discovery-support'
import type { sessionDiscoveryBenchmarkMode } from './benchmark-session-discovery-mode'

interface BenchmarkLimits {
  readonly coldMs: number
  readonly commonTermIncrementalMs: number
  readonly hybridP95Ms: number
  readonly phraseP95Ms: number
  readonly warmP95Ms: number
}

export function sessionDiscoveryBenchmarkPassed(input: {
  readonly mode: ReturnType<typeof sessionDiscoveryBenchmarkMode>
  readonly corpus: ReturnType<typeof sessionDiscoveryBenchmarkCounts>
  readonly cutoverMs: number
  readonly backfills: Awaited<ReturnType<typeof benchmarkSessionDiscoveryBackfills>>
  readonly commonTermIncremental: Awaited<
    ReturnType<typeof benchmarkCommonTermIncrementalProjection>
  >
  readonly queries: Awaited<ReturnType<typeof benchmarkSessionDiscoveryQueries>>
  readonly limits: BenchmarkLimits
}) {
  const targetMessages =
    Math.ceil(input.mode.messageCount / input.mode.sessionCount) +
    input.mode.skewedSessionMessageCount
  const expectedTranscriptEmbeddings = Math.min(
    targetMessages,
    SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY.perSessionNodeLimit,
  )
  const expectedDiscoveryEmbeddings = Math.min(
    input.mode.sessionCount,
    SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY.recordLimit,
  )
  const expectedDiscoveryReadiness =
    input.mode.sessionCount > SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY.recordLimit
      ? 'partial'
      : 'ready'
  return [
    input.corpus.sessions === input.mode.sessionCount &&
      input.corpus.messages === input.mode.messageCount + input.mode.skewedSessionMessageCount &&
      input.corpus.discoveryRows === input.mode.sessionCount &&
      input.corpus.discoveryEmbeddings === expectedDiscoveryEmbeddings &&
      input.corpus.discoveryEmbeddingQueue === 0 &&
      input.corpus.activeBranchMessages === targetMessages,
    input.cutoverMs < input.mode.cutoverLimitMs &&
      input.backfills.discovery.elapsedMs < input.mode.discoveryBackfillLimitMs,
    input.backfills.discovery.prepared === expectedDiscoveryEmbeddings &&
      input.backfills.discovery.readiness.status === expectedDiscoveryReadiness &&
      input.backfills.discovery.readiness.pendingCount === 0,
    input.backfills.transcript.elapsedMs < input.mode.transcriptBackfillLimitMs &&
      input.backfills.transcript.counts.embeddings === expectedTranscriptEmbeddings,
    input.backfills.transcript.counts.eligible === expectedTranscriptEmbeddings,
    input.backfills.transcript.counts.pending === 0,
    input.commonTermIncremental.occurrenceDelta === 1 &&
      input.commonTermIncremental.elapsedMs < input.limits.commonTermIncrementalMs,
    input.queries.coldWorkingPathListMs < input.limits.coldMs &&
      input.queries.list.p95Ms < input.limits.warmP95Ms,
    input.queries.sparseWorkingPathList.p95Ms < input.limits.warmP95Ms,
    input.queries.missingWorkingPathList.p95Ms < input.limits.warmP95Ms,
    input.queries.lexical.p95Ms < input.limits.warmP95Ms,
    input.queries.commonLexical.p95Ms < input.limits.warmP95Ms,
    input.queries.fullTranscriptLexical.p95Ms < input.limits.warmP95Ms,
    input.queries.commonFullTranscriptLexical.p95Ms < input.limits.warmP95Ms,
    input.queries.phraseFullTranscriptLexical.p95Ms < input.limits.phraseP95Ms,
    input.queries.hybrid.p95Ms < input.limits.hybridP95Ms,
    input.queries.transcript.p95Ms < input.limits.warmP95Ms,
  ].every(Boolean)
}
