import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'

export function summary(id: string, title: string, projectPath = '/repo/project'): SessionSummary {
  return {
    id: SessionId(id),
    title,
    projectPath,
    createdAt: 1,
    updatedAt: 1,
  }
}

function querySummary(session: SessionSummary) {
  return {
    sessionId: String(session.id),
    title: session.title,
    projectPath: session.projectPath,
    archived: session.archived ?? false,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lineageRole: 'independent' as const,
    directWorkerCount: 0,
  }
}

export function listResponse(
  sessions: readonly SessionSummary[],
  options?: { readonly totalCount?: number; readonly nextCursor?: string },
) {
  return {
    contractVersion: 2,
    requestId: 'sidebar-list',
    outcome: {
      operation: 'list' as const,
      sessions: sessions.map(querySummary),
      ...options,
    },
  }
}

type HookInput = Parameters<typeof useRemoteSidebarSessions>[0]

export function hookInput(overrides: Partial<HookInput>): HookInput {
  return {
    query: overrides.query ?? '',
    filterState: overrides.filterState ?? null,
    stateBySessionId: overrides.stateBySessionId ?? new Map(),
    loadedSessions: overrides.loadedSessions ?? [],
    projectPaths: overrides.projectPaths ?? [],
    projectDisplayNames: overrides.projectDisplayNames ?? {},
  }
}
