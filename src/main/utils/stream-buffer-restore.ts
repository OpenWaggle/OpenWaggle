import type {
  BackgroundRunActivityEvent,
  BackgroundRunSnapshot,
  BackgroundRunUserMessage,
} from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import { retainedPartsBytes } from './stream-buffer-byte-accounting'
import { restoreRunHistory, runHistoryBytes } from './stream-buffer-history'
import {
  type ActiveStreamBuffer,
  degradedToolCallIdRetainedDelta,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  MAX_TOTAL_STREAM_BUFFER_BYTES,
} from './stream-buffer-snapshots'

/*
 * Stream buffers restored from the snapshots a Session Host subscription opens with (the GUI's
 * replica of the Host's buffers), within the same byte caps the Host keeps them under.
 */

/** Snapshot fields a restored buffer keeps only when the snapshot has them. */
function restoredOptionalFields(snapshot: BackgroundRunSnapshot) {
  return {
    ...(snapshot.runId ? { runId: snapshot.runId } : {}),
    ...(snapshot.messageId ? { messageId: snapshot.messageId } : {}),
    ...(snapshot.messageStartedAt === undefined
      ? {}
      : { messageStartedAt: snapshot.messageStartedAt }),
    ...(snapshot.worktreeLaunch ? { worktreeLaunch: snapshot.worktreeLaunch } : {}),
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

function restoreUserMessages(
  userMessages: readonly BackgroundRunUserMessage[],
  retainedBytesBefore: number,
  totalRetainedBytes: number,
) {
  const retainedBytes =
    userMessages.length > 0 ? Buffer.byteLength(JSON.stringify(userMessages), 'utf8') : 0
  const accepted =
    retainedBytes > 0 &&
    retainedBytesBefore + retainedBytes <= MAX_ACTIVE_STREAM_BUFFER_BYTES &&
    totalRetainedBytes + retainedBytesBefore + retainedBytes <= MAX_TOTAL_STREAM_BUFFER_BYTES
  return accepted ? { userMessages: [...userMessages], userMessagesBytes: retainedBytes } : {}
}

/**
 * What the caps omitted from a snapshot's buffer (`droppedBytes`: its parts, when they did not
 * fit here). Its omissions do not say which message they cut: the one streaming counts as cut short
 * then (`retainFinishedAssistantMessage` leaves it out of the history).
 */
function restoredOmission(snapshot: BackgroundRunSnapshot, droppedBytes: number) {
  const omittedBytes = (snapshot.degraded?.omittedBytes ?? 0) + droppedBytes
  return {
    omittedBytes,
    messageOmittedBytes: omittedBytes,
    ...(omittedBytes > 0 ? { messageCutShort: true as const } : {}),
  }
}

export function restoreStreamBufferSnapshots(
  buffers: Map<SessionId, ActiveStreamBuffer>,
  snapshots: readonly BackgroundRunSnapshot[],
) {
  // The Run each buffer held: the one the bridge last relayed for its Session.
  const previousRunIds = new Map(
    [...buffers].map(([sessionId, buffer]) => [sessionId, buffer.runId]),
  )
  buffers.clear()
  let totalRetainedBytes = 0
  let totalHistoryBytes = 0
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
    const userMessages = restoreUserMessages(
      snapshot.userMessages ?? [],
      acceptedRetainedBytes + activity.activityEventsBytes,
      totalRetainedBytes,
    )
    const userMessagesBytes = userMessages.userMessagesBytes ?? 0
    const history = restoreRunHistory(snapshot.assistantMessages ?? [], totalHistoryBytes)
    const sideChannelBytes = activity.activityEventsBytes + userMessagesBytes
    const degradedToolCallIds = restoreDegradedToolCallIds({
      toolCallIds: snapshot.degraded?.toolCallIds ?? [],
      retainedPartsBytes: acceptedRetainedBytes + sideChannelBytes,
      totalRetainedBytes,
    })
    buffers.set(snapshot.sessionId, {
      ...restoredOptionalFields(snapshot),
      model: snapshot.model,
      mode: snapshot.mode,
      startedAt: snapshot.startedAt,
      parts: accepted ? [...snapshot.parts] : [],
      ...activity,
      ...userMessages,
      ...history,
      retainedBytes: acceptedRetainedBytes,
      ...restoredOmission(snapshot, accepted ? 0 : retainedBytes),
      degradedToolCallIds: degradedToolCallIds.toolCallIds,
      degradedToolCallIdsBytes: degradedToolCallIds.retainedBytes,
    })
    totalRetainedBytes +=
      acceptedRetainedBytes + degradedToolCallIds.retainedBytes + sideChannelBytes
    totalHistoryBytes += runHistoryBytes(history)
  }
  return { previousRunIds, totalRetainedBytes, totalHistoryBytes }
}
