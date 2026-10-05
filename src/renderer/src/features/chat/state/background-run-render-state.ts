import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import {
  type AgentCompactionStatus,
  getTimelineCompactionStatus,
} from '@/features/chat/lib/compaction-lifecycle'
import { applyCompactionSnapshotEvent } from './background-run-compaction'

export interface RunRenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly compactionStatus: AgentCompactionStatus | null
  readonly updatedAt: number
  /**
   * The active Run whose start seeded this snapshot empty: its messages are only that Run's, none
   * persisted yet, so hydration places them after the persisted history. A route that renders the
   * Session writes its whole transcript and drops it; so does that Run's settlement.
   */
  readonly seededByRunId?: string
  /**
   * The Run that last settled while the snapshot held it (`settledRunMark`). Its answers are
   * persisted under Pi entry ids by then, so the next Run's start reseeds the snapshot instead of
   * keeping them. Kept across route writes until that start.
   */
  readonly settledRunId?: string
  /**
   * Ids of the messages the snapshot held when a Run settled: earlier history and that Run's rows,
   * which the settlement persisted under Pi entry ids their stream ids never match. A route still
   * rendering the Session keeps them in the transcript it writes back, so they are remembered
   * across the next Run's start and those writes, and hydration leaves them to the persisted
   * transcript once it holds that Run (`unsettledRunMessages`).
   */
  readonly settledMessageIds?: ReadonlySet<string>
}

/**
 * The run id `session-host-renderer-bridge` gives the `agent_start` it synthesizes for a Run a
 * reconnected Host already had in progress. It names no Run, so it cannot tell a retry of that Run
 * from the next one.
 */
const REMOTE_SNAPSHOT_RUN_ID_PREFIX = 'remote-snapshot:'

/** A snapshot of the in-progress Run whose start the renderer never saw (compaction, restore). */
export const UNNAMED_RUN_SEED = 'unnamed-run'

/** The mark of a settled Run whose settlement named no run id. */
const SETTLED_UNNAMED_RUN = 'settled-unnamed-run'

/** Whether a seed's Run is in progress but its real id is not known yet. */
function isUnnamedRunSeed(runId: string | undefined) {
  return runId === UNNAMED_RUN_SEED || runId?.startsWith(REMOTE_SNAPSHOT_RUN_ID_PREFIX) === true
}

function seedRunRenderSnapshot(
  runId: string,
  settledMessageIds?: ReadonlySet<string>,
): RunRenderSnapshot {
  return {
    messages: [],
    compactionStatus: null,
    updatedAt: Date.now(),
    seededByRunId: runId,
    ...(settledMessageIds ? { settledMessageIds } : {}),
  }
}

function seededSnapshotForRunStart(
  existing: RunRenderSnapshot | undefined,
  runId: string,
): RunRenderSnapshot {
  if (existing === undefined) return seedRunRenderSnapshot(runId)
  // The snapshot holds a settled Run, persisted before this one started.
  if (existing.settledRunId !== undefined) {
    return seedRunRenderSnapshot(runId, existing.settledMessageIds)
  }
  // A route renders the Session and owns the snapshot, or this Run starts again for an auto-retry.
  if (existing.seededByRunId === undefined || existing.seededByRunId === runId) return existing
  // The real id of the in-progress Run the seed could not name: its answers are not persisted yet.
  if (isUnnamedRunSeed(existing.seededByRunId) && !isUnnamedRunSeed(runId)) {
    return { ...existing, seededByRunId: runId }
  }
  // Another Run, so the seeded one was persisted before it started.
  return seedRunRenderSnapshot(runId, existing.settledMessageIds)
}

/**
 * The snapshot a transport event renders into, or `null` when the event has no snapshot to update.
 *
 * A Run that starts in a Session no route has rendered (a Worker spawned by its Queen while the user
 * looks elsewhere) is seeded empty here, so every answer and tool call it streams is kept. Without
 * it, opening the Worker mid-Run showed only its first message and the answer streaming then: the
 * Run is persisted when it ends, and the reconnect buffer keeps only the current answer. A seeded
 * snapshot is reseeded when another Run starts, because the earlier Run was persisted before it,
 * but kept across an auto-retry's repeated `agent_start` and when a start naming no Run is
 * followed by the real one. A compaction with no snapshot seeds one for its unnamed Run. Any other
 * event needs a snapshot already, or a mid-stream event would invent a transcript.
 */
export function runRenderSnapshotForEvent(
  existing: RunRenderSnapshot | undefined,
  event: AgentTransportEvent,
): RunRenderSnapshot | null {
  if (event.type === 'agent_start') return seededSnapshotForRunStart(existing, event.runId)
  if (existing) return existing
  if (event.type === 'compaction_start') return seedRunRenderSnapshot(UNNAMED_RUN_SEED)
  return null
}

interface RenderSnapshotState {
  readonly renderSnapshotsBySessionId: Map<SessionId, RunRenderSnapshot>
}

/** Applies a transport event to the Session's snapshot; unchanged state when it renders nothing new. */
export function withRunRenderEvent(
  state: RenderSnapshotState,
  id: SessionId,
  event: AgentTransportEvent,
) {
  const existing = state.renderSnapshotsBySessionId.get(id)
  const snapshot = runRenderSnapshotForEvent(existing, event)
  if (!snapshot) return state
  const messages = applyAgentTransportEvent(snapshot.messages, event)
  const compactionStatus = applyCompactionSnapshotEvent(
    snapshot.compactionStatus,
    event,
    snapshot.messages,
  )
  if (
    snapshot === existing &&
    messages === snapshot.messages &&
    compactionStatus === snapshot.compactionStatus
  ) {
    return state
  }
  const next = new Map(state.renderSnapshotsBySessionId)
  next.set(id, { ...snapshot, messages, compactionStatus, updatedAt: Date.now() })
  return { renderSnapshotsBySessionId: next }
}

/**
 * A route rendered the Session: the snapshot now holds its whole transcript, so it is no longer
 * seeded by a Run start (`seededByRunId` is deliberately not carried over). Whether it holds a
 * settled Run, and which of its messages that Run left, still is.
 */
export function withRunRenderMessages(
  state: RenderSnapshotState,
  id: SessionId,
  messages: readonly UIMessage[],
) {
  const existing = state.renderSnapshotsBySessionId.get(id)
  const settledMessageIds = settledIdsStillShown(existing?.settledMessageIds, messages)
  const next = new Map(state.renderSnapshotsBySessionId)
  next.set(id, {
    messages: [...messages],
    compactionStatus: existing?.compactionStatus ?? null,
    updatedAt: Date.now(),
    ...(existing?.settledRunId === undefined ? {} : { settledRunId: existing.settledRunId }),
    ...(settledMessageIds ? { settledMessageIds } : {}),
  })
  return { renderSnapshotsBySessionId: next }
}

/** The settled message ids a route's transcript still shows; none once it rehydrated without them. */
function settledIdsStillShown(
  settledMessageIds: ReadonlySet<string> | undefined,
  messages: readonly UIMessage[],
) {
  if (!settledMessageIds) return undefined
  const shown = new Set<string>()
  for (const message of messages) {
    if (settledMessageIds.has(message.id)) shown.add(message.id)
  }
  return shown.size > 0 ? shown : undefined
}

function rebaseRestoredCompaction(
  status: AgentCompactionStatus | null,
  messageCount: number,
): AgentCompactionStatus | null {
  if (!status || messageCount === 0) return status
  const timelineStatus = getTimelineCompactionStatus(status)
  if (!timelineStatus?.timeline.some((item) => item.messageCountAtStart === 0)) {
    return status
  }
  const rebasedTimelineStatus = {
    ...timelineStatus,
    timeline: timelineStatus.timeline.map((item) =>
      item.messageCountAtStart === 0 ? { ...item, messageCountAtStart: messageCount } : item,
    ),
  }
  return status.type === 'retrying'
    ? { ...status, previousCompactionStatus: rebasedTimelineStatus }
    : rebasedTimelineStatus
}

export function withRunCompactionStatus(
  state: RenderSnapshotState,
  id: SessionId,
  status: AgentCompactionStatus | null,
  active: boolean,
) {
  const existing = state.renderSnapshotsBySessionId.get(id)
  if (!existing) return state
  const next = new Map(state.renderSnapshotsBySessionId)
  if (status === null && !active) {
    next.delete(id)
    return { renderSnapshotsBySessionId: next }
  }
  next.set(id, {
    ...existing,
    compactionStatus: rebaseRestoredCompaction(status, existing.messages.length),
    updatedAt: Date.now(),
  })
  return { renderSnapshotsBySessionId: next }
}

/** What a snapshot holding a settled Run is marked with: that Run's id, or a mark naming none. */
function settledRunMark(runId: string | undefined) {
  return runId ?? SETTLED_UNNAMED_RUN
}

/**
 * A Run settled. Whatever the snapshot holds now (that Run's seed, a seed that could not name it, or
 * the whole transcript a route left behind) includes its answers, which the settlement persisted
 * under Pi entry ids their stream ids never match. So the snapshot is no longer seeded by an active
 * Run, is marked as holding a settled one (the next Run's start reseeds it), and remembers the
 * messages it held then, which hydration leaves to the persisted transcript once it holds them.
 *
 * A seed naming another Run is that Run's, started before this settlement arrived, and is kept. A
 * settlement naming no Run (a reconnect that found the Session idle, a manual compaction ending)
 * arrives only when no later Run has started, so it settles any seed.
 */
export function withSettledRunRenderSnapshot(
  state: RenderSnapshotState,
  id: SessionId,
  settledRunId: string | undefined,
) {
  const existing = state.renderSnapshotsBySessionId.get(id)
  if (!existing) return state
  if (settledRunId !== undefined && isSeededByAnotherRun(existing, settledRunId)) return state
  const settledMessageIds = new Set(existing.settledMessageIds)
  for (const message of existing.messages) settledMessageIds.add(message.id)
  const { seededByRunId: _settledSeed, ...unseeded } = existing
  const next = new Map(state.renderSnapshotsBySessionId)
  next.set(id, {
    ...unseeded,
    settledRunId: settledRunMark(settledRunId),
    ...(settledMessageIds.size > 0 ? { settledMessageIds } : {}),
  })
  return { renderSnapshotsBySessionId: next }
}

function isSeededByAnotherRun(snapshot: RunRenderSnapshot, runId: string) {
  const seed = snapshot.seededByRunId
  return seed !== undefined && seed !== runId && !isUnnamedRunSeed(seed)
}

/**
 * The settled Run's Session refreshed, so its persisted transcript replaces the snapshot while it
 * still holds a settled Run. Once a Run started meanwhile, the start dropped the mark and the
 * snapshot is that Run's (its seed, or the transcript a route rendering it wrote since), and every
 * event the Run streams needs it.
 */
export function withoutSettledRunRenderSnapshot(state: RenderSnapshotState, id: SessionId) {
  if (state.renderSnapshotsBySessionId.get(id)?.settledRunId === undefined) return state
  return withoutRunRenderSnapshot(state, id)
}

export function withoutRunRenderSnapshot(state: RenderSnapshotState, id: SessionId) {
  if (!state.renderSnapshotsBySessionId.has(id)) return state
  const next = new Map(state.renderSnapshotsBySessionId)
  next.delete(id)
  return { renderSnapshotsBySessionId: next }
}
