import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionCatalogPage, SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererQueryClient } from '@/queries/query-client'
import { useUIStore } from '@/shell/ui-store'
import { renderInMemoryRouter } from '@/test-utils/memory-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { usePinnedSessionsStore } from '../../state/pinned-sessions-store'
import { useSidebarFilterStore } from '../../state/sidebar-filter-store'
import { useSidebarViewStore } from '../../state/sidebar-view-store'

const ipc = vi.hoisted(() => ({
  listSessionCatalogPage:
    vi.fn<(archived: boolean, limit: number, cursor?: string) => Promise<SessionCatalogPage>>(),
  getGitStatus: vi.fn(),
  listPinnedSessions: vi.fn(async () => []),
  querySessionControl: vi.fn(async () => ({
    contractVersion: 2,
    requestId: 'interrupted-count',
    outcome: { operation: 'list', sessions: [], totalCount: 0 },
  })),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi(ipc),
}))

import { Sidebar } from '../Sidebar'

/*
 * Only the preload is replaced: the sidebar controller, the Session catalog store and every
 * section are the real ones, under a real memory router, so the case asserts which rows the
 * sidebar lists before and after the next catalog page.
 */
const PROJECT = '/repo/alpha'

function session(id: string, title: string, updatedAt: number): SessionSummary {
  return { id: SessionId(id), title, projectPath: PROJECT, createdAt: 1, updatedAt }
}

const FIRST_PAGE = [session('session-new', 'Newest session', 20)]
const SECOND_PAGE = [session('session-old', 'Older session', 10)]

function resetStores() {
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: PROJECT,
      selectedModel: SupportedModelId('openai/gpt-5'),
      recentProjects: [PROJECT],
    },
    isLoaded: true,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    baseProviderModels: [],
    providerModels: [],
  })
  useChatStore.setState({
    sessions: FIRST_PAGE,
    sessionById: new Map(),
    missingSessionIds: new Set(),
    draftSession: null,
    activeSessionId: null,
    activeSession: null,
    error: null,
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: FIRST_PAGE,
    sessionsNextCursor: 'cursor-2',
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
  })
  useSessionStatusStore.setState({
    statuses: new Map(),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
    phases: new Map(),
  })
  useUIStore.setState({ ...useUIStore.getInitialState(), sidebarOpen: true })
  usePinnedSessionsStore.setState({ pins: [], sortMode: 'manual' })
  useSidebarFilterStore.setState({ activeState: null })
  useSidebarViewStore.setState({ sessionSortMode: 'recent', projectExpandedByPath: {} })
}

describe('Sidebar catalog pagination', () => {
  beforeEach(() => {
    resetStores()
    ipc.listSessionCatalogPage.mockReset()
    ipc.listSessionCatalogPage.mockResolvedValue({ sessions: SECOND_PAGE })
  })

  it('keeps the next page reachable when the rendered catalog cannot scroll', async () => {
    await renderInMemoryRouter(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Sidebar />
      </QueryClientProvider>,
    )
    expect(screen.getByText('Newest session')).toBeInTheDocument()
    expect(screen.queryByText('Older session')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Load more sessions' }))

    expect(await screen.findByText('Older session')).toBeInTheDocument()
    expect(ipc.listSessionCatalogPage).toHaveBeenCalledWith(false, expect.any(Number), 'cursor-2')
    // The last page has no cursor, so the button goes away.
    expect(screen.queryByRole('button', { name: 'Load more sessions' })).toBeNull()
  })
})
