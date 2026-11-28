import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
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
 * Name (A->Z) sorted the sessions inside each project but left the projects in creation order,
 * so the list looked unsorted. The controller, stores and sort menu here are the real ones.
 */
const OPENWAGGLE = '/repo/openwaggle'
const SESSIONS = [
  {
    id: SessionId('session-1'),
    title: 'Existing session',
    projectPath: OPENWAGGLE,
    createdAt: 1,
    updatedAt: 2,
  },
] satisfies SessionSummary[]

function resetStores() {
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: OPENWAGGLE,
      selectedModel: SupportedModelId('openai/gpt-5'),
      recentProjects: [OPENWAGGLE, '/repo/zebra', '/repo/aardvark'],
      // The sort follows the name the sidebar shows, so a renamed project sorts by its new name.
      projectDisplayNames: { '/repo/zebra': 'Beta' },
    },
    isLoaded: true,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    baseProviderModels: [],
    providerModels: [],
  })
  useChatStore.setState({
    sessions: SESSIONS,
    sessionById: new Map(),
    missingSessionIds: new Set(),
    draftSession: null,
    activeSessionId: null,
    activeSession: null,
    error: null,
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: SESSIONS,
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

function projectOrder() {
  return screen
    .getAllByRole('button', { name: /^collapse /i })
    .map((button) => button.getAttribute('aria-label'))
}

describe('Sidebar project sort', () => {
  beforeEach(resetStores)

  it('lists projects A->Z by their shown name once Name (A->Z) is picked', async () => {
    await renderInMemoryRouter(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Sidebar />
      </QueryClientProvider>,
    )
    expect(projectOrder()).toEqual(['Collapse openwaggle', 'Collapse Beta', 'Collapse aardvark'])

    await userEvent.click(screen.getByRole('button', { name: 'Sort sessions' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /name/i }))

    expect(projectOrder()).toEqual(['Collapse aardvark', 'Collapse Beta', 'Collapse openwaggle'])
  })
})
