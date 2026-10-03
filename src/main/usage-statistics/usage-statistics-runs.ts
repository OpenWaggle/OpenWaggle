/**
 * Builds `run.finished` from facts that different layers know about the same Run: the Session
 * Host knows who started it, where it runs and how it ended; the Pi adapter knows the model,
 * thinking level, token usage and the authorization mode the Run resolved when it asked for
 * approval. Each notes its part here by Run id, and the Host takes the whole entry when the Run
 * settles. Tracking happens only while statistics are on and is bounded, so an abandoned Run
 * cannot grow memory.
 */
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { ThinkingLevel } from '@shared/types/settings'
import { durableSessionRunId } from '../domain/session-control/root-session-project-reach'
import {
  type UsageStatisticsStartAccess,
  usageStatisticsDurationSeconds,
  usageStatisticsEntryPointForCaller,
  usageStatisticsRunResult,
  usageStatisticsStartAccessMode,
  usageStatisticsTokenCount,
} from '../domain/usage-statistics/usage-statistics-run-mapping'
import { isUsageStatisticsEnabled } from './usage-statistics-enablement'
import { recordUsageStatistics } from './usage-statistics-recorder'

const MAX_TRACKED_RUNS = 256
/** The mode assumed when nothing is known, as the authorization module does. */
const FAIL_CLOSED_ACCESS_MODE: AgentAuthorizationMode = 'ask-for-approval'

interface TrackedRun {
  startedAt: number | null
  identity: { readonly provider: string; readonly model: string } | null
  thinkingLevel: ThinkingLevel | null
  startAccess: UsageStatisticsStartAccess | null
  /** `undefined` until the Run loaded its project config. */
  projectDefault: AgentAuthorizationMode | null | undefined
  /** The mode the Run resolved when it asked for approval; the latest wins. */
  resolvedAccessMode: AgentAuthorizationMode | null
  inputTokens: number
  outputTokens: number
  requestedWaggle: boolean
}

const trackedRuns = new Map<string, TrackedRun>()
let clock: () => number = Date.now

function trackedRun(runId: string) {
  const existing = trackedRuns.get(runId)
  if (existing) return existing
  if (trackedRuns.size >= MAX_TRACKED_RUNS) {
    const oldest = trackedRuns.keys().next()
    if (!oldest.done) trackedRuns.delete(oldest.value)
  }
  const created: TrackedRun = {
    startedAt: null,
    identity: null,
    thinkingLevel: null,
    startAccess: null,
    projectDefault: undefined,
    resolvedAccessMode: null,
    inputTokens: 0,
    outputTokens: 0,
    requestedWaggle: false,
  }
  trackedRuns.set(runId, created)
  return created
}

/** A Waggle an agent requested inside a classic Run counts toward that Run. */
function trackedRunOf(runId: string) {
  const durableRunId = durableSessionRunId(runId)
  const run = trackedRun(durableRunId)
  if (durableRunId !== runId) run.requestedWaggle = true
  return run
}

export interface UsageStatisticsRunStartFacts {
  readonly runId: string
  /** The caller that wrote the Run's input (its author when someone re-authorized it). */
  readonly originCallerId: string
  readonly waggle: boolean
  readonly attachments: boolean
  /** What is known of the Run's authorization when it starts, before it asks for approval. */
  readonly access: UsageStatisticsStartAccess
  readonly worktree: boolean
  readonly workerSession: boolean
}

/** A Run became active. This alone makes today an Active install day. */
export function recordUsageStatisticsRunStarted(start: UsageStatisticsRunStartFacts): void {
  if (!isUsageStatisticsEnabled()) return
  const run = trackedRun(start.runId)
  run.startedAt ??= clock()
  run.startAccess ??= start.access
  recordUsageStatistics({
    kind: 'run-started',
    entryPoint: usageStatisticsEntryPointForCaller(start.originCallerId),
  })
  if (start.waggle) recordUsageStatistics({ kind: 'feature', flag: 'waggle' })
  if (start.attachments) recordUsageStatistics({ kind: 'feature', flag: 'attachment' })
  if (start.worktree) recordUsageStatistics({ kind: 'feature', flag: 'worktree' })
  if (start.workerSession) recordUsageStatistics({ kind: 'feature', flag: 'worker_session' })
}

/** The clock reading of a Run's start, taken before any lookup its start facts need. */
export function markUsageStatisticsRunStart(runId: string): void {
  if (!isUsageStatisticsEnabled()) return
  trackedRun(runId).startedAt ??= clock()
}

/**
 * Pi adapter hook: the Run reached Pi with this model, already reduced to Pi built-in catalog
 * identifiers or `custom`. The first note wins, so a Waggle reports its first agent's model.
 */
export function noteUsageStatisticsRunModel(
  runId: string,
  identity: { readonly provider: string; readonly model: string },
  thinkingLevel: ThinkingLevel,
): void {
  if (!isUsageStatisticsEnabled()) return
  const run = trackedRunOf(runId)
  run.identity ??= identity
  run.thinkingLevel ??= thinkingLevel
}

/**
 * Pi adapter hook: the Run resolved its authorization mode for an approval. The latest wins, so a
 * mode changed during the Run is the one reported.
 */
export function noteUsageStatisticsRunAccessMode(runId: string, mode: AgentAuthorizationMode) {
  if (!isUsageStatisticsEnabled()) return
  trackedRunOf(runId).resolvedAccessMode = mode
}

/** Whether the Run is tracked and its project default is still unknown. */
export function usageStatisticsRunNeedsProjectDefault(runId: string) {
  if (!isUsageStatisticsEnabled()) return false
  return trackedRuns.get(durableSessionRunId(runId))?.projectDefault === undefined
}

/**
 * The project default, from the project config: the Run executor notes what it loaded anyway
 * for a classic Run, and the Pi adapter reads it once for a Run the executor did not start (an
 * explicit Waggle). Only a Run already tracked is updated, so a late note adds no entry.
 */
export function noteUsageStatisticsRunProjectDefault(
  runId: string,
  mode: AgentAuthorizationMode | null,
) {
  if (!isUsageStatisticsEnabled()) return
  const run = trackedRuns.get(durableSessionRunId(runId))
  if (run) run.projectDefault = mode
}

function reportedAccessMode(run: TrackedRun) {
  if (run.resolvedAccessMode) return run.resolvedAccessMode
  if (!run.startAccess) return FAIL_CLOSED_ACCESS_MODE
  return usageStatisticsStartAccessMode({
    ...run.startAccess,
    projectDefault: run.projectDefault ?? null,
  })
}

/** Pi adapter hook: one completed model response's token usage. */
export function addUsageStatisticsRunTokens(runId: string, input: number, output: number): void {
  if (!isUsageStatisticsEnabled()) return
  const run = trackedRunOf(runId)
  run.inputTokens += usageStatisticsTokenCount(input)
  run.outputTokens += usageStatisticsTokenCount(output)
}

export interface UsageStatisticsRunFinishFacts {
  readonly runId: string
  readonly originCallerId: string
  readonly waggle: boolean
  /** The level requested for the Run, used when Pi did not report the one it applied. */
  readonly thinkingLevel: ThinkingLevel
  readonly terminalStatus:
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'interrupted-by-interaction-timeout'
}

/**
 * The Run settled. Synchronous: it reads only what the Run noted while it ran. A Run that never
 * reached a model has no provider or model to report and only counts through its start.
 */
export function recordUsageStatisticsRunFinished(finish: UsageStatisticsRunFinishFacts): void {
  const run = trackedRuns.get(finish.runId)
  trackedRuns.delete(finish.runId)
  if (!run?.identity || !isUsageStatisticsEnabled()) return
  const now = clock()
  const waggle = finish.waggle || run.requestedWaggle
  if (waggle) recordUsageStatistics({ kind: 'feature', flag: 'waggle' })
  recordUsageStatistics({
    kind: 'run-finished',
    properties: {
      entry_point: usageStatisticsEntryPointForCaller(finish.originCallerId),
      provider: run.identity.provider,
      model: run.identity.model,
      thinking_level: run.thinkingLevel ?? finish.thinkingLevel,
      access_mode: reportedAccessMode(run),
      waggle,
      result: usageStatisticsRunResult(finish.terminalStatus),
      duration_s: usageStatisticsDurationSeconds(run.startedAt ?? now, now),
      input_tokens: run.inputTokens,
      output_tokens: run.outputTokens,
    },
  })
}

export function resetUsageStatisticsRunsForTests(now: () => number = Date.now): void {
  trackedRuns.clear()
  clock = now
}
