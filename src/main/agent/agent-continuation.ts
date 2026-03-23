import { jsonObjectSchema } from '@shared/schemas/validation'
import type { Message, MessagePart } from '@shared/types/agent'
import type { JsonObject } from '@shared/types/json'
import { parseJsonSafe } from '@shared/utils/parse-json'
import {
  isDeniedApprovalPayload,
  normalizeToolResultPayload,
} from '@shared/utils/tool-result-state'
import { isRecord } from '@shared/utils/validation'
import type { UIMessage } from '@tanstack/ai'
import type { ContinuationMessage } from './continuation-normalizer'

export interface DeniedApprovalSnapshot {
  readonly toolCallId: string
  readonly toolName: string
  readonly args: string
  readonly message: string
}

export type UiToolCallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>

export function isUiContinuationMessage(message: ContinuationMessage): message is UIMessage {
  return 'parts' in message
}

export function parseToolArgumentsObject(args: string): {
  readonly parsed: JsonObject
  readonly valid: boolean
} {
  const result = parseJsonSafe(args, jsonObjectSchema)
  if (result.success) {
    return { parsed: result.data, valid: true }
  }

  return { parsed: {}, valid: false }
}

export function hasNonEmptyToolArgs(args: Readonly<JsonObject>): boolean {
  return Object.keys(args).length > 0
}

export function buildPersistedToolArgsMap(
  serverMessages: readonly Message[],
): Map<string, Readonly<JsonObject>> {
  const persistedToolArgs = new Map<string, Readonly<JsonObject>>()

  for (const message of serverMessages) {
    if (message.role !== 'assistant') {
      continue
    }

    for (const part of message.parts) {
      if (part.type === 'tool-call' && hasNonEmptyToolArgs(part.toolCall.args)) {
        persistedToolArgs.set(String(part.toolCall.id), part.toolCall.args)
        continue
      }

      if (part.type === 'tool-result' && hasNonEmptyToolArgs(part.toolResult.args)) {
        persistedToolArgs.set(String(part.toolResult.id), part.toolResult.args)
      }
    }
  }

  return persistedToolArgs
}

export function restoreContinuationToolArgs(
  finalParts: readonly MessagePart[],
  serverMessages: readonly Message[],
): MessagePart[] {
  const persistedToolArgs = buildPersistedToolArgsMap(serverMessages)
  let didChange = false

  const restoredParts = finalParts.map((part) => {
    if (part.type === 'tool-call') {
      if (hasNonEmptyToolArgs(part.toolCall.args)) {
        return part
      }

      const restoredArgs = persistedToolArgs.get(String(part.toolCall.id))
      if (!restoredArgs) {
        return part
      }

      didChange = true
      return {
        ...part,
        toolCall: {
          ...part.toolCall,
          args: restoredArgs,
        },
      }
    }

    if (part.type === 'tool-result') {
      if (hasNonEmptyToolArgs(part.toolResult.args)) {
        return part
      }

      const restoredArgs = persistedToolArgs.get(String(part.toolResult.id))
      if (!restoredArgs) {
        return part
      }

      didChange = true
      return {
        ...part,
        toolResult: {
          ...part.toolResult,
          args: restoredArgs,
        },
      }
    }

    return part
  })

  return didChange ? restoredParts : [...finalParts]
}

export function describeContinuationMessageFormat(
  continuationMessages: readonly ContinuationMessage[],
): 'ui' | 'model' | 'mixed' | 'none' {
  if (continuationMessages.length === 0) {
    return 'none'
  }

  let sawUiMessage = false
  let sawModelMessage = false

  for (const message of continuationMessages) {
    if ('parts' in message) {
      sawUiMessage = true
    } else {
      sawModelMessage = true
    }
  }

  if (sawUiMessage && sawModelMessage) {
    return 'mixed'
  }

  return sawUiMessage ? 'ui' : 'model'
}

export function extractDeniedApprovalSnapshot(
  continuationMessages: readonly ContinuationMessage[],
): DeniedApprovalSnapshot | null {
  const completedToolCallIds = new Set<string>()

  for (const message of continuationMessages) {
    if (!isUiContinuationMessage(message)) {
      continue
    }

    for (const part of message.parts) {
      if (part.type === 'tool-result') {
        completedToolCallIds.add(part.toolCallId)
      }
    }
  }

  for (let messageIndex = continuationMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = continuationMessages[messageIndex]
    if (!message || !isUiContinuationMessage(message) || message.role !== 'assistant') {
      continue
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!part || part.type !== 'tool-call') {
        continue
      }

      if (completedToolCallIds.has(part.id)) {
        continue
      }

      const deniedPayload = normalizeToolResultPayload(part.output)
      const deniedByOutput = isDeniedApprovalPayload(deniedPayload)
      const deniedByApproval = part.approval?.approved === false

      if (!deniedByOutput && !deniedByApproval) {
        continue
      }

      const messageText =
        deniedByOutput && isRecord(deniedPayload)
          ? (() => {
              const candidateMessage = deniedPayload.message
              return typeof candidateMessage === 'string'
                ? candidateMessage
                : 'User declined tool execution'
            })()
          : 'User declined tool execution'

      return {
        toolCallId: part.id,
        toolName: part.name,
        args: part.arguments,
        message: messageText,
      }
    }
  }

  return null
}

export function parseToolOutput(result: string): unknown {
  try {
    return JSON.parse(result)
  } catch {
    return result
  }
}

export function patchUiToolCallPart(
  part: UiToolCallPart,
  updates: {
    readonly arguments?: string
    readonly output?: unknown
  },
): UiToolCallPart {
  const nextArguments = updates.arguments ?? part.arguments
  const hasOutput = Object.hasOwn(updates, 'output')

  return {
    ...part,
    arguments: nextArguments,
    ...(hasOutput ? { output: updates.output } : {}),
  }
}

/**
 * Enrich normalized continuation UIMessages with args/output from the server's
 * persisted conversation history, and inject synthetic output for approved-but-
 * never-executed tools in non-last assistant messages.
 */
export function enrichContinuationMessages(
  normalized: readonly ContinuationMessage[],
  serverMessages: readonly Message[],
): ContinuationMessage[] {
  // Build lookup maps from server-side persisted messages
  const toolArgsMap = new Map<string, string>()
  const toolResultMap = new Map<string, string>()
  for (const msg of serverMessages) {
    if (msg.role === 'assistant') {
      for (const part of msg.parts) {
        if (part.type === 'tool-call') {
          const argsStr = JSON.stringify(part.toolCall.args)
          // Only store non-empty args — later messages from re-executions
          // may have empty args (no TOOL_CALL_ARGS chunks for continuation
          // tool re-runs), and we don't want them overwriting correct args.
          if (Object.keys(part.toolCall.args).length > 0) {
            toolArgsMap.set(String(part.toolCall.id), argsStr)
          }
        }
        if (part.type === 'tool-result') {
          toolResultMap.set(String(part.toolResult.id), part.toolResult.result)
        }
      }
    }
  }

  // Find the last assistant message index for synthetic output logic
  let lastAssistantIdx = -1
  for (let mi = normalized.length - 1; mi >= 0; mi--) {
    const m = normalized[mi]
    if (!m) {
      continue
    }
    if (m.role === 'assistant') {
      lastAssistantIdx = mi
      break
    }
  }

  return normalized.map((message, messageIndex) => {
    if (!isUiContinuationMessage(message) || message.role !== 'assistant') {
      return message
    }

    const parts = message.parts.map((part) => {
      if (part.type !== 'tool-call') {
        return part
      }

      const patchedArguments = toolArgsMap.get(part.id)
      const persistedResult = toolResultMap.get(part.id)
      const restoredOutput =
        part.output !== undefined
          ? part.output
          : persistedResult !== undefined
            ? parseToolOutput(persistedResult)
            : undefined
      const shouldSynthesizeSkippedOutput =
        messageIndex !== lastAssistantIdx &&
        restoredOutput === undefined &&
        part.approval?.approved === true

      return patchUiToolCallPart(part, {
        ...(patchedArguments !== undefined ? { arguments: patchedArguments } : {}),
        ...(restoredOutput !== undefined
          ? { output: restoredOutput }
          : shouldSynthesizeSkippedOutput
            ? { output: 'Tool execution was skipped because a new message was sent.' }
            : {}),
      })
    })

    return {
      ...message,
      parts,
    }
  })
}
