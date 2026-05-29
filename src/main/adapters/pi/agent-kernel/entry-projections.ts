import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import type { MessageRole } from '@shared/types/agent'
import { createModelRef } from '@shared/types/llm'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import { toJsonValue } from '../pi-message-mapper'
import {
  buildMessageNodeContentJson,
  buildRawNodeContentJson,
  piAssistantContentToParts,
  piTextAndImageContentToParts,
  piToolResultContentToPart,
} from './message-parts'

type PiMessageEntry = Extract<SessionEntry, { type: 'message' }>
type PiUserMessage = Extract<PiMessageEntry['message'], { role: 'user' }>
type PiAssistantMessage = Extract<PiMessageEntry['message'], { role: 'assistant' }>
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

function userMessageProjection(value: PiUserMessage): PiEntryProjection {
  return {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson(piTextAndImageContentToParts(value.content), null),
    metadataJson: '{}',
  }
}

function assistantMessageProjection(value: PiAssistantMessage): PiEntryProjection {
  return {
    kind: 'assistant_message',
    role: 'assistant',
    contentJson: buildMessageNodeContentJson(
      piAssistantContentToParts(value.content),
      createModelRef(value.provider, value.model),
    ),
    metadataJson: buildRawNodeContentJson({
      api: value.api,
      provider: value.provider,
      model: value.model,
      usage: toJsonValue(value.usage),
      stopReason: value.stopReason,
      errorMessage: value.errorMessage ?? null,
    }),
  }
}

function toolResultMessageProjection(value: PiToolResultMessage): PiEntryProjection {
  return {
    kind: 'tool_result',
    role: null,
    contentJson: buildMessageNodeContentJson([piToolResultContentToPart(value)], null),
    metadataJson: buildRawNodeContentJson({
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      isError: value.isError,
    }),
  }
}

function branchSummaryMessageProjection(value: PiBranchSummaryMessage): PiEntryProjection {
  return {
    kind: 'branch_summary',
    role: null,
    contentJson: buildRawNodeContentJson({ summary: value.summary, fromId: value.fromId }),
    metadataJson: '{}',
  }
}

function compactionSummaryMessageProjection(value: PiCompactionSummaryMessage): PiEntryProjection {
  return {
    kind: 'compaction_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: value.summary,
      tokensBefore: value.tokensBefore,
    }),
    metadataJson: '{}',
  }
}

function bashExecutionMessageProjection(value: PiBashExecutionMessage): PiEntryProjection {
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
  }
}

function customMessageRoleProjection(value: PiCustomMessage): PiEntryProjection {
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
  }
}

function messageProjectionForEntry(entry: PiMessageEntry): PiEntryProjection {
  return matchBy(entry.message, 'role')
    .with('user', userMessageProjection)
    .with('assistant', assistantMessageProjection)
    .with('toolResult', toolResultMessageProjection)
    .with('branchSummary', branchSummaryMessageProjection)
    .with('compactionSummary', compactionSummaryMessageProjection)
    .with('bashExecution', bashExecutionMessageProjection)
    .with('custom', customMessageRoleProjection)
    .exhaustive()
}

function modelChangeProjection(
  entry: Extract<SessionEntry, { type: 'model_change' }>,
): PiEntryProjection {
  return {
    kind: 'model_change',
    role: null,
    contentJson: buildRawNodeContentJson({
      provider: entry.provider,
      modelId: entry.modelId,
      modelRef: createModelRef(entry.provider, entry.modelId),
    }),
    metadataJson: '{}',
  }
}

function thinkingLevelChangeProjection(
  entry: Extract<SessionEntry, { type: 'thinking_level_change' }>,
): PiEntryProjection {
  return {
    kind: 'thinking_level_change',
    role: null,
    contentJson: buildRawNodeContentJson({ thinkingLevel: entry.thinkingLevel }),
    metadataJson: '{}',
  }
}

function compactionEntryProjection(
  entry: Extract<SessionEntry, { type: 'compaction' }>,
): PiEntryProjection {
  return {
    kind: 'compaction_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: entry.summary,
      firstKeptEntryId: entry.firstKeptEntryId,
      tokensBefore: entry.tokensBefore,
      details: toJsonValue(entry.details ?? null),
      fromHook: entry.fromHook ?? false,
    }),
    metadataJson: '{}',
  }
}

function branchSummaryEntryProjection(
  entry: Extract<SessionEntry, { type: 'branch_summary' }>,
): PiEntryProjection {
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
  }
}

function customEntryProjection(
  entry: Extract<SessionEntry, { type: 'custom' }>,
): PiEntryProjection {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      customType: entry.customType,
      data: toJsonValue(entry.data ?? null),
    }),
    metadataJson: '{}',
  }
}
function visibleWaggleUserMessageProjection(
  entry: Extract<SessionEntry, { type: 'custom_message' }>,
): PiEntryProjection {
  return {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson(piTextAndImageContentToParts(entry.content), null),
    metadataJson: buildRawNodeContentJson({
      customType: entry.customType,
      display: entry.display,
      details: toJsonValue(entry.details ?? null),
    }),
  }
}

function hiddenOrCustomMessageProjection(
  entry: Extract<SessionEntry, { type: 'custom_message' }>,
): PiEntryProjection {
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
  }
}

function customMessageProjection(
  entry: Extract<SessionEntry, { type: 'custom_message' }>,
): PiEntryProjection {
  if (entry.customType === PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE && entry.display) {
    return visibleWaggleUserMessageProjection(entry)
  }

  return hiddenOrCustomMessageProjection(entry)
}

function labelEntryProjection(entry: Extract<SessionEntry, { type: 'label' }>): PiEntryProjection {
  return {
    kind: 'label',
    role: null,
    contentJson: buildRawNodeContentJson({
      targetId: entry.targetId,
      label: entry.label ?? null,
    }),
    metadataJson: '{}',
  }
}

function sessionInfoEntryProjection(
  entry: Extract<SessionEntry, { type: 'session_info' }>,
): PiEntryProjection {
  return {
    kind: 'session_info',
    role: null,
    contentJson: buildRawNodeContentJson({ name: entry.name ?? null }),
    metadataJson: '{}',
  }
}

export function projectionForPiEntry(entry: SessionEntry): PiEntryProjection {
  return matchBy(entry, 'type')
    .with('message', messageProjectionForEntry)
    .with('model_change', modelChangeProjection)
    .with('thinking_level_change', thinkingLevelChangeProjection)
    .with('compaction', compactionEntryProjection)
    .with('branch_summary', branchSummaryEntryProjection)
    .with('custom', customEntryProjection)
    .with('custom_message', customMessageProjection)
    .with('label', labelEntryProjection)
    .with('session_info', sessionInfoEntryProjection)
    .exhaustive()
}
