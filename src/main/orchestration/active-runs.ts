import type { ConversationId } from '@shared/types/brand'

interface ActiveOrchestrationRun {
  readonly runId: string
  readonly conversationId: ConversationId
  readonly controller: AbortController
}

const activeRunsByRunId = new Map<string, ActiveOrchestrationRun>()

export function registerActiveOrchestrationRun(
  runId: string,
  conversationId: ConversationId,
  controller: AbortController,
): void {
  activeRunsByRunId.set(runId, { runId, conversationId, controller })
}

export function unregisterActiveOrchestrationRun(runId: string): void {
  activeRunsByRunId.delete(runId)
}

export function cancelActiveOrchestrationRun(runId: string): boolean {
  const active = activeRunsByRunId.get(runId)
  if (!active) return false
  active.controller.abort()
  activeRunsByRunId.delete(runId)
  return true
}

export function cancelAllForConversation(conversationId: ConversationId): void {
  for (const [runId, active] of activeRunsByRunId) {
    if (active.conversationId !== conversationId) continue
    active.controller.abort()
    activeRunsByRunId.delete(runId)
  }
}
