import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { ActiveRunManager } from './active-run-manager'

interface AgentRunMetadata {
  readonly model: SupportedModelId
}

const activeRuns = new ActiveRunManager<ConversationId, AgentRunMetadata>()
const activeCompactions = new ActiveRunManager<ConversationId, AgentRunMetadata>()
const activeWaggleRuns = new ActiveRunManager<ConversationId, Record<string, never>>()

export { activeCompactions, activeRuns, activeWaggleRuns }

export function hasAnyActiveRun(conversationId: ConversationId): boolean {
  return (
    activeRuns.has(conversationId) ||
    activeCompactions.has(conversationId) ||
    activeWaggleRuns.has(conversationId)
  )
}

export function cancelConversationRuns(conversationId: ConversationId): boolean {
  const cancelledAgent = activeRuns.cancel(conversationId)
  const cancelledCompaction = activeCompactions.cancel(conversationId)
  const cancelledWaggle = activeWaggleRuns.cancel(conversationId)
  return cancelledAgent || cancelledCompaction || cancelledWaggle
}

export function getAllActiveRunConversationIds(): ConversationId[] {
  return [
    ...new Set([...activeRuns.keys(), ...activeCompactions.keys(), ...activeWaggleRuns.keys()]),
  ]
}

export function cancelAllConversationRuns(): ConversationId[] {
  const conversationIds = getAllActiveRunConversationIds()
  activeRuns.cancelAll()
  activeCompactions.cancelAll()
  activeWaggleRuns.cancelAll()
  return conversationIds
}
