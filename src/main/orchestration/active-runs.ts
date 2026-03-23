import type { ConversationId } from '@shared/types/brand'
import { ActiveRunManager } from '../ipc/active-run-manager'

interface OrchestrationRunMetadata {
  readonly conversationId: ConversationId
}

const activeRuns = new ActiveRunManager<string, OrchestrationRunMetadata>()

export function cancelActiveOrchestrationRun(runId: string): boolean {
  return activeRuns.cancel(runId)
}

export function cancelAllForConversation(conversationId: ConversationId): void {
  activeRuns.cancelAll((entry) => entry.metadata.conversationId === conversationId)
}
