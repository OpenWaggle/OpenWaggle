import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import {
  isUnnamedRunSeed,
  type RenderSnapshotState,
  type RunRenderSnapshot,
} from './background-run-render-state'

/*
 * A Run that starts in a snapshot a route owns (`RunRenderSnapshot.startedRun`), and the
 * settlement of an earlier Run that reaches the renderer after that start.
 */

/**
 * A route-owned snapshot remembering the Run that started in it. The messages it held then are
 * earlier Runs', which ended before this one started: they are judged like a settled Run's
 * (`settledMessageIds`) even while that Run's settlement has not arrived, so hydration leaves them
 * to their saved copies once the persisted transcript holds them.
 */
export function withStartedRun(existing: RunRenderSnapshot, runId: string): RunRenderSnapshot {
  const started = existing.startedRun
  // An auto-retry, or the real id of a Run whose start named none: the same Run.
  if (started?.runId === runId) return existing
  if (started && isUnnamedRunSeed(started.runId)) {
    return { ...existing, startedRun: { ...started, runId } }
  }
  const earlierMessageIds = new Set(existing.messages.map((message) => message.id))
  const settledMessageIds = new Set([...(existing.settledMessageIds ?? []), ...earlierMessageIds])
  return {
    ...existing,
    startedRun: { runId, earlierMessageIds },
    ...(settledMessageIds.size > 0 ? { settledMessageIds } : {}),
  }
}

/**
 * The settlement of a Run that arrived after the next Run started in a route-owned snapshot: only
 * the messages it held when that Run started are the settled one's. The snapshot stays the started
 * Run's, unmarked, so the settlement's refetch does not clear it.
 */
export function withSettledEarlierMessages(
  state: RenderSnapshotState,
  id: SessionId,
  existing: RunRenderSnapshot,
  earlierMessageIds: ReadonlySet<string>,
) {
  const settledMessageIds = new Set(existing.settledMessageIds)
  for (const message of existing.messages) {
    if (earlierMessageIds.has(message.id)) settledMessageIds.add(message.id)
  }
  const next = new Map(state.renderSnapshotsBySessionId)
  next.set(id, { ...existing, ...(settledMessageIds.size > 0 ? { settledMessageIds } : {}) })
  return { renderSnapshotsBySessionId: next }
}

/**
 * The Run a route's write (`messages`) leaves the snapshot holding: the one that started in it, or
 * the Run that seeded it, whose seed the write drops, so an auto-retry of it is not taken for a new
 * one, nor the real start of a Run whose start named none. What the route shows that was created
 * before that Run started (by Host time, when its start named it) is earlier Runs': judged like a
 * settled Run's, as at a start.
 */
export function startedRunOf(
  existing: RunRenderSnapshot | undefined,
  messages: readonly UIMessage[],
): RunRenderSnapshot['startedRun'] {
  if (existing?.startedRun) return existing.startedRun
  const seed = existing?.seededByRunId
  if (seed === undefined) return undefined
  // A seed whose start named no Run: its real start, when it comes, is the same Run's.
  const earlierMessageIds = new Set(existing?.settledMessageIds)
  const startedAt = existing?.seededAt
  for (const message of startedAt === undefined ? [] : messages) {
    const createdAt = message.createdAt === undefined ? undefined : new Date(message.createdAt)
    if (createdAt !== undefined && startedAt !== undefined && createdAt.getTime() < startedAt) {
      earlierMessageIds.add(message.id)
    }
  }
  return { runId: seed, earlierMessageIds }
}

/**
 * A Run ended: one the snapshot holds unnamed (its start was the bridge's) is named by its end, so
 * the next start tells another Run (another id) from Pi continuing this one (the same id).
 */
export function withEndedRunNamed(existing: RunRenderSnapshot, runId: string): RunRenderSnapshot {
  if (existing.seededByRunId !== undefined) {
    return isUnnamedRunSeed(existing.seededByRunId)
      ? { ...existing, seededByRunId: runId }
      : existing
  }
  const started = existing.startedRun
  if (started === undefined || !isUnnamedRunSeed(started.runId)) return existing
  return { ...existing, startedRun: { ...started, runId } }
}

export function seedRunRenderSnapshot(
  runId: string,
  settledMessageIds?: ReadonlySet<string>,
  startedAt?: number,
): RunRenderSnapshot {
  return {
    messages: [],
    compactionStatus: null,
    updatedAt: Date.now(),
    seededByRunId: runId,
    ...(startedAt === undefined || isUnnamedRunSeed(runId) ? {} : { seededAt: startedAt }),
    ...(settledMessageIds ? { settledMessageIds } : {}),
  }
}

export function seededSnapshotForRunStart(
  existing: RunRenderSnapshot | undefined,
  runId: string,
  startedAt: number,
): RunRenderSnapshot {
  if (existing === undefined) return seedRunRenderSnapshot(runId, undefined, startedAt)
  // The snapshot holds a settled Run, persisted before this one started.
  if (existing.settledRunId !== undefined) {
    return seedRunRenderSnapshot(runId, existing.settledMessageIds, startedAt)
  }
  // A route renders the Session and owns the snapshot.
  if (existing.seededByRunId === undefined) return withStartedRun(existing, runId)
  // This Run starts again: an auto-retry, or Pi continuing it after its end (an overflow
  // compaction's recovery, a truncated answer, a steer queued as it finished).
  if (existing.seededByRunId === runId) return existing
  // The real id of the in-progress Run the seed could not name: its answers are not persisted yet.
  if (isUnnamedRunSeed(existing.seededByRunId) && !isUnnamedRunSeed(runId)) {
    return { ...existing, seededByRunId: runId }
  }
  // Another Run, so the seeded one was persisted before it started.
  return seedRunRenderSnapshot(runId, existing.settledMessageIds, startedAt)
}
