import type { SessionId } from '@shared/types/brand'

export function extensionPackagesQueryKey(projectPath: string | null) {
  return ['extensionPackages', projectPath] as const
}

export const queryKeys = {
  wagglePresets: (projectPath: string | null) => ['wagglePresets', projectPath] as const,
  archivedSessions: ['archivedSessions'] as const,
  archivedSessionBranches: ['archivedSessionBranches'] as const,
  extensionPackages: extensionPackagesQueryKey,
  sessions: ['sessions'] as const,
  session: (id: SessionId | null) => ['session', id] as const,
  skills: (projectPath: string | null) => ['skills', projectPath] as const,
  skillPreview: (projectPath: string | null, skillId: string | null) =>
    ['skillPreview', projectPath, skillId] as const,
  workspaceFiles: (projectPath: string | null, query: string, limit: number) =>
    ['workspaceFiles', projectPath, query, limit] as const,
  workspaceContent: (projectPath: string | null, query: string, limit: number) =>
    ['workspaceContent', projectPath, query, limit] as const,
  workspaceFile: (projectPath: string | null, relativePath: string | null) =>
    ['workspaceFile', projectPath, relativePath] as const,
}
