import { decodeUnknownExactOrThrow, Schema, safeDecodeUnknown } from '@shared/schema'
import { backgroundRunUserMessageSchema } from '@shared/schemas/agent-transport-user-message'
import {
  backgroundRunActivityEventsSchema,
  worktreeLaunchEnvironmentSchema,
  worktreeLaunchStageSchema,
  worktreeLaunchStepSchema,
  worktreeSetupActionTerminalSchema,
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
  toolCallIds: Schema.optional(Schema.Array(Schema.String)),
  messageCutShort: Schema.optional(Schema.Unknown),
})

function decodeDegradedSnapshot(value: unknown): BackgroundRunSnapshot['degraded'] | undefined {
  const decoded = safeDecodeUnknown(degradedSnapshotSchema, value)
  if (!decoded.success) return undefined
  const { omittedBytes, toolCallIds = [], messageCutShort } = decoded.data
  return {
    reason: 'content-limit',
    omittedBytes,
    ...(toolCallIds.length > 0 ? { toolCallIds } : {}),
    // One that does not say whether the caps cut the streaming message counts as cut: its parts
    // must not pass for the whole message over a longer shown copy.
    messageCutShort: messageCutShort !== false,
  }
}

const worktreeLaunchSnapshotSchema = Schema.Struct({
  status: Schema.Literal('running', 'complete', 'failed'),
  stage: worktreeLaunchStageSchema,
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  details: Schema.Array(Schema.String),
  environment: Schema.optional(worktreeLaunchEnvironmentSchema),
  steps: Schema.optional(Schema.Array(worktreeLaunchStepSchema)),
  progressPercentage: Schema.optional(Schema.Number),
  worktreePath: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  setupAction: Schema.optional(worktreeSetupActionTerminalSchema),
  errorMessage: Schema.optional(Schema.String),
})

function decodeWorktreeLaunchSnapshot(
  value: unknown,
  context: SnapshotContext,
): WorktreeLaunchSnapshot | undefined {
  if (value === undefined) return undefined
  try {
    return decodeUnknownExactOrThrow(worktreeLaunchSnapshotSchema, value)
  } catch (error) {
    reportUndecodable(context, 'the worktree launch', error)
    return undefined
  }
}

const userMessageSnapshotSchema = Schema.Array(backgroundRunUserMessageSchema)

function decodeUserMessageSnapshots(
  value: unknown,
  context: SnapshotContext,
): Pick<BackgroundRunSnapshot, 'userMessages'> {
  if (value === undefined) return {}
  try {
    const userMessages = decodeUnknownExactOrThrow(userMessageSnapshotSchema, value)
    return userMessages.length > 0 ? { userMessages } : {}
  } catch (error) {
    // Without them the reconnect places the Run's user messages from the Session detail.
    reportUndecodable(context, 'the incorporated user messages', error)
    return {}
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
  messageId: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  messageStartedAt: Schema.optional(Schema.Unknown),
  degraded: Schema.optional(Schema.Unknown),
  worktreeLaunch: Schema.optional(Schema.Unknown),
  activityEvents: Schema.optional(Schema.Unknown),
  userMessages: Schema.optional(Schema.Unknown),
  assistantMessages: Schema.optional(Schema.Unknown),
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
export function decodeActiveRunSnapshots(value: unknown): BackgroundRunSnapshot[] {
  if (!Array.isArray(value)) throw new Error('Local Session Host returned an invalid Run snapshot.')
  return value.map((value: unknown, index) => {
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
}
