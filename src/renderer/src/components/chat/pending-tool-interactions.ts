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
