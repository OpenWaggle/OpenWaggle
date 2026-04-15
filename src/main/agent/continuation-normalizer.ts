import { CONTINUATION } from '@shared/constants/text-processing'
import type {
  DomainContinuationMessage,
  DomainModelContinuationMessage,
  DomainUiContinuationMessage,
  DomainUiToolCallPart,
} from '@shared/types/continuation'
import { convertDomainToModelMessages } from '../adapters/continuation-mapper'
import { createLogger } from '../logger'

export type ContinuationMessage = DomainContinuationMessage
type UiToolCallPart = DomainUiToolCallPart

const logger = createLogger('continuation-normalizer')
const EMPTY_TOOL_ARGS_JSON = '{}'
const TOOL_CALL_SCORE_HAS_STATE = 1
const TOOL_CALL_SCORE_HAS_NON_EMPTY_ARGS = 2
const TOOL_CALL_SCORE_NEEDS_APPROVAL = 4
const TOOL_CALL_SCORE_HAS_APPROVAL_DECISION = 8
const TOOL_CALL_SCORE_APPROVAL_RESPONDED = 16
const TOOL_CALL_SCORE_HAS_OUTPUT = 32

function isUiSnapshotMessage(message: ContinuationMessage): message is DomainUiContinuationMessage {
  return 'parts' in message
}

function hasModelMessageContent(message: DomainModelContinuationMessage): boolean {
  if (message.content === null) {
    return false
  }
  if (typeof message.content === 'string') {
    return message.content.length > 0
  }
  return message.content.length > 0
}

function normalizeToolArgumentsJson(raw: string, toolCallId: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return EMPTY_TOOL_ARGS_JSON
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return JSON.stringify(parsed)
    }

    logger.warn('Tool arguments were not a JSON object; defaulting to {}', {
      toolCallId,
      raw: trimmed.slice(0, CONTINUATION.PARSE_PREVIEW_CHAR_LIMIT),
    })
    return EMPTY_TOOL_ARGS_JSON
  } catch (error) {
    logger.warn('Failed to parse tool arguments JSON; defaulting to {}', {
      toolCallId,
      raw: trimmed.slice(0, CONTINUATION.PARSE_PREVIEW_CHAR_LIMIT),
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY_TOOL_ARGS_JSON
  }
}

function hasNonEmptyObjectArguments(rawArgs: string): boolean {
  try {
    const parsed: unknown = JSON.parse(rawArgs)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false
    }
    return Object.keys(parsed).length > 0
  } catch {
    return false
  }
}

function getUiToolCallScore(part: UiToolCallPart): number {
  let score = 0
  if (part.state !== undefined) {
    score += TOOL_CALL_SCORE_HAS_STATE
  }
  if (hasNonEmptyObjectArguments(part.arguments)) {
    score += TOOL_CALL_SCORE_HAS_NON_EMPTY_ARGS
  }
  if (part.approval?.needsApproval === true) {
    score += TOOL_CALL_SCORE_NEEDS_APPROVAL
  }
  if (part.approval?.approved !== undefined) {
    score += TOOL_CALL_SCORE_HAS_APPROVAL_DECISION
  }
  if (part.state === 'approval-responded') {
    score += TOOL_CALL_SCORE_APPROVAL_RESPONDED
  }
  if (part.output !== undefined) {
    score += TOOL_CALL_SCORE_HAS_OUTPUT
  }
  return score
}

function getModelToolCallScore(
  toolCall: NonNullable<DomainModelContinuationMessage['toolCalls']>[number],
): number {
  return hasNonEmptyObjectArguments(toolCall.function.arguments) ? 1 : 0
}

function sanitizeUiToolCallPart(part: UiToolCallPart): UiToolCallPart {
  return {
    ...part,
    arguments: normalizeToolArgumentsJson(part.arguments, part.id),
    state: part.state ?? 'input-complete',
  }
}

interface ToolCallRecoveryHints {
  readonly bestPartById: ReadonlyMap<string, UiToolCallPart>
  readonly bestArgumentsById: ReadonlyMap<string, string>
}

function buildToolCallRecoveryHints(
  continuationMessages: readonly ContinuationMessage[],
): ToolCallRecoveryHints {
  const bestPartById = new Map<string, UiToolCallPart>()
  const bestPartScoreById = new Map<string, number>()
  const bestArgumentsById = new Map<string, string>()

  for (const message of continuationMessages) {
    if (isUiSnapshotMessage(message)) {
      if (message.role !== 'assistant') {
        continue
      }
      for (const part of message.parts) {
        if (part.type !== 'tool-call') {
          continue
        }
        const sanitized = sanitizeUiToolCallPart(part)
        if (hasNonEmptyObjectArguments(sanitized.arguments)) {
          bestArgumentsById.set(sanitized.id, sanitized.arguments)
        }
        const nextScore = getUiToolCallScore(sanitized)
        const existingScore = bestPartScoreById.get(sanitized.id) ?? -1
        if (nextScore > existingScore) {
          bestPartById.set(sanitized.id, sanitized)
          bestPartScoreById.set(sanitized.id, nextScore)
        }
      }
      continue
    }

    if (message.role !== 'assistant' || !message.toolCalls) {
      continue
    }

    for (const toolCall of message.toolCalls) {
      const normalizedArgs = normalizeToolArgumentsJson(toolCall.function.arguments, toolCall.id)
      if (hasNonEmptyObjectArguments(normalizedArgs)) {
        bestArgumentsById.set(toolCall.id, normalizedArgs)
      }
    }
  }

  return {
    bestPartById,
    bestArgumentsById,
  }
}

function recoverUiToolCallPart(part: UiToolCallPart, hints: ToolCallRecoveryHints): UiToolCallPart {
  const bestPart = hints.bestPartById.get(part.id)
  const recoveredArguments = hasNonEmptyObjectArguments(part.arguments)
    ? part.arguments
    : (hints.bestArgumentsById.get(part.id) ?? part.arguments)

  return {
    ...part,
    name: bestPart?.name ?? part.name,
    arguments: recoveredArguments,
    approval: part.approval ?? bestPart?.approval,
    output: part.output ?? bestPart?.output,
    state: part.state ?? bestPart?.state ?? 'input-complete',
  }
}

const SYNTHETIC_TOOL_RESULT_CONTENT = JSON.stringify({
  ok: false,
  error: 'Tool execution was interrupted.',
})

function enforceToolResultPairing(
  messages: readonly DomainModelContinuationMessage[],
): DomainModelContinuationMessage[] {
  const pairedMessages: DomainModelContinuationMessage[] = []
  let pendingAssistantToolCallIds: Set<string> | null = null

  for (const message of messages) {
    if (message.role === 'assistant') {
      pendingAssistantToolCallIds = new Set(message.toolCalls?.map((toolCall) => toolCall.id) ?? [])
      pairedMessages.push(message)
      continue
    }

    if (message.role === 'tool') {
      if (!message.toolCallId) {
        logger.warn('Dropping tool result without toolCallId from continuation history')
        continue
      }

      if (!pendingAssistantToolCallIds?.has(message.toolCallId)) {
        logger.warn('Dropping orphan tool result from continuation history', {
          toolCallId: message.toolCallId,
        })
        continue
      }

      pendingAssistantToolCallIds.delete(message.toolCallId)
      pairedMessages.push(message)
      continue
    }

    // Non-tool message after assistant — inject synthetic results for any
    // tool calls that were never followed by a tool result message.
    if (pendingAssistantToolCallIds && pendingAssistantToolCallIds.size > 0) {
      for (const orphanId of pendingAssistantToolCallIds) {
        logger.warn('Injecting synthetic tool result for orphan tool call in ModelMessage path', {
          toolCallId: orphanId,
        })
        pairedMessages.push({
          role: 'tool',
          content: SYNTHETIC_TOOL_RESULT_CONTENT,
          toolCallId: orphanId,
        })
      }
    }

    pendingAssistantToolCallIds = null
    pairedMessages.push(message)
  }

  // Handle orphan tool calls at the end of the message list
  if (pendingAssistantToolCallIds && pendingAssistantToolCallIds.size > 0) {
    for (const orphanId of pendingAssistantToolCallIds) {
      logger.warn(
        'Injecting synthetic tool result for orphan tool call at end of ModelMessage history',
        {
          toolCallId: orphanId,
        },
      )
      pairedMessages.push({
        role: 'tool',
        content: SYNTHETIC_TOOL_RESULT_CONTENT,
        toolCallId: orphanId,
      })
    }
  }

  return pairedMessages
}

export function normalizeContinuationInput(
  continuationMessages: readonly ContinuationMessage[],
): DomainModelContinuationMessage[] {
  const normalized = deduplicateContinuationMessages(continuationMessages)
  const convertedMessages = convertDomainToModelMessages(normalized)
  return enforceToolResultPairing(convertedMessages)
}

/**
 * Core deduplication/recovery logic shared by both normalization variants.
 * Returns deduplicated ContinuationMessages preserving their original format
 * (UIMessage parts stay intact).
 */
function deduplicateContinuationMessages(
  continuationMessages: readonly ContinuationMessage[],
): ContinuationMessage[] {
  const recoveryHints = buildToolCallRecoveryHints(continuationMessages)
  const normalizedReversed: ContinuationMessage[] = []
  const seenToolCallIds = new Set<string>()
  const seenToolResultIds = new Set<string>()

  for (let messageIndex = continuationMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = continuationMessages[messageIndex]
    if (!message) {
      continue
    }

    if (isUiSnapshotMessage(message)) {
      if (message.role === 'system') {
        continue
      }

      if (message.role === 'user') {
        normalizedReversed.push(message)
        continue
      }

      if (message.role !== 'assistant') {
        continue
      }

      const dedupedPartsReversed: Array<DomainUiContinuationMessage['parts'][number]> = []
      const dedupedToolCallIndexById = new Map<string, number>()
      const dedupedToolCallScoreById = new Map<string, number>()

      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = message.parts[partIndex]
        if (!part) {
          continue
        }
        if (part.type === 'tool-call') {
          const sanitizedPart = recoverUiToolCallPart(sanitizeUiToolCallPart(part), recoveryHints)
          const existingIndex = dedupedToolCallIndexById.get(sanitizedPart.id)
          if (existingIndex !== undefined) {
            const existingScore = dedupedToolCallScoreById.get(sanitizedPart.id) ?? 0
            const nextScore = getUiToolCallScore(sanitizedPart)
            if (nextScore > existingScore) {
              dedupedPartsReversed[existingIndex] = sanitizedPart
              dedupedToolCallScoreById.set(sanitizedPart.id, nextScore)
            }
            continue
          }
          if (seenToolCallIds.has(sanitizedPart.id)) {
            continue
          }
          seenToolCallIds.add(sanitizedPart.id)
          dedupedToolCallIndexById.set(sanitizedPart.id, dedupedPartsReversed.length)
          dedupedToolCallScoreById.set(sanitizedPart.id, getUiToolCallScore(sanitizedPart))
          dedupedPartsReversed.push(sanitizedPart)
          continue
        }
        if (part.type === 'tool-result') {
          if (seenToolCallIds.has(part.toolCallId)) {
            continue
          }
          if (seenToolResultIds.has(part.toolCallId)) {
            continue
          }
          seenToolResultIds.add(part.toolCallId)
          dedupedPartsReversed.push(part)
          continue
        }
        dedupedPartsReversed.push(part)
      }

      if (dedupedPartsReversed.length === 0) {
        continue
      }

      normalizedReversed.push({
        ...message,
        role: 'assistant',
        parts: dedupedPartsReversed.reverse(),
      })
      continue
    }

    if (message.role === 'tool' && message.toolCallId) {
      if (seenToolCallIds.has(message.toolCallId)) {
        continue
      }
      if (seenToolResultIds.has(message.toolCallId)) {
        continue
      }
      seenToolResultIds.add(message.toolCallId)
      normalizedReversed.push(message)
      continue
    }

    if (message.role !== 'assistant' || !message.toolCalls || message.toolCalls.length === 0) {
      normalizedReversed.push(message)
      continue
    }

    const dedupedToolCallsReversed: Array<
      NonNullable<DomainModelContinuationMessage['toolCalls']>[number]
    > = []
    const dedupedToolCallIndexById = new Map<string, number>()
    const dedupedToolCallScoreById = new Map<string, number>()

    for (let toolCallIndex = message.toolCalls.length - 1; toolCallIndex >= 0; toolCallIndex -= 1) {
      const toolCall = message.toolCalls[toolCallIndex]
      if (!toolCall) {
        continue
      }
      const sanitizedToolCall = {
        ...toolCall,
        function: {
          ...toolCall.function,
          arguments: (() => {
            const normalizedArguments = normalizeToolArgumentsJson(
              toolCall.function.arguments,
              toolCall.id,
            )
            if (hasNonEmptyObjectArguments(normalizedArguments)) {
              return normalizedArguments
            }
            return recoveryHints.bestArgumentsById.get(toolCall.id) ?? normalizedArguments
          })(),
        },
      }
      const existingIndex = dedupedToolCallIndexById.get(sanitizedToolCall.id)
      if (existingIndex !== undefined) {
        const existingScore = dedupedToolCallScoreById.get(sanitizedToolCall.id) ?? 0
        const nextScore = getModelToolCallScore(sanitizedToolCall)
        if (nextScore > existingScore) {
          dedupedToolCallsReversed[existingIndex] = sanitizedToolCall
          dedupedToolCallScoreById.set(sanitizedToolCall.id, nextScore)
        }
        continue
      }
      if (seenToolCallIds.has(sanitizedToolCall.id)) {
        continue
      }
      seenToolCallIds.add(sanitizedToolCall.id)
      dedupedToolCallIndexById.set(sanitizedToolCall.id, dedupedToolCallsReversed.length)
      dedupedToolCallScoreById.set(sanitizedToolCall.id, getModelToolCallScore(sanitizedToolCall))
      dedupedToolCallsReversed.push(sanitizedToolCall)
    }

    const dedupedToolCalls = dedupedToolCallsReversed.reverse()

    if (dedupedToolCalls.length === 0 && !hasModelMessageContent(message)) {
      continue
    }

    if (dedupedToolCalls.length > 0) {
      normalizedReversed.push({ ...message, toolCalls: dedupedToolCalls })
      continue
    }

    const { toolCalls: _toolCalls, ...messageWithoutToolCalls } = message
    normalizedReversed.push(messageWithoutToolCalls)
  }

  return normalizedReversed.reverse()
}

/**
 * Like normalizeContinuationInput but preserves UIMessage format (with `parts`)
 * instead of converting to ModelMessages. This allows the TanStack AI TextEngine
 * to extract approval state via extractClientStateFromOriginalMessages().
 *
 * After deduplication, consecutive assistant UIMessages are merged into one.
 * This prevents buildAssistantMessages from producing multiple assistant
 * ModelMessages, which would cause consecutive-assistant API messages and
 * orphan tool_result blocks after the Anthropic adapter's merge step.
 *
 * The TextEngine constructor calls convertMessagesToModelMessages() internally,
 * so the conversion still happens — just after approval extraction.
 */
export function normalizeContinuationAsUIMessages(
  continuationMessages: readonly ContinuationMessage[],
): ContinuationMessage[] {
  const deduped = deduplicateContinuationMessages(continuationMessages)
  const merged = mergeConsecutiveAssistantUIMessages(deduped)
  const enforced = enforceToolResultPairingOnUIMessages(merged)
  return ensureToolResultAdjacency(enforced)
}

/**
 * Matches TanStack AI's isToolCallIncluded predicate — a tool-call part
 * is "included" (emitted as a tool_use block) when its state signals
 * that the call has been dispatched or it carries concrete output.
 */
function isToolCallIncluded(part: UiToolCallPart): boolean {
  return (
    part.state === 'input-complete' ||
    part.state === 'approval-responded' ||
    part.output !== undefined
  )
}

/**
 * For UIMessage continuations, ensure every included tool-call part has a
 * matching tool-result part in the same assistant message. If not (and the
 * tool-call has no `output`), inject a synthetic tool-result so that
 * TanStack AI's buildAssistantMessages produces a paired tool_use → tool
 * result sequence that the Anthropic API accepts.
 */
function enforceToolResultPairingOnUIMessages(
  messages: ContinuationMessage[],
): ContinuationMessage[] {
  return messages.map((message) => {
    if (!isUiSnapshotMessage(message) || message.role !== 'assistant') {
      return message
    }

    const toolResultIds = new Set<string>()
    for (const part of message.parts) {
      if (part.type === 'tool-result') {
        toolResultIds.add(part.toolCallId)
      }
    }

    const orphanToolCallIds: Array<{ id: string; name: string }> = []
    for (const part of message.parts) {
      if (part.type !== 'tool-call') {
        continue
      }
      if (!isToolCallIncluded(part)) {
        continue
      }
      // Tool calls with output are handled by TanStack AI's post-segment
      // emission — they don't need an explicit tool-result part.
      if (part.output !== undefined) {
        continue
      }
      // Tool calls with approval-responded state have already been handled by
      // the user (approved or denied). They must not get synthetic error results
      // because:
      // - If approved: the continuation run will execute them
      // - If denied: the denial is already recorded
      // Without this guard, these tool calls get a fake "Tool execution was
      // interrupted" error that causes Anthropic API 400 errors (unpaired
      // tool_use blocks).
      if (part.state === 'approval-responded') {
        continue
      }
      // Also skip if approval metadata indicates user has responded
      if (part.approval?.approved !== undefined) {
        continue
      }
      if (!toolResultIds.has(part.id)) {
        orphanToolCallIds.push({ id: part.id, name: part.name })
      }
    }

    if (orphanToolCallIds.length === 0) {
      return message
    }

    const syntheticParts: Array<DomainUiContinuationMessage['parts'][number]> =
      orphanToolCallIds.map(({ id, name }) => {
        logger.warn('Injecting synthetic tool-result for orphan tool-call in UIMessage', {
          toolCallId: id,
          toolName: name,
        })
        return {
          type: 'tool-result' as const,
          toolCallId: id,
          content: SYNTHETIC_TOOL_RESULT_CONTENT,
          state: 'error' as const,
        }
      })

    return {
      ...message,
      parts: [...message.parts, ...syntheticParts],
    }
  })
}

/**
 * Merge consecutive assistant UIMessages into a single UIMessage by concatenating
 * their parts arrays. This ensures buildAssistantMessages (inside TanStack AI's
 * convertMessagesToModelMessages) produces one coherent assistant → tool sequence
 * instead of multiple assistant ModelMessages that would violate the Anthropic
 * API's alternating-role requirement.
 */
function mergeConsecutiveAssistantUIMessages(
  messages: ContinuationMessage[],
): ContinuationMessage[] {
  const result: ContinuationMessage[] = []

  for (const message of messages) {
    const prev = result[result.length - 1]

    if (
      prev &&
      isUiSnapshotMessage(prev) &&
      prev.role === 'assistant' &&
      isUiSnapshotMessage(message) &&
      message.role === 'assistant'
    ) {
      // Merge parts into the previous assistant UIMessage
      result[result.length - 1] = {
        ...prev,
        parts: [...prev.parts, ...message.parts],
      }
    } else {
      result.push(message)
    }
  }

  return result
}

/**
 * Ensure every included tool-call part has an adjacent tool-result part
 * immediately after it. This prevents TanStack AI's `buildAssistantMessages`
 * from producing unpaired `tool_use` blocks.
 *
 * `buildAssistantMessages` has two phases:
 * - Phase 1: walks parts in order, flushes segments on tool-result parts
 * - Phase 2: appends tool results from tool-call output at the END
 *
 * Phase 2 appending breaks multi-segment conversations because tool results
 * end up after LATER assistant segments, not immediately after their tool_use.
 *
 * This function:
 * 1. Moves existing tool-result parts to be adjacent to their tool-call
 * 2. Injects synthetic tool-result parts for tool-calls that have output
 *    but no matching tool-result (so Phase 1 handles them, not Phase 2)
 */
function ensureToolResultAdjacency(messages: ContinuationMessage[]): ContinuationMessage[] {
  return messages.map((message) => {
    if (!isUiSnapshotMessage(message) || message.role !== 'assistant') {
      return message
    }

    // Collect existing tool-result parts indexed by toolCallId
    const toolResultsByCallId = new Map<string, DomainUiContinuationMessage['parts'][number]>()
    for (const part of message.parts) {
      if (part.type === 'tool-result') {
        toolResultsByCallId.set(part.toolCallId, part)
      }
    }

    // Rebuild parts: place or inject a tool-result immediately after each
    // included tool-call
    const reordered: Array<DomainUiContinuationMessage['parts'][number]> = []
    const emittedResultIds = new Set<string>()

    for (const part of message.parts) {
      if (part.type === 'tool-result') {
        // Skip — will be placed (or was already placed) after its tool-call
        if (emittedResultIds.has(part.toolCallId)) {
          continue
        }
        // Orphan tool-result with no matching tool-call — keep in place
        reordered.push(part)
        emittedResultIds.add(part.toolCallId)
        continue
      }

      reordered.push(part)

      if (part.type === 'tool-call' && isToolCallIncluded(part) && !emittedResultIds.has(part.id)) {
        const existingResult = toolResultsByCallId.get(part.id)
        if (existingResult) {
          // Move existing tool-result to be adjacent
          reordered.push(existingResult)
        }

        if (!existingResult && part.output !== undefined) {
          // Inject synthetic tool-result from the tool-call's output so that
          // Phase 1 handles the pairing instead of Phase 2 (which appends
          // at the end and breaks multi-segment conversations).
          reordered.push({
            type: 'tool-result' as const,
            toolCallId: part.id,
            content: typeof part.output === 'string' ? part.output : JSON.stringify(part.output),
            state: 'complete' as const,
          })
        }

        if (!existingResult && part.output === undefined && part.state === 'approval-responded') {
          // Approval-responded tool calls without output need a synthetic
          // result with approval metadata. TanStack Phase 2 would emit this
          // at the END, breaking multi-segment conversations.
          const approvalContent = JSON.stringify({
            approved: part.approval?.approved ?? true,
            pendingExecution: true,
          })
          reordered.push({
            type: 'tool-result' as const,
            toolCallId: part.id,
            content: approvalContent,
            state: 'complete' as const,
          })
        }
        emittedResultIds.add(part.id)
      }
    }

    return { ...message, parts: reordered }
  })
}
