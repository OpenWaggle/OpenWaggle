import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { PinnedSession, SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { usePinnedSessionsStore } from '../../state/pinned-sessions-store'
import { Sidebar } from '../Sidebar'

const {
  listPinnedSessionsMock,
  movePinnedSessionMock,
  navigateMock,
  pinSessionMock,
  routerState,
  unpinSessionMock,
} = vi.hoisted(() => ({
  listPinnedSessionsMock: vi.fn(),
  movePinnedSessionMock: vi.fn(),
  navigateMock: vi.fn(),
  pinSessionMock: vi.fn(),
  routerState: { pathname: '/' },
  unpinSessionMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useRouterState: (options: {
    readonly select: (state: { readonly location: { readonly pathname: string } }) => string
  }) => options.select({ location: { pathname: routerState.pathname } }),
}))

vi.mock('@/shell/useFullscreen', () => ({ useFullscreen: () => false }))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    archiveSession: vi.fn(),
    cancelAgent: vi.fn(),
    deleteSession: vi.fn(),
    getGitStatus: vi.fn(),
    onGitWorkingTreeChanged: () => () => {},
    getProjectPreferences: vi.fn(),
    getProviderModels: vi.fn(),
    listActiveRuns: vi.fn(),
    listArchivedSessions: vi.fn(),
    listGitBranches: vi.fn(),
    listPinnedSessions: listPinnedSessionsMock,
    movePinnedSession: movePinnedSessionMock,
    openPath: vi.fn(),
    pinSession: pinSessionMock,
    showConfirm: vi.fn(),
    unpinSession: unpinSessionMock,
    updateSettings: vi.fn(),
  },
}))

const PROJECT_PATH = '/repo/openwaggle'
const OTHER_PROJECT_PATH = '/repo/other'
const PINNED_ID = SessionId('session-pinned')
const PLAIN_ID = SessionId('session-plain')
const SOLO_ID = SessionId('session-solo')

function makeSessions(): SessionSummary[] {
  return [
    {
      id: PINNED_ID,
      title: 'Pinned session',
      projectPath: PROJECT_PATH,
      createdAt: 20,
      updatedAt: 30,
    },
    {
      id: PLAIN_ID,
      title: 'Plain session',
      projectPath: PROJECT_PATH,
      createdAt: 10,
      updatedAt: 20,
    },
    {
      id: SOLO_ID,
      title: 'Solo session',
      projectPath: OTHER_PROJECT_PATH,
      createdAt: 5,
      updatedAt: 10,
    },
  ]
}

function pin(sessionId: SessionId, sortKey: string): PinnedSession {
  return { sessionId, pinnedAt: 1, sortKey }
}

function resetStores(pins: readonly PinnedSession[]) {
  const sessions = makeSessions()
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: PROJECT_PATH,
      selectedModel: SupportedModelId('openai/gpt-5'),
      recentProjects: [PROJECT_PATH, OTHER_PROJECT_PATH],
    },
    isLoaded: true,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    baseProviderModels: [],
    providerModels: [],
  })
  useChatStore.setState({
    sessions,
    sessionById: new Map(),
    missingSessionIds: new Set(),
    draftSession: null,
    activeSessionId: PLAIN_ID,
    activeSession: null,
    error: null,
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions,
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
  })
  useSessionStatusStore.setState({
    statuses: new Map(),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
  })
  useUIStore.setState({ ...useUIStore.getInitialState(), sidebarOpen: true })
  usePinnedSessionsStore.setState({ pins, sortMode: 'manual' })
}

const pinnedSection = () => screen.getByRole('region', { name: 'Pinned sessions' })

describe('Pinned section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPinnedSessionsMock.mockResolvedValue([])
    pinSessionMock.mockResolvedValue(undefined)
    unpinSessionMock.mockResolvedValue(undefined)
    movePinnedSessionMock.mockResolvedValue(undefined)
  })

  it('is absent when nothing is pinned', () => {
    resetStores([])
    render(<Sidebar />)

    expect(screen.queryByRole('region', { name: 'Pinned sessions' })).toBeNull()
  })

  it('renders a pinned session above the project list and only once', () => {
    resetStores([pin(PINNED_ID, 'i')])
    render(<Sidebar />)

    expect(within(pinnedSection()).getByText('Pinned session')).toBeTruthy()
    expect(screen.getAllByText('Pinned session')).toHaveLength(1)
    expect(screen.getByText('Plain session')).toBeTruthy()

    const pinnedHeader = screen.getByText('Pinned')
    const projectsHeader = screen.getByText('Projects')
    expect(pinnedHeader.compareDocumentPosition(projectsHeader)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('shows the owning project when pins span projects, since rows leave their group', () => {
    resetStores([pin(PINNED_ID, 'i'), pin(SOLO_ID, 'q')])
    render(<Sidebar />)

    const section = within(pinnedSection())
    expect(section.getByText('openwaggle')).toBeTruthy()
    expect(section.getByText('other')).toBeTruthy()
  })

  it('omits the project label when every pin shares one project, where it adds nothing', () => {
    resetStores([pin(PINNED_ID, 'i'), pin(PLAIN_ID, 'q')])
    render(<Sidebar />)

    expect(within(pinnedSection()).queryByText('openwaggle')).toBeNull()
  })

  it('shows a shortcut badge on the first nine rows', () => {
    resetStores([pin(PINNED_ID, 'i'), pin(PLAIN_ID, 'q')])
    render(<Sidebar />)

    const section = pinnedSection()
    expect(within(section).getByText('\u23181')).toBeTruthy()
    expect(within(section).getByText('\u23182')).toBeTruthy()
  })

  it('keeps a project whose every session is pinned, with a hint instead of "No sessions"', () => {
    resetStores([pin(SOLO_ID, 'i')])
    render(<Sidebar />)

    // The project row survives; its own label appears outside the Pinned section.
    expect(screen.getAllByText('other').length).toBeGreaterThan(0)
    expect(screen.getByText('1 session pinned above')).toBeTruthy()
    expect(screen.queryByText('No sessions')).toBeNull()
  })

  it('pins from the hover pin button on an unpinned row', async () => {
    resetStores([])
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Pin session Plain session' }))

    await waitFor(() => {
      expect(pinSessionMock).toHaveBeenCalledWith(PLAIN_ID)
    })
  })

  it('unpins from the pin button on a pinned row', async () => {
    resetStores([pin(PINNED_ID, 'i')])
    render(<Sidebar />)

    fireEvent.click(
      within(pinnedSection()).getByRole('button', { name: 'Unpin session Pinned session' }),
    )

    await waitFor(() => {
      expect(unpinSessionMock).toHaveBeenCalledWith(PINNED_ID)
    })
  })

  it('pins from the session actions menu', async () => {
    resetStores([])
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Open session actions for Plain session' }))
    fireEvent.click(screen.getByText('Pin session'))

    await waitFor(() => {
      expect(pinSessionMock).toHaveBeenCalledWith(PLAIN_ID)
    })
  })

  /*
   * Reordering has to work without a drag.
   *
   * Manual order made the row a drag source and offered nothing else, which fails WCAG 2.2
   * SC 2.1.1 Keyboard and SC 2.5.7 Dragging Movements: a keyboard user, or anyone who cannot hold
   * a pointer down and move it, could not change the order at all.
   */
  it('reorders a pinned row from the actions menu, with no drag', async () => {
    resetStores([pin(PINNED_ID, 'i'), pin(PLAIN_ID, 'q')])
    render(<Sidebar />)

    // The second row can move up; the first cannot.
    fireEvent.click(
      within(pinnedSection()).getByRole('button', {
        name: 'Open session actions for Plain session',
      }),
    )
    expect(screen.getByText('Move up')).toBeInTheDocument()
    expect(screen.queryByText('Move down')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Move up'))

    await waitFor(() => {
      expect(movePinnedSessionMock).toHaveBeenCalled()
    })
  })

  it('offers no move on the only pinned row', () => {
    resetStores([pin(PINNED_ID, 'i')])
    render(<Sidebar />)

    fireEvent.click(
      within(pinnedSection()).getByRole('button', {
        name: 'Open session actions for Pinned session',
      }),
    )

    expect(screen.queryByText('Move up')).not.toBeInTheDocument()
    expect(screen.queryByText('Move down')).not.toBeInTheDocument()
  })

  it('offers Unpin in the actions menu of a pinned row', async () => {
    resetStores([pin(PINNED_ID, 'i')])
    render(<Sidebar />)

    fireEvent.click(
      within(pinnedSection()).getByRole('button', {
        name: 'Open session actions for Pinned session',
      }),
    )
    fireEvent.click(screen.getByText('Unpin session'))

    await waitFor(() => {
      expect(unpinSessionMock).toHaveBeenCalledWith(PINNED_ID)
    })
  })

  it('renders nothing for a pin whose session no longer exists', () => {
    resetStores([pin(SessionId('session-gone'), 'i')])

    expect(() => render(<Sidebar />)).not.toThrow()
    expect(screen.queryByRole('region', { name: 'Pinned sessions' })).toBeNull()
  })
})
