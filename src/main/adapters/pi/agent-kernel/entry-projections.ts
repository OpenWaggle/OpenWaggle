import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import type { MessagePart, MessageRole } from '@shared/types/agent'
import type { JsonValue } from '@shared/types/json'
import { createModelRef } from '@shared/types/llm'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import { toJsonValue } from '../pi-message-mapper'
import { assistantMessageProjection } from './assistant-message-projection'
import { hiveWakeProjection, isHiveWakeEntry } from './hive-wake-prompt'
import {
  buildMessageNodeContentJson,
  buildRawNodeContentJson,
  piToolResultContentToPart,
  piUserContentToDisplayParts,
} from './message-parts'
import { systemMessageTools } from './system-message-tools-projection'
import { visibleWaggleUserMessageProjection } from './visible-waggle-user-message-projection'

type PiMessageEntry = Extract<SessionEntry, { type: 'message' }>
type PiUserMessage = Extract<PiMessageEntry['message'], { role: 'user' }>
type PiToolResultMessage = Extract<PiMessageEntry['message'], { role: 'toolResult' }>
type PiBranchSummaryMessage = Extract<PiMessageEntry['message'], { role: 'branchSummary' }>
type PiCompactionSummaryMessage = Extract<PiMessageEntry['message'], { role: 'compactionSummary' }>
type PiBashExecutionMessage = Extract<PiMessageEntry['message'], { role: 'bashExecution' }>
type PiCustomMessage = Extract<PiMessageEntry['message'], { role: 'custom' }>

export interface PiEntryProjection {
  readonly kind: ProjectedSessionNodeInput['kind']
  readonly role: MessageRole | null
  readonly contentJson: string
  readonly metadataJson: string
}

function compactionReason(value: unknown) {
  if (typeof value !== 'object' || value === null || !('reason' in value)) return null
  const reason = value.reason
  return reason === 'manual' || reason === 'threshold' || reason === 'overflow' ? reason : null
}

function rawProjection(value: JsonValue) {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson(value),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function systemMessageProjection(value: Extract<PiMessageEntry['message'], { role: 'system' }>) {
  return rawProjection({
    role: value.role,
    content: toJsonValue(value.content),
    ...systemMessageTools(value.toolsAdded ?? []),
  })
}

function userMessageProjection(value: PiUserMessage, displayParts?: readonly MessagePart[]) {
  return {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson(
      displayParts ?? piUserContentToDisplayParts(value.content),
      null,
    ),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function toolResultMessageProjection(value: PiToolResultMessage) {
  return {
    kind: 'tool_result',
    role: null,
    contentJson: buildMessageNodeContentJson([piToolResultContentToPart(value)], null),
    metadataJson: buildRawNodeContentJson({
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      isError: value.isError,
    }),
  } satisfies PiEntryProjection
}

function branchSummaryMessageProjection(value: PiBranchSummaryMessage) {
  return {
    kind: 'branch_summary',
    role: null,
    contentJson: buildRawNodeContentJson({ summary: value.summary, fromId: value.fromId }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function compactionSummaryMessageProjection(value: PiCompactionSummaryMessage) {
  return {
    kind: 'compaction_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: value.summary,
      tokensBefore: value.tokensBefore,
      reason: compactionReason(value),
    }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function bashExecutionMessageProjection(value: PiBashExecutionMessage) {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      role: value.role,
      command: value.command,
      output: value.output,
      exitCode: value.exitCode ?? null,
      cancelled: value.cancelled,
      truncated: value.truncated,
      fullOutputPath: value.fullOutputPath ?? null,
      excludeFromContext: value.excludeFromContext ?? false,
    }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function customMessageRoleProjection(value: PiCustomMessage) {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      role: value.role,
      customType: value.customType,
      content: toJsonValue(value.content),
      display: value.display,
      details: toJsonValue(value.details ?? null),
    }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function messageProjectionForEntry(
  entry: PiMessageEntry,
  userDisplayParts?: readonly MessagePart[],
) {
  return matchBy(entry.message, 'role')
    .with('system', systemMessageProjection)
    .with('user', (message) => userMessageProjection(message, userDisplayParts))
    .with('assistant', assistantMessageProjection)
    .with('toolResult', toolResultMessageProjection)
    .with('branchSummary', branchSummaryMessageProjection)
    .with('compactionSummary', compactionSummaryMessageProjection)
    .with('bashExecution', bashExecutionMessageProjection)
    .with('custom', customMessageRoleProjection)
    .exhaustive()
}

function modelChangeProjection(entry: Extract<SessionEntry, { type: 'model_change' }>) {
  return {
    kind: 'model_change',
    role: null,
    contentJson: buildRawNodeContentJson({
      provider: entry.provider,
      modelId: entry.modelId,
      modelRef: createModelRef(entry.provider, entry.modelId),
    }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function thinkingLevelChangeProjection(
  entry: Extract<SessionEntry, { type: 'thinking_level_change' }>,
) {
  return {
    kind: 'thinking_level_change',
    role: null,
    contentJson: buildRawNodeContentJson({ thinkingLevel: entry.thinkingLevel }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function compactionEntryProjection(entry: Extract<SessionEntry, { type: 'compaction' }>) {
  return {
    kind: 'compaction_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: entry.summary,
      firstKeptEntryId: entry.firstKeptEntryId,
      tokensBefore: entry.tokensBefore,
      fromHook: entry.fromHook ?? false,
      reason: compactionReason(entry),
    }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function branchSummaryEntryProjection(entry: Extract<SessionEntry, { type: 'branch_summary' }>) {
  return {
    kind: 'branch_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: entry.summary,
      fromId: entry.fromId,
      details: toJsonValue(entry.details ?? null),
      fromHook: entry.fromHook ?? false,
    }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function customEntryProjection(entry: Extract<SessionEntry, { type: 'custom' }>) {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      customType: entry.customType,
      data: toJsonValue(entry.data ?? null),
    }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}
function hiddenOrCustomMessageProjection(entry: Extract<SessionEntry, { type: 'custom_message' }>) {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      customType: entry.customType,
      content: toJsonValue(entry.content),
      display: entry.display,
      details: toJsonValue(entry.details ?? null),
    }),
    metadataJson: buildRawNodeContentJson({
      customType: entry.customType,
      display: entry.display,
      details: toJsonValue(entry.details ?? null),
    }),
  } satisfies PiEntryProjection
}

function customMessageProjection(entry: Extract<SessionEntry, { type: 'custom_message' }>) {
  if (entry.customType === PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE && entry.display) {
    return visibleWaggleUserMessageProjection(entry)
  }
  if (isHiveWakeEntry(entry)) return hiveWakeProjection()

  return hiddenOrCustomMessageProjection(entry)
}

function labelEntryProjection(entry: Extract<SessionEntry, { type: 'label' }>) {
  return {
    kind: 'label',
    role: null,
    contentJson: buildRawNodeContentJson({
      targetId: entry.targetId,
      label: entry.label ?? null,
    }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

function stateEntryProjection(entry: Extract<SessionEntry, { type: 'context_edit' | 'usage' }>) {
  return rawProjection({ type: entry.type, entry: toJsonValue(entry) })
}

function sessionInfoEntryProjection(entry: Extract<SessionEntry, { type: 'session_info' }>) {
  return {
    kind: 'session_info',
    role: null,
    contentJson: buildRawNodeContentJson({ name: entry.name ?? null }),
    metadataJson: '{}',
  } satisfies PiEntryProjection
}

export function projectionForPiEntry(
  entry: SessionEntry,
  options: { readonly userDisplayParts?: readonly MessagePart[] } = {},
) {
  return matchBy(entry, 'type')
    .with('message', (message) => messageProjectionForEntry(message, options.userDisplayParts))
    .with('model_change', modelChangeProjection)
    .with('thinking_level_change', thinkingLevelChangeProjection)
    .with('compaction', compactionEntryProjection)
    .with('branch_summary', branchSummaryEntryProjection)
    .with('custom', customEntryProjection)
    .with('custom_message', customMessageProjection)
    .with('context_edit', 'usage', stateEntryProjection)
    .with('label', labelEntryProjection)
    .with('session_info', sessionInfoEntryProjection)
    .exhaustive() satisfies PiEntryProjection
}
