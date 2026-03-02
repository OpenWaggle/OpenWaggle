import type { ConversationId } from '@shared/types/brand'
import { cancelAllForConversation } from '../orchestration/active-runs'
import { clearContext } from '../tools/context-injection-buffer'
import { cancelPlanProposal } from '../tools/plan-manager'
import { cancelQuestion } from '../tools/question-manager'

/** Cleanup all per-conversation ephemeral state (questions, plans, context injection) */
export function cleanupConversationRun(conversationId: ConversationId): void {
  cancelAllForConversation(conversationId)
  cancelQuestion(conversationId)
  cancelPlanProposal(conversationId)
  clearContext(conversationId)
}
