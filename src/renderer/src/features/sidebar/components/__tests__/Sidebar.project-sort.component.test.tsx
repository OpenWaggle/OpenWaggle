import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, screen, within } from '@testing-library/react'
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
 * The Projects sort orders the projects as well as their sessions, by date or name in either
 * order (#516). The controller, stores and sort menu here are the real ones.
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

/** Beta's first session is newer than OpenWaggle's, so the date orders tell them apart. */
const DATED_SESSIONS = [
  ...SESSIONS,
  {
    id: SessionId('session-2'),
    title: 'Beta session',
    projectPath: '/repo/zebra',
    createdAt: 5,
    updatedAt: 6,
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

async function renderSidebar() {
  await renderInMemoryRouter(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Sidebar />
    </QueryClientProvider>,
  )
}

const sortTrigger = () => screen.getByRole('button', { name: 'Sort projects and sessions' })
const sortMenu = () => screen.queryByRole('menu', { name: 'Sort projects and sessions' })
const option = (name: string) => screen.getByRole('menuitemradio', { name })

describe('Sidebar project sort', () => {
  beforeEach(resetStores)

  it('lists projects A to Z, then Z to A, by their shown name', async () => {
    await renderSidebar()
    expect(projectOrder()).toEqual(['Collapse openwaggle', 'Collapse Beta', 'Collapse aardvark'])

    await userEvent.click(sortTrigger())
    await userEvent.click(option('Name'))
    expect(option('A to Z')).toHaveAttribute('aria-checked', 'true')
    expect(projectOrder()).toEqual(['Collapse aardvark', 'Collapse Beta', 'Collapse openwaggle'])

    await userEvent.click(option('Z to A'))
    expect(projectOrder()).toEqual(['Collapse openwaggle', 'Collapse Beta', 'Collapse aardvark'])
    expect(useSidebarViewStore.getState().sessionSortMode).toBe('name-desc')
  })

  it('lists the oldest project first under Oldest first', async () => {
    useChatStore.setState({ sessions: DATED_SESSIONS })
    useSessionStore.setState({ sessions: DATED_SESSIONS })
    await renderSidebar()
    expect(projectOrder().slice(0, 2)).toEqual(['Collapse Beta', 'Collapse openwaggle'])

    await userEvent.click(sortTrigger())
    await userEvent.click(option('Oldest first'))

    expect(projectOrder().slice(0, 2)).toEqual(['Collapse openwaggle', 'Collapse Beta'])
  })

  it('groups the menu into a named Sort by and Order', async () => {
    await renderSidebar()
    await userEvent.click(sortTrigger())

    const sortBy = screen.getByRole('group', { name: 'Sort by' })
    const order = screen.getByRole('group', { name: 'Order' })
    expect(
      within(sortBy)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Date', 'Name'])
    expect(
      within(order)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Newest first', 'Oldest first'])
    expect(sortTrigger()).toHaveAttribute('aria-expanded', 'true')
  })

  it('works from the keyboard alone', async () => {
    await renderSidebar()
    sortTrigger().focus()

    await userEvent.keyboard('{Enter}')
    // Focus opens on the checked field.
    expect(option('Date')).toHaveFocus()

    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(option('Name')).toHaveAttribute('aria-checked', 'true')
    // Picking a field keeps the menu open on it, so the order is one key away.
    expect(option('Name')).toHaveFocus()

    await userEvent.keyboard('{End}{Enter}')
    expect(option('Z to A')).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{Home}')
    expect(option('Date')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(option('Z to A')).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(sortMenu()).toBeNull()
    expect(sortTrigger()).toHaveFocus()
    expect(projectOrder()).toEqual(['Collapse openwaggle', 'Collapse Beta', 'Collapse aardvark'])
  })

  it('closes on Tab', async () => {
    await renderSidebar()
    await userEvent.click(sortTrigger())
    expect(sortMenu()).not.toBeNull()

    await userEvent.keyboard('{Tab}')

    expect(sortMenu()).toBeNull()
  })

  it('closes when clicking outside it', async () => {
    await renderSidebar()
    await userEvent.click(sortTrigger())
    await userEvent.click(option('Name'))
    expect(sortMenu()).not.toBeNull()

    fireEvent.mouseDown(document.body)

    expect(sortMenu()).toBeNull()
    expect(useSidebarViewStore.getState().sessionSortMode).toBe('name')
  })
})
