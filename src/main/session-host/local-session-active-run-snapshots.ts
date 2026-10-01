import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { backgroundRunUserMessageSchema } from '@shared/schemas/agent-transport-user-message'
import {
  backgroundRunActivityEventsSchema,
  worktreeLaunchEnvironmentSchema,
  worktreeLaunchStageSchema,
  worktreeLaunchStepSchema,
  worktreeSetupActionTerminalSchema,
} from '@shared/schemas/background-run'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { BackgroundRunSnapshot, WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import { isRecord } from './local-session-client-connection'

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

function decodeWorktreeLaunchSnapshot(value: unknown): WorktreeLaunchSnapshot | undefined {
  if (value === undefined) return undefined
  return decodeUnknownExactOrThrow(worktreeLaunchSnapshotSchema, value)
}

function decodeUserMessageSnapshots(value: unknown): Pick<BackgroundRunSnapshot, 'userMessages'> {
  if (value === undefined) return {}
  const userMessages = decodeUnknownExactOrThrow(
    Schema.Array(backgroundRunUserMessageSchema),
    value,
  )
  return userMessages.length > 0 ? { userMessages } : {}
}

/** Decodes the active Run snapshots a Local Session Host subscription opens with. */
export function decodeActiveRunSnapshots(value: unknown): BackgroundRunSnapshot[] {
  if (!Array.isArray(value)) throw new Error('Local Session Host returned an invalid Run snapshot.')
  return value.map((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.activity !== 'agent-run' ||
      typeof candidate.sessionId !== 'string' ||
      typeof candidate.model !== 'string' ||
      (candidate.mode !== 'classic' && candidate.mode !== 'waggle') ||
      typeof candidate.startedAt !== 'number' ||
      !Array.isArray(candidate.parts) ||
      (candidate.messageId !== undefined && typeof candidate.messageId !== 'string')
    ) {
      throw new Error('Local Session Host returned an invalid active Run snapshot.')
    }
    const degraded = decodeDegradedSnapshot(candidate.degraded)
    const worktreeLaunch = decodeWorktreeLaunchSnapshot(candidate.worktreeLaunch)
    return {
      activity: 'agent-run',
      activityEvents: decodeUnknownExactOrThrow(
        backgroundRunActivityEventsSchema,
        candidate.activityEvents,
      ),
      sessionId: SessionId(candidate.sessionId),
      model: SupportedModelId(candidate.model),
      mode: candidate.mode,
      startedAt: candidate.startedAt,
      ...(candidate.messageId ? { messageId: candidate.messageId } : {}),
      parts: candidate.parts.map(decodeMessagePart),
      ...decodeUserMessageSnapshots(candidate.userMessages),
      ...(degraded ? { degraded } : {}),
      ...(worktreeLaunch ? { worktreeLaunch } : {}),
    }
  })
}

const jsonObjectSchema = Schema.Record({ key: Schema.String, value: jsonValueSchema })
const messagePartSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('text', 'reasoning'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('attachment'),
    attachment: Schema.Struct({
      id: Schema.String,
      kind: Schema.Literal('text', 'image', 'pdf'),
      origin: Schema.optional(
        Schema.Literal('user-file', 'auto-paste-text', 'browser-preview', 'session-resource'),
      ),
      name: Schema.String,
      path: Schema.String,
      mimeType: Schema.String,
      sizeBytes: Schema.Number,
      contentSha256: Schema.optional(Schema.String),
      extractedText: Schema.String,
    }),
  }),
  Schema.Struct({
    type: Schema.Literal('tool-call'),
    toolCall: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      args: jsonObjectSchema,
      state: Schema.optional(Schema.Literal('input-complete')),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal('tool-result'),
    toolResult: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      args: jsonObjectSchema,
      result: jsonValueSchema,
      isError: Schema.Boolean,
      duration: Schema.Number,
      details: Schema.optional(jsonValueSchema),
    }),
  }),
)

function decodeMessagePart(value: unknown) {
  const part = decodeUnknownExactOrThrow(messagePartSchema, value)
  if (part.type === 'tool-call') {
    return { ...part, toolCall: { ...part.toolCall, id: ToolCallId(part.toolCall.id) } }
  }
  if (part.type === 'tool-result') {
    return { ...part, toolResult: { ...part.toolResult, id: ToolCallId(part.toolResult.id) } }
  }
  return part
}
