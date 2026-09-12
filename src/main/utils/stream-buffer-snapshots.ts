import type { MessagePart } from '@shared/types/agent'
import type {
  BackgroundRunActivityEvent,
  BackgroundRunSnapshot,
  RunMode,
  WorktreeLaunchSnapshot,
} from '@shared/types/background-run'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import { retainedPartsBytes } from './stream-buffer-byte-accounting'

export interface ActiveStreamBuffer {
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
  readonly messageId?: string
  readonly parts: readonly MessagePart[]
  readonly activityEvents?: readonly BackgroundRunActivityEvent[]
  readonly activityEventsBytes?: number
  readonly retainedBytes: number
  readonly omittedBytes: number
  readonly degradedToolCallIds: ReadonlySet<string>
  readonly degradedToolCallIdsBytes: number
  readonly worktreeLaunch?: WorktreeLaunchSnapshot
}

export const MAX_ACTIVE_STREAM_BUFFER_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_STREAM_BUFFER_BYTES = 6 * 1024 * 1024
export const MAX_DEGRADED_TOOL_CALL_IDS = 256

const JSON_ARRAY_BRACKETS_BYTES = 2
const JSON_ARRAY_SEPARATOR_BYTES = 1

export function degradedToolCallIdRetainedDelta(
  toolCallIds: ReadonlySet<string>,
  toolCallId: string,
) {
  if (toolCallIds.has(toolCallId)) return 0
  if (toolCallIds.size >= MAX_DEGRADED_TOOL_CALL_IDS) return null
  return (
    Buffer.byteLength(JSON.stringify(toolCallId), 'utf8') +
    (toolCallIds.size === 0 ? JSON_ARRAY_BRACKETS_BYTES : JSON_ARRAY_SEPARATOR_BYTES)
  )
}

export function retainedStreamBufferBytes(buffer: ActiveStreamBuffer) {
  return buffer.retainedBytes + buffer.degradedToolCallIdsBytes + (buffer.activityEventsBytes ?? 0)
}

export function withoutRetainedStreamContent(buffer: ActiveStreamBuffer): ActiveStreamBuffer {
  return {
    ...buffer,
    parts: [],
    retainedBytes: 0,
    degradedToolCallIds: new Set(),
    degradedToolCallIdsBytes: 0,
  }
}

export function exceedsStreamBufferLimit(
  buffer: ActiveStreamBuffer,
  retainedPartsBytes: number,
  totalRetainedBytes: number,
  retainedDelta: number,
) {
  return (
    retainedPartsBytes + buffer.degradedToolCallIdsBytes + (buffer.activityEventsBytes ?? 0) >
      MAX_ACTIVE_STREAM_BUFFER_BYTES ||
    totalRetainedBytes + retainedDelta > MAX_TOTAL_STREAM_BUFFER_BYTES
  )
}

export function retainDegradedToolCallId(
  buffer: ActiveStreamBuffer,
  toolCallId: string,
  totalRetainedBytes: number,
) {
  const retainedDelta = degradedToolCallIdRetainedDelta(buffer.degradedToolCallIds, toolCallId)
  if (
    retainedDelta === null ||
    retainedStreamBufferBytes(buffer) + retainedDelta > MAX_ACTIVE_STREAM_BUFFER_BYTES ||
    totalRetainedBytes + retainedDelta > MAX_TOTAL_STREAM_BUFFER_BYTES
  ) {
    return { buffer, retainedDelta: 0 }
  }
  return {
    buffer: {
      ...buffer,
      degradedToolCallIds: new Set([...buffer.degradedToolCallIds, toolCallId]),
      degradedToolCallIdsBytes: buffer.degradedToolCallIdsBytes + retainedDelta,
    },
    retainedDelta,
  }
}

function restoreDegradedToolCallIds(input: {
  readonly toolCallIds: readonly string[]
  readonly retainedPartsBytes: number
  readonly totalRetainedBytes: number
}) {
  const toolCallIds = new Set<string>()
  let retainedBytes = 0
  for (const toolCallId of input.toolCallIds) {
    const retainedDelta = degradedToolCallIdRetainedDelta(toolCallIds, toolCallId)
    if (retainedDelta === null) break
    if (retainedDelta === 0) continue
    if (
      input.retainedPartsBytes + retainedBytes + retainedDelta > MAX_ACTIVE_STREAM_BUFFER_BYTES ||
      input.totalRetainedBytes + input.retainedPartsBytes + retainedBytes + retainedDelta >
        MAX_TOTAL_STREAM_BUFFER_BYTES
    ) {
      continue
    }
    toolCallIds.add(toolCallId)
    retainedBytes += retainedDelta
  }
  return { toolCallIds, retainedBytes }
}

export function toStreamBufferSnapshot(
  sessionId: SessionId,
  buffer: ActiveStreamBuffer | undefined,
): BackgroundRunSnapshot | null {
  if (!buffer) return null
  return {
    activity: 'agent-run',
    sessionId,
    model: buffer.model,
    mode: buffer.mode,
    startedAt: buffer.startedAt,
    ...(buffer.messageId ? { messageId: buffer.messageId } : {}),
    parts: [...buffer.parts],
    activityEvents: [...(buffer.activityEvents ?? [])],
    ...(buffer.omittedBytes > 0
      ? {
          degraded: {
            reason: 'content-limit' as const,
            omittedBytes: buffer.omittedBytes,
            ...(buffer.degradedToolCallIds.size > 0
              ? { toolCallIds: [...buffer.degradedToolCallIds] }
              : {}),
          },
        }
      : {}),
    ...(buffer.worktreeLaunch ? { worktreeLaunch: buffer.worktreeLaunch } : {}),
  }
}

export function withWorktreeLaunchSnapshot(
  buffer: ActiveStreamBuffer | undefined,
  snapshot: WorktreeLaunchSnapshot | null,
) {
  if (!buffer) return undefined
  if (snapshot !== null) return { ...buffer, worktreeLaunch: snapshot }
  const { worktreeLaunch: _worktreeLaunch, ...withoutLaunch } = buffer
  return withoutLaunch
}

function restoreActivityEvents(
  activityEvents: readonly BackgroundRunActivityEvent[],
  retainedPartsBytes: number,
  totalRetainedBytes: number,
) {
  const retainedBytes =
    activityEvents.length > 0 ? Buffer.byteLength(JSON.stringify(activityEvents), 'utf8') : 0
  const accepted =
    retainedPartsBytes + retainedBytes <= MAX_ACTIVE_STREAM_BUFFER_BYTES &&
    totalRetainedBytes + retainedPartsBytes + retainedBytes <= MAX_TOTAL_STREAM_BUFFER_BYTES
  return {
    activityEvents: accepted ? [...activityEvents] : [],
    activityEventsBytes: accepted ? retainedBytes : 0,
  }
}

export function restoreStreamBufferSnapshots(
  buffers: Map<SessionId, ActiveStreamBuffer>,
  snapshots: readonly BackgroundRunSnapshot[],
) {
  const previousSessionIds = [...buffers.keys()]
  buffers.clear()
  let totalRetainedBytes = 0
  for (const snapshot of snapshots) {
    const retainedBytes = retainedPartsBytes(snapshot.parts)
    const accepted =
      retainedBytes <= MAX_ACTIVE_STREAM_BUFFER_BYTES &&
      totalRetainedBytes + retainedBytes <= MAX_TOTAL_STREAM_BUFFER_BYTES
    const acceptedRetainedBytes = accepted ? retainedBytes : 0
    const activity = restoreActivityEvents(
      snapshot.activityEvents ?? [],
      acceptedRetainedBytes,
      totalRetainedBytes,
    )
    const degradedToolCallIds = restoreDegradedToolCallIds({
      toolCallIds: snapshot.degraded?.toolCallIds ?? [],
      retainedPartsBytes: acceptedRetainedBytes + activity.activityEventsBytes,
      totalRetainedBytes,
    })
    buffers.set(snapshot.sessionId, {
      model: snapshot.model,
      mode: snapshot.mode,
      startedAt: snapshot.startedAt,
      ...(snapshot.messageId ? { messageId: snapshot.messageId } : {}),
      parts: accepted ? [...snapshot.parts] : [],
      ...activity,
      retainedBytes: acceptedRetainedBytes,
      omittedBytes: (snapshot.degraded?.omittedBytes ?? 0) + (accepted ? 0 : retainedBytes),
      degradedToolCallIds: degradedToolCallIds.toolCallIds,
      degradedToolCallIdsBytes: degradedToolCallIds.retainedBytes,
      ...(snapshot.worktreeLaunch ? { worktreeLaunch: snapshot.worktreeLaunch } : {}),
    })
    totalRetainedBytes +=
      acceptedRetainedBytes + degradedToolCallIds.retainedBytes + activity.activityEventsBytes
  }
  return { previousSessionIds, totalRetainedBytes }
}
