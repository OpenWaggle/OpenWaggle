import type { ConversationId } from '@shared/types/brand'
import type { QuestionAnswer } from '@shared/types/question'

interface PendingQuestion {
  resolve: (answers: QuestionAnswer[]) => void
  reject: (reason: Error) => void
}

/** Pending questions keyed by conversationId (only one askUser per conversation at a time) */
const pending = new Map<ConversationId, PendingQuestion>()

export function registerQuestion(
  conversationId: ConversationId,
  resolve: (answers: QuestionAnswer[]) => void,
  reject: (reason: Error) => void,
): void {
  // If there's already a pending question for this conversation, reject it
  const existing = pending.get(conversationId)
  if (existing) {
    existing.reject(new Error('Superseded by a new question'))
  }
  pending.set(conversationId, { resolve, reject })
}

export function answerQuestion(conversationId: ConversationId, answers: QuestionAnswer[]): void {
  const entry = pending.get(conversationId)
  if (!entry) {
    throw new Error(`No pending question for conversation ${conversationId}`)
  }
  pending.delete(conversationId)
  entry.resolve(answers)
}

export function cancelQuestion(conversationId: ConversationId): void {
  const entry = pending.get(conversationId)
  if (entry) {
    pending.delete(conversationId)
    entry.reject(new Error('Question cancelled'))
  }
}

/** Reject and remove all pending questions. Used for clean shutdown. */
export function clearAllQuestions(): void {
  for (const [conversationId, entry] of pending) {
    pending.delete(conversationId)
    entry.reject(new Error('All questions cleared'))
  }
}

/** Number of pending questions. Exposed for testing/observability. */
export function pendingQuestionCount(): number {
  return pending.size
}
