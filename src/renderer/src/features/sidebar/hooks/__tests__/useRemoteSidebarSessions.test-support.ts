import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'

export function summary(id: string, title: string, projectPath = '/repo/project') {
  return {
    id: SessionId(id),
    title,
    projectPath,
    createdAt: 1,
    updatedAt: 1,
  } satisfies SessionSummary
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

export function hookInput(overrides: Partial<HookInput>) {
  const input: HookInput = {
    query: overrides.query ?? '',
    filterState: overrides.filterState ?? null,
    stateBySessionId: overrides.stateBySessionId ?? new Map(),
    loadedSessions: overrides.loadedSessions ?? [],
    projectPaths: overrides.projectPaths ?? [],
    projectDisplayNames: overrides.projectDisplayNames ?? {},
  }
  return input
}
