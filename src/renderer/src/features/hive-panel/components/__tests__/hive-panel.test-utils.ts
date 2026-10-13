import { SessionId } from '@shared/types/brand'
import type { SessionLineageSummary, SessionSummary } from '@shared/types/session'
import { vi } from 'vitest'
import type { registerSidebarSessionActions } from '@/features/sidebar/lib'

type SidebarSessionActions = NonNullable<Parameters<typeof registerSidebarSessionActions>[0]>

export function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    createdAt: 1000,
    updatedAt: 1000,
    lineage: {
      role: 'worker',
      parentSessionId: SessionId('queen'),
      hiveRootSessionId: SessionId('queen'),
      parentTitle: 'queen',
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationState: 'working',
    },
    ...overrides,
  }
}

export const queen = summary('queen', {
  lineage: {
    role: 'queen',
    hiveRootSessionId: SessionId('queen'),
    directWorkerCount: 2,
    activeDirectWorkerCount: 1,
  },
})

// The Workers share one lineage base.
export const workerLineage: SessionLineageSummary = {
  role: 'worker',
  parentSessionId: SessionId('queen'),
  hiveRootSessionId: SessionId('queen'),
  parentTitle: 'queen',
  directWorkerCount: 0,
  activeDirectWorkerCount: 0,
}

export function hivePage(members: readonly SessionSummary[], nextCursor?: string) {
  return { root: queen, members, attentionCount: 0, ...(nextCursor ? { nextCursor } : {}) }
}

/** The Sidebar's session actions, as Hive panel rows receive them. */
export function sessionActionsStub(): SidebarSessionActions {
  return {
    select: vi.fn(),
    delete: vi.fn(),
    archive: vi.fn(),
    markUnread: vi.fn(),
    clone: vi.fn(),
    togglePin: vi.fn(),
  }
}
