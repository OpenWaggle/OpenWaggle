import type { MessagePart } from '@shared/types/agent'
import type {
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
  readonly retainedBytes: number
  readonly omittedBytes: number
  readonly degradedToolCallIds: ReadonlySet<string>
  readonly worktreeLaunch?: WorktreeLaunchSnapshot
}

export const MAX_ACTIVE_STREAM_BUFFER_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_STREAM_BUFFER_BYTES = 6 * 1024 * 1024

export function toStreamBufferSnapshot(
  sessionId: SessionId,
  buffer: ActiveStreamBuffer | undefined,
): BackgroundRunSnapshot | null {
  if (!buffer) return null
  return {
    sessionId,
    model: buffer.model,
    mode: buffer.mode,
    startedAt: buffer.startedAt,
    ...(buffer.messageId ? { messageId: buffer.messageId } : {}),
    parts: [...buffer.parts],
    ...(buffer.omittedBytes > 0
      ? { degraded: { reason: 'content-limit' as const, omittedBytes: buffer.omittedBytes } }
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
    buffers.set(snapshot.sessionId, {
      model: snapshot.model,
      mode: snapshot.mode,
      startedAt: snapshot.startedAt,
      ...(snapshot.messageId ? { messageId: snapshot.messageId } : {}),
      parts: accepted ? [...snapshot.parts] : [],
      retainedBytes: accepted ? retainedBytes : 0,
      omittedBytes: (snapshot.degraded?.omittedBytes ?? 0) + (accepted ? 0 : retainedBytes),
      degradedToolCallIds: new Set(),
      ...(snapshot.worktreeLaunch ? { worktreeLaunch: snapshot.worktreeLaunch } : {}),
    })
    totalRetainedBytes += accepted ? retainedBytes : 0
  }
  return { previousSessionIds, totalRetainedBytes }
}
