import type { MessagePart } from '@shared/types/agent'
import type {
  BackgroundRunActivityEvent,
  BackgroundRunAssistantMessage,
  BackgroundRunSnapshot,
  BackgroundRunUserMessage,
  RunMode,
  WorktreeLaunchSnapshot,
} from '@shared/types/background-run'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import { durableSessionRunId } from '../domain/session-control/root-session-project-reach'

export interface ActiveStreamBuffer {
  /**
   * The Run this buffer holds: set where the Host starts the Run, carried through snapshots, and
   * updated by the `agent_start` the replica projects. Unknown only for buffers from an older Host.
   */
  readonly runId?: string
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
  readonly messageId?: string
  /**
   * When the message `parts` streams started, and how much the caps had omitted by then; or, from
   * a snapshot that reported omissions, that the caps may have cut it.
   */
  readonly messageStartedAt?: number
  readonly messageOmittedBytes?: number
  readonly messageCutShort?: true
  readonly parts: readonly MessagePart[]
  /** The Run's finished assistant messages, and the JSON size of each (`stream-buffer-history`). */
  readonly assistantMessages?: readonly BackgroundRunAssistantMessage[]
  readonly assistantMessageBytes?: readonly number[]
  readonly activityEvents?: readonly BackgroundRunActivityEvent[]
  readonly activityEventsBytes?: number
  readonly userMessages?: readonly BackgroundRunUserMessage[]
  readonly userMessagesBytes?: number
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

function retainedSideChannelBytes(buffer: ActiveStreamBuffer) {
  return (buffer.activityEventsBytes ?? 0) + (buffer.userMessagesBytes ?? 0)
}

/** The live content's bytes: the Run's finished-message history has its own budget. */
export function retainedStreamBufferBytes(buffer: ActiveStreamBuffer) {
  return buffer.retainedBytes + buffer.degradedToolCallIdsBytes + retainedSideChannelBytes(buffer)
}

/**
 * Whether an `agent_start` begins another Run than the one the buffer holds. A queued Follow-up the
 * Host went straight on to starts without the settled Run's buffer being cleared here; the Host starts
 * that Run's buffer empty, and a replica that kept the settled Run's last answer showed it twice on a
 * reconnect, once more above the Follow-up, since the transcript then holds it under its Pi entry id.
 * An auto-retry starts the same Run again and keeps what it streamed, as does a Waggle the agent
 * requested (`waggle-of-<X>`), which goes on with Run X.
 */
export function startsAnotherRun(existing: ActiveStreamBuffer, runId: string) {
  return (
    existing.runId !== undefined &&
    durableSessionRunId(existing.runId) !== durableSessionRunId(runId)
  )
}

export function emptyActiveStreamBuffer(input: {
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
  readonly runId?: string | undefined
}): ActiveStreamBuffer {
  return {
    ...(input.runId ? { runId: input.runId } : {}),
    model: input.model,
    mode: input.mode,
    startedAt: input.startedAt,
    parts: [],
    retainedBytes: 0,
    omittedBytes: 0,
    degradedToolCallIds: new Set(),
    degradedToolCallIdsBytes: 0,
  }
}

/** The buffer for the next message, which started at `startedAt`, without the last one's parts. */
export function withoutRetainedStreamContent(
  buffer: ActiveStreamBuffer,
  startedAt?: number,
): ActiveStreamBuffer {
  const { messageCutShort: _cutShort, ...next } = buffer
  return {
    ...next,
    ...(startedAt === undefined ? {} : { messageStartedAt: startedAt }),
    messageOmittedBytes: buffer.omittedBytes,
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
    retainedPartsBytes + buffer.degradedToolCallIdsBytes + retainedSideChannelBytes(buffer) >
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

/** Whether the live caps cut the message the buffer streams (not only an earlier one). */
export function isMessageCutShort(buffer: ActiveStreamBuffer) {
  return (
    buffer.messageCutShort === true ||
    buffer.omittedBytes !== (buffer.messageOmittedBytes ?? 0) ||
    buffer.degradedToolCallIds.size > 0
  )
}

export function toStreamBufferSnapshot(
  sessionId: SessionId,
  buffer: ActiveStreamBuffer | undefined,
): BackgroundRunSnapshot | null {
  if (!buffer) return null
  return {
    activity: 'agent-run',
    sessionId,
    ...(buffer.runId ? { runId: buffer.runId } : {}),
    model: buffer.model,
    mode: buffer.mode,
    startedAt: buffer.startedAt,
    ...(buffer.messageId ? { messageId: buffer.messageId } : {}),
    ...(buffer.messageStartedAt === undefined ? {} : { messageStartedAt: buffer.messageStartedAt }),
    parts: [...buffer.parts],
    ...(buffer.userMessages && buffer.userMessages.length > 0
      ? { userMessages: [...buffer.userMessages] }
      : {}),
    ...(buffer.assistantMessages && buffer.assistantMessages.length > 0
      ? { assistantMessages: [...buffer.assistantMessages] }
      : {}),
    activityEvents: [...(buffer.activityEvents ?? [])],
    ...(buffer.omittedBytes > 0
      ? {
          degraded: {
            reason: 'content-limit' as const,
            omittedBytes: buffer.omittedBytes,
            ...(buffer.degradedToolCallIds.size > 0
              ? { toolCallIds: [...buffer.degradedToolCallIds] }
              : {}),
            messageCutShort: isMessageCutShort(buffer),
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
