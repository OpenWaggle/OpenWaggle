import type { UserQuestion } from '@shared/types/question'
import { askUserArgsSchema } from '@shared/types/question'
import type { UIMessage } from '@tanstack/ai-react'

export interface PendingApproval {
  readonly toolName: string
  readonly toolArgs: string
  readonly approvalId: string
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

export function findPendingApproval(messages: UIMessage[]): PendingApproval | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-call' && part.state === 'approval-requested' && part.approval?.id) {
        return {
          toolName: part.name,
          toolArgs: part.arguments,
          approvalId: part.approval.id,
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
