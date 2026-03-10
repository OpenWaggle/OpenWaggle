import { safeDecodeUnknown } from '@shared/schema'
import type { Conversation } from '@shared/types/conversation'
import type { UserQuestion } from '@shared/types/question'
import { askUserArgsSchema } from '@shared/types/question'
import { isTrustableToolName } from '@shared/types/tool-approval'
import {
  hasConcreteToolOutput,
  isDeniedApprovalPayload,
  isIncompleteToolPayload,
} from '@shared/utils/tool-result-state'
import type { UIMessage } from '@tanstack/ai-react'
import { createRendererLogger } from '@/lib/logger'
import {
  buildPersistedToolCallLookup,
  restorePersistedToolCallPart,
} from '@/lib/persisted-tool-call-reconciliation'

const logger = createRendererLogger('pending-tool-interactions')

export interface PendingApproval {
  readonly toolName: string
  readonly toolArgs: string
  readonly approvalId: string
  readonly toolCallId: string
  readonly hasApprovalMetadata: boolean
}

export interface PendingAskUser {
  readonly questions: UserQuestion[]
}

function parseAskUserQuestions(args: string): UserQuestion[] {
  try {
    const parsed: unknown = JSON.parse(args)
    const result = safeDecodeUnknown(askUserArgsSchema, parsed)
    if (result.success) {
      return [...result.data.questions]
    }
    logger.warn('Failed to validate askUser questions', {
      issues: result.issues,
    })
  } catch (error) {
    logger.warn('Failed to parse askUser tool arguments', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return []
}

function hasCompleteToolArguments(args: string): boolean {
  const trimmed = args.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false
  }

  try {
    const parsed: unknown = JSON.parse(args)
    return typeof parsed === 'object' && parsed !== null
  } catch (error) {
    logger.warn('Failed to parse tool arguments while checking approval completeness', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

function getToolResultPayload(
  part: Extract<UIMessage['parts'][number], { type: 'tool-result' }>,
): unknown {
  if ('output' in part) {
    return part.output
  }
  if ('content' in part) {
    return part.content
  }
  return undefined
}

function isCompletedToolResult(
  part: Extract<UIMessage['parts'][number], { type: 'tool-result' }>,
): boolean {
  return !isIncompleteToolPayload(getToolResultPayload(part))
}

function findPendingApprovalFromPersistedConversation(
  conversation: Conversation | null | undefined,
): PendingApproval | null {
  if (!conversation) {
    return null
  }

  const completedToolCallIds = new Set<string>()
  for (const message of conversation.messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-result' && !isIncompleteToolPayload(part.toolResult.result)) {
        completedToolCallIds.add(String(part.toolResult.id))
      }
    }
  }

  for (let messageIndex = conversation.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = conversation.messages[messageIndex]
    if (!message) {
      continue
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!part || part.type !== 'tool-call') {
        continue
      }

      const hasApprovalMetadata = part.toolCall.approval?.needsApproval === true
      if (!hasApprovalMetadata || completedToolCallIds.has(String(part.toolCall.id))) {
        continue
      }

      if (part.toolCall.approval?.approved === false) {
        continue
      }

      if (part.toolCall.state === 'approval-responded') {
        continue
      }

      return {
        toolName: part.toolCall.name,
        toolArgs: JSON.stringify(part.toolCall.args),
        approvalId: part.toolCall.approval?.id ?? `approval_${String(part.toolCall.id)}`,
        toolCallId: String(part.toolCall.id),
        hasApprovalMetadata: true,
      }
    }
  }

  return null
}

export function findPendingApproval(
  messages: UIMessage[],
  persistedConversation?: Conversation | null,
): PendingApproval | null {
  const persistedToolCalls = buildPersistedToolCallLookup(persistedConversation)
  const completedToolCallIds = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-result' && isCompletedToolResult(part)) {
        completedToolCallIds.add(part.toolCallId)
      }
    }
  }

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message) {
      continue
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!part) {
        continue
      }
      if (part.type === 'tool-call') {
        const restoredPart = restorePersistedToolCallPart(part, persistedToolCalls)
        const approval = restoredPart.approval
        const state = restoredPart.state
        const hasApprovalMetadata = approval?.needsApproval === true
        const hasCompletedResult = completedToolCallIds.has(part.id)
        const deniedApproval = approval?.approved === false || isDeniedApprovalPayload(part.output)
        // A tool has been responded to (approved) but is waiting for the
        // continuation to execute it. Don't show the approval banner for it —
        // the user already made their decision. The continuation will trigger
        // once ALL approval-needed tools in the batch are responded to.
        const approvedAndPendingExecution =
          state === 'approval-responded' && approval?.approved === true
        const unresolvedApprovalState =
          hasApprovalMetadata &&
          !deniedApproval &&
          !approvedAndPendingExecution &&
          !hasCompletedResult
        const trustableCallWithoutApprovalMetadata =
          !hasApprovalMetadata && isTrustableToolName(part.name)
        const unresolvedTrustableFallback =
          trustableCallWithoutApprovalMetadata &&
          !hasCompletedResult &&
          !hasConcreteToolOutput(part.output) &&
          state !== 'input-streaming' &&
          hasCompleteToolArguments(part.arguments)

        if (!unresolvedApprovalState && !unresolvedTrustableFallback) {
          continue
        }

        return {
          toolName: part.name,
          toolArgs: restoredPart.arguments,
          approvalId: approval?.id ?? `approval_${part.id}`,
          toolCallId: part.id,
          hasApprovalMetadata,
        }
      }
    }
  }

  // Only fall back to the persisted conversation when UIMessages don't contain
  // any tool-call parts. When UIMessages have tool-call data, they reflect the
  // most current approval state (including user decisions that haven't been
  // persisted yet). Falling back would override resolved approvals with stale
  // persisted state, causing the approval banner to linger during continuations.
  const uiMessagesHaveToolCalls = messages.some((message) =>
    message.parts.some((part) => part.type === 'tool-call'),
  )
  if (uiMessagesHaveToolCalls) {
    return null
  }

  return findPendingApprovalFromPersistedConversation(persistedConversation)
}

export function findPendingAskUser(messages: UIMessage[]): PendingAskUser | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool-call' || part.name !== 'askUser') {
        continue
      }

      const hasResult = message.parts.some(
        (candidate) => candidate.type === 'tool-result' && candidate.toolCallId === part.id,
      )

      if (!hasResult) {
        return { questions: parseAskUserQuestions(part.arguments) }
      }
    }
  }

  return null
}
