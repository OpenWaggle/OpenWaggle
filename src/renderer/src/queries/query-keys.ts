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
}
