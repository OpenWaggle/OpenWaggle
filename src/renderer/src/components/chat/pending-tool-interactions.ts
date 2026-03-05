import type { UserQuestion } from '@shared/types/question'
import { askUserArgsSchema } from '@shared/types/question'
import { isTrustableToolName } from '@shared/types/tool-approval'
import { isRecord } from '@shared/utils/validation'
import type { UIMessage } from '@tanstack/ai-react'

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

export interface PendingPlanProposal {
  readonly planText: string
}

function parseAskUserQuestions(args: string): UserQuestion[] {
  try {
    const parsed: unknown = JSON.parse(args)
    const result = askUserArgsSchema.safeParse(parsed)
    if (result.success) {
      return result.data.questions
    }
  } catch {}

  return []
}

function hasCompleteToolArguments(args: string): boolean {
  try {
    const parsed: unknown = JSON.parse(args)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function unwrapNormalizedJsonPayload(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  if (value.kind === 'json' && 'data' in value) {
    return value.data
  }
  return value
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

function isPendingExecutionPayload(payload: unknown): boolean {
  const normalizedPayload = unwrapNormalizedJsonPayload(parseMaybeJson(payload))
  if (!isRecord(normalizedPayload)) {
    return false
  }
  return normalizedPayload.pendingExecution === true
}

function isApprovalStatusPayload(payload: unknown): boolean {
  const normalizedPayload = unwrapNormalizedJsonPayload(parseMaybeJson(payload))
  if (!isRecord(normalizedPayload)) {
    return false
  }

  return (
    typeof normalizedPayload.approved === 'boolean' && typeof normalizedPayload.message === 'string'
  )
}

function isIncompleteToolPayload(payload: unknown): boolean {
  return isPendingExecutionPayload(payload) || isApprovalStatusPayload(payload)
}

function hasConcreteToolOutput(payload: unknown): boolean {
  return payload !== undefined && !isIncompleteToolPayload(payload)
}

function isCompletedToolResult(
  part: Extract<UIMessage['parts'][number], { type: 'tool-result' }>,
): boolean {
  return !isIncompleteToolPayload(getToolResultPayload(part))
}

export function findPendingApproval(messages: UIMessage[]): PendingApproval | null {
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
        const hasApprovalMetadata = part.approval?.needsApproval === true
        const hasCompletedResult = completedToolCallIds.has(part.id)
        const unresolvedApprovalState =
          hasApprovalMetadata && part.state !== 'approval-responded' && !hasCompletedResult
        const trustableCallWithoutApprovalMetadata =
          !hasApprovalMetadata && isTrustableToolName(part.name)
        const unresolvedTrustableFallback =
          trustableCallWithoutApprovalMetadata &&
          !hasCompletedResult &&
          !hasConcreteToolOutput(part.output) &&
          part.state !== 'input-streaming' &&
          hasCompleteToolArguments(part.arguments)

        if (!unresolvedApprovalState && !unresolvedTrustableFallback) {
          continue
        }

        return {
          toolName: part.name,
          toolArgs: part.arguments,
          approvalId: part.approval?.id ?? `approval_${part.id}`,
          toolCallId: part.id,
          hasApprovalMetadata,
        }
      }
    }
  }

  return null
}

function parsePlanText(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed === 'object' && parsed !== null && 'planText' in parsed) {
      const planText = (parsed as { planText: unknown }).planText
      if (typeof planText === 'string') return planText
    }
  } catch {}
  return ''
}

export function findPendingPlanProposal(messages: UIMessage[]): PendingPlanProposal | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool-call' || part.name !== 'proposePlan') {
        continue
      }

      const hasResult = message.parts.some(
        (candidate) => candidate.type === 'tool-result' && candidate.toolCallId === part.id,
      )

      if (!hasResult) {
        return { planText: parsePlanText(part.arguments) }
      }
    }
  }

  return null
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
