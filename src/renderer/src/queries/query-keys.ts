export const queryKeys = {
  teams: ['teams'] as const,
  mcpServers: ['mcpServers'] as const,
  archivedConversations: ['archivedConversations'] as const,
  skills: (projectPath: string | null) => ['skills', projectPath] as const,
  skillPreview: (projectPath: string | null, skillId: string | null) =>
    ['skillPreview', projectPath, skillId] as const,
}
