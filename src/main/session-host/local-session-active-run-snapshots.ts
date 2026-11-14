import { decodeUnknownExactOrThrow, Schema, safeDecodeUnknown } from '@shared/schema'
import { backgroundRunUserMessageSchema } from '@shared/schemas/agent-transport-user-message'
import {
  backgroundRunActivityEventsSchema,
  worktreeLaunchSnapshotSchema,
} from '@shared/schemas/background-run'
import type { BackgroundRunSnapshot, WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import {
  decodeAssistantMessageSnapshots,
  decodeStreamingParts,
  reportUndecodable,
  type SnapshotContext,
  withUndecodableParts,
} from './local-session-snapshot-parts'

const degradedSnapshotSchema = Schema.Struct({
  reason: Schema.Literal('content-limit'),
  omittedBytes: Schema.Number,
  toolCallIds: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  messageCutShort: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

function decodeDegradedSnapshot(value: unknown) {
  const decoded = safeDecodeUnknown(degradedSnapshotSchema, value)
  if (!decoded.success) return undefined
  const { omittedBytes, toolCallIds = [], messageCutShort } = decoded.data
  const snapshot: BackgroundRunSnapshot['degraded'] | undefined = {
    reason: 'content-limit',
    omittedBytes,
    ...(toolCallIds.length > 0 ? { toolCallIds } : {}),
    // One that does not say whether the caps cut the streaming message counts as cut: its parts
    // must not pass for the whole message over a longer shown copy.
    messageCutShort: messageCutShort !== false,
  }
  return snapshot
}

function decodeWorktreeLaunchSnapshot(value: unknown, context: SnapshotContext) {
  if (value === undefined) return undefined
  try {
    const snapshot: WorktreeLaunchSnapshot | undefined = decodeUnknownExactOrThrow(
      worktreeLaunchSnapshotSchema,
      value,
    )
    return snapshot
  } catch (error) {
    reportUndecodable(context, 'the worktree launch', error)
    return undefined
  }
}

const userMessageSnapshotSchema = Schema.Array(backgroundRunUserMessageSchema)

function decodeUserMessageSnapshots(value: unknown, context: SnapshotContext) {
  if (value === undefined) {
    const pick: Pick<BackgroundRunSnapshot, 'userMessages'> = {}
    return pick
  }
  try {
    const userMessages = decodeUnknownExactOrThrow(userMessageSnapshotSchema, value)
    const pick: Pick<BackgroundRunSnapshot, 'userMessages'> =
      userMessages.length > 0 ? { userMessages } : {}
    return pick
  } catch (error) {
    // Without them the reconnect places the Run's user messages from the Session detail.
    reportUndecodable(context, 'the incorporated user messages', error)
    const pick: Pick<BackgroundRunSnapshot, 'userMessages'> = {}
    return pick
  }
}

function decodeActivityEvents(value: unknown, context: SnapshotContext) {
  try {
    return decodeUnknownExactOrThrow(backgroundRunActivityEventsSchema, value)
  } catch (error) {
    reportUndecodable(context, 'the activity events', error)
    return []
  }
}

/**
 * The members every active Run snapshot has, and the others still undecoded: each of those is
 * decoded on its own, so one this client cannot read costs only that member.
 */
const activeRunSnapshotCandidateSchema = Schema.Struct({
  activity: Schema.Literal('agent-run'),
  sessionId: Schema.String,
  model: Schema.String,
  mode: Schema.Literal('classic', 'waggle'),
  startedAt: Schema.Number,
  parts: Schema.Array(Schema.Unknown),
  messageId: Schema.optionalWith(Schema.String, { exact: true }),
  runId: Schema.optionalWith(Schema.String, { exact: true }),
  messageStartedAt: Schema.optionalWith(Schema.Unknown, { exact: true }),
  degraded: Schema.optionalWith(Schema.Unknown, { exact: true }),
  worktreeLaunch: Schema.optionalWith(Schema.Unknown, { exact: true }),
  activityEvents: Schema.optionalWith(Schema.Unknown, { exact: true }),
  userMessages: Schema.optionalWith(Schema.Unknown, { exact: true }),
  assistantMessages: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

const snapshotSessionIdSchema = Schema.Struct({ sessionId: Schema.String })

function invalidSnapshot(candidate: unknown, index: number) {
  const session = Schema.is(snapshotSessionIdSchema)(candidate)
    ? `, Session ${candidate.sessionId}`
    : ''
  return new Error(
    `Local Session Host returned an invalid active Run snapshot (index ${String(index)}${session}).`,
  )
}

/**
 * Decodes the active Run snapshots a Local Session Host subscription opens with.
 *
 * Only a snapshot without a Run identity fails the decode: the bridge reads a Session missing from
 * the snapshots as a settled Run. Anything else this client cannot decode is logged and left out of
 * that Run's snapshot alone (see `reportUndecodable`).
 */
export function decodeActiveRunSnapshots(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Local Session Host returned an invalid Run snapshot.')
  const snapshot: BackgroundRunSnapshot[] = value.map((value: unknown, index) => {
    const decoded = safeDecodeUnknown(activeRunSnapshotCandidateSchema, value)
    if (!decoded.success) throw invalidSnapshot(value, index)
    const candidate = decoded.data
    const context: SnapshotContext = {
      sessionId: candidate.sessionId,
      ...(candidate.runId ? { runId: candidate.runId } : {}),
    }
    const streaming = decodeStreamingParts(candidate, context)
    const degraded = withUndecodableParts(decodeDegradedSnapshot(candidate.degraded), streaming)
    const worktreeLaunch = decodeWorktreeLaunchSnapshot(candidate.worktreeLaunch, context)
    return {
      activity: 'agent-run',
      activityEvents: decodeActivityEvents(candidate.activityEvents, context),
      sessionId: SessionId(candidate.sessionId),
      ...(typeof candidate.runId === 'string' ? { runId: candidate.runId } : {}),
      model: SupportedModelId(candidate.model),
      mode: candidate.mode,
      startedAt: candidate.startedAt,
      ...(candidate.messageId ? { messageId: candidate.messageId } : {}),
      ...(typeof candidate.messageStartedAt === 'number'
        ? { messageStartedAt: candidate.messageStartedAt }
        : {}),
      parts: streaming.parts,
      ...decodeUserMessageSnapshots(candidate.userMessages, context),
      ...decodeAssistantMessageSnapshots(candidate.assistantMessages, context),
      ...(degraded ? { degraded } : {}),
      ...(worktreeLaunch ? { worktreeLaunch } : {}),
    }
  })
  return snapshot
}
