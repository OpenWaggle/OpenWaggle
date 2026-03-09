import { jsonObjectSchema } from '@shared/schemas/validation'
import type { Conversation } from '@shared/types/conversation'
import type { JsonObject } from '@shared/types/json'
import type { ToolCallRequest } from '@shared/types/tools'
import type { UIMessage } from '@tanstack/ai-react'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('persisted-tool-call-reconciliation')

export type UIToolCallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>

export interface PersistedToolCallLookup {
  readonly byId: ReadonlyMap<string, ToolCallRequest>
  readonly bySignature: ReadonlyMap<string, ToolCallRequest>
  readonly all: readonly ToolCallRequest[]
}

function getToolCallSignature(name: string, argumentsJson: string): string {
  return `${name}::${argumentsJson}`
}

function looksLikeCompleteJsonObject(argumentsJson: string): boolean {
  const trimmed = argumentsJson.trim()
  return trimmed.startsWith('{') && trimmed.endsWith('}')
}

function parseArgumentsString(argumentsJson: string): JsonObject | null {
  if (!looksLikeCompleteJsonObject(argumentsJson)) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    const result = jsonObjectSchema.safeParse(parsed)
    if (result.success) {
      return result.data
    }
    logger.warn('Failed to validate persisted tool-call arguments', {
      issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    })
  } catch (error) {
    logger.warn('Failed to parse persisted tool-call arguments', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return null
}

function matchesStableToolArguments(
  uiArgs: JsonObject | null,
  persistedArgs: Readonly<JsonObject>,
): boolean {
  if (uiArgs === null) {
    return false
  }

  if (
    typeof uiArgs.path === 'string' &&
    typeof persistedArgs.path === 'string' &&
    uiArgs.path === persistedArgs.path
  ) {
    return true
  }

  if (
    typeof uiArgs.command === 'string' &&
    typeof persistedArgs.command === 'string' &&
    uiArgs.command === persistedArgs.command
  ) {
    return true
  }

  return false
}

function chooseToolCallState(
  uiState: UIToolCallPart['state'],
  persistedState: ToolCallRequest['state'],
): UIToolCallPart['state'] {
  if (!persistedState) {
    return uiState
  }
  if (!uiState) {
    return persistedState
  }
  if (uiState === 'input-complete' && persistedState !== 'input-complete') {
    return persistedState
  }
  return uiState
}

function chooseToolCallApproval(
  uiApproval: UIToolCallPart['approval'],
  persistedApproval: ToolCallRequest['approval'],
): UIToolCallPart['approval'] {
  if (!persistedApproval) {
    return uiApproval
  }
  if (!uiApproval) {
    return persistedApproval
  }

  const nextId = uiApproval.id || persistedApproval.id
  const nextNeedsApproval =
    uiApproval.needsApproval === true || persistedApproval.needsApproval === true
  const nextApproved = uiApproval.approved ?? persistedApproval.approved
  if (
    nextId === uiApproval.id &&
    nextNeedsApproval === uiApproval.needsApproval &&
    nextApproved === uiApproval.approved
  ) {
    return uiApproval
  }

  return {
    id: nextId,
    needsApproval: nextNeedsApproval,
    approved: nextApproved,
  }
}

export function buildPersistedToolCallLookup(
  conversation: Conversation | null | undefined,
): PersistedToolCallLookup {
  const toolCallsById = new Map<string, ToolCallRequest>()
  const toolCallsBySignature = new Map<string, ToolCallRequest>()
  const allToolCalls: ToolCallRequest[] = []
  if (!conversation) {
    return { byId: toolCallsById, bySignature: toolCallsBySignature, all: allToolCalls }
  }

  for (const message of conversation.messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool-call') {
        continue
      }

      toolCallsById.set(String(part.toolCall.id), part.toolCall)
      toolCallsBySignature.set(
        getToolCallSignature(part.toolCall.name, JSON.stringify(part.toolCall.args)),
        part.toolCall,
      )
      allToolCalls.push(part.toolCall)
    }
  }

  return { byId: toolCallsById, bySignature: toolCallsBySignature, all: allToolCalls }
}

export function findPersistedToolCall(
  part: UIToolCallPart,
  persistedToolCalls: PersistedToolCallLookup,
): ToolCallRequest | undefined {
  const byIdMatch = persistedToolCalls.byId.get(part.id)
  if (byIdMatch) {
    return byIdMatch
  }

  const bySignatureMatch = persistedToolCalls.bySignature.get(
    getToolCallSignature(part.name, part.arguments),
  )
  if (bySignatureMatch) {
    return bySignatureMatch
  }

  const parsedArguments = parseArgumentsString(part.arguments)
  for (const persistedToolCall of persistedToolCalls.all) {
    if (persistedToolCall.name !== part.name) {
      continue
    }
    if (matchesStableToolArguments(parsedArguments, persistedToolCall.args)) {
      return persistedToolCall
    }
  }

  return undefined
}

export function restorePersistedToolCallPart(
  part: UIToolCallPart,
  persistedToolCalls: PersistedToolCallLookup,
): UIToolCallPart {
  const persistedToolCall = findPersistedToolCall(part, persistedToolCalls)
  if (!persistedToolCall) {
    return part
  }

  const nextState = chooseToolCallState(part.state, persistedToolCall.state)
  const nextApproval = chooseToolCallApproval(part.approval, persistedToolCall.approval)
  if (nextState === part.state && nextApproval === part.approval) {
    return part
  }

  return {
    ...part,
    state: nextState,
    approval: nextApproval,
  }
}
