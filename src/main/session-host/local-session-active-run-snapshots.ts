import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
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
import { isRecord } from './local-session-client-connection'
import {
  decodeAssistantMessageSnapshots,
  decodeStreamingParts,
  reportUndecodable,
  type SnapshotContext,
  withUndecodableParts,
} from './local-session-snapshot-parts'

function decodeStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string')
  return strings.length === value.length ? strings : undefined
}

function decodeDegradedSnapshot(value: unknown): BackgroundRunSnapshot['degraded'] | undefined {
  if (
    !isRecord(value) ||
    value.reason !== 'content-limit' ||
    typeof value.omittedBytes !== 'number'
  ) {
    return undefined
  }
  const toolCallIds = value.toolCallIds === undefined ? [] : decodeStringArray(value.toolCallIds)
  if (!toolCallIds) return undefined
  return {
    reason: 'content-limit',
    omittedBytes: value.omittedBytes,
    ...(toolCallIds.length > 0 ? { toolCallIds } : {}),
    // One that does not say whether the caps cut the streaming message counts as cut: its parts
    // must not pass for the whole message over a longer shown copy.
    messageCutShort: value.messageCutShort !== false,
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

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string'
}

interface ActiveRunSnapshotCandidate extends Record<string, unknown> {
  readonly activity: 'agent-run'
  readonly sessionId: string
  readonly model: string
  readonly mode: 'classic' | 'waggle'
  readonly startedAt: number
  readonly parts: readonly unknown[]
  readonly messageId?: string
  readonly runId?: string
}

function hasActiveRunSnapshotShape(
  candidate: Record<string, unknown>,
): candidate is ActiveRunSnapshotCandidate {
  return (
    candidate.activity === 'agent-run' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.model === 'string' &&
    (candidate.mode === 'classic' || candidate.mode === 'waggle') &&
    typeof candidate.startedAt === 'number' &&
    Array.isArray(candidate.parts) &&
    isOptionalString(candidate.messageId) &&
    isOptionalString(candidate.runId)
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
  return value.map((candidate, index) => {
    if (!isRecord(candidate) || !hasActiveRunSnapshotShape(candidate)) {
      const sessionId = isRecord(candidate) ? candidate.sessionId : undefined
      throw new Error(
        `Local Session Host returned an invalid active Run snapshot (index ${String(index)}${
          typeof sessionId === 'string' ? `, Session ${sessionId}` : ''
        }).`,
      )
    }
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
