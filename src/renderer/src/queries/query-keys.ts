import type { ConversationId } from '@shared/types/brand'

export const queryKeys = {
  teams: ['teams'] as const,
  mcpServers: ['mcpServers'] as const,
  archivedConversations: ['archivedConversations'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: ConversationId | null) => ['conversation', id] as const,
  skills: (projectPath: string | null) => ['skills', projectPath] as const,
  skillPreview: (projectPath: string | null, skillId: string | null) =>
    ['skillPreview', projectPath, skillId] as const,
}
