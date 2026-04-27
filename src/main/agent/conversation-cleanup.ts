import type { ConversationId } from '@shared/types/brand'

/** Cleanup per-conversation runtime state owned outside the Pi session. */
export function cleanupConversationRun(conversationId: ConversationId): void {
  void conversationId
}
