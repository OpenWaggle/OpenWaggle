import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { PinnedSession, SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

/** A DataTransfer stand-in: jsdom does not implement one. */
function makeDataTransfer() {
  const store = new Map<string, string>()
  return {
    effectAllowed: 'none',
    setData: (format: string, value: string) => store.set(format, value),
    getData: (format: string) => store.get(format) ?? '',
    setDragImage: () => {},
  }
}

const pinnedRowFor = (title: string) => {
  const row = within(pinnedSection())
    .getByText(title)
    .closest<HTMLElement>('[data-pinned-session-id]')
  if (!row) throw new Error(`No pinned row for ${title}`)
  return row
}

describe('Pinned sort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPinnedSessionsMock.mockResolvedValue([])
    pinSessionMock.mockResolvedValue(undefined)
    unpinSessionMock.mockResolvedValue(undefined)
    movePinnedSessionMock.mockResolvedValue(undefined)
  })

  it('offers Manual plus the same options as the Projects sort control', () => {
    resetStores([pin(PINNED_ID, 'i')])
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort pinned sessions' }))

    for (const label of ['Manual', 'Recent', 'Oldest', 'Name (A->Z)']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.queryByText('Reverse')).toBeNull()
  })

  it('reorders rows when a derived sort is chosen, and restores Manual order on return', () => {
    // Manual order is Plain then Pinned; by Name it is "Pinned session" then "Plain session".
    resetStores([pin(PLAIN_ID, 'i'), pin(PINNED_ID, 'q')])
    render(<Sidebar />)

    const rowTitles = () =>
      Array.from(pinnedSection().querySelectorAll('[data-pinned-session-id]')).map((row) =>
        row.getAttribute('data-pinned-session-id'),
      )

    expect(rowTitles()).toStrictEqual([String(PLAIN_ID), String(PINNED_ID)])

    fireEvent.click(screen.getByRole('button', { name: 'Sort pinned sessions' }))
    fireEvent.click(screen.getByText('Name (A->Z)'))
    expect(rowTitles()).toStrictEqual([String(PINNED_ID), String(PLAIN_ID)])

    fireEvent.click(screen.getByRole('button', { name: 'Sort pinned sessions' }))
    fireEvent.click(screen.getByText('Manual'))
    expect(rowTitles()).toStrictEqual([String(PLAIN_ID), String(PINNED_ID)])
  })

  it('marks the active sort in the menu', () => {
    resetStores([pin(PINNED_ID, 'i')])
    usePinnedSessionsStore.setState({ sortMode: 'oldest' })
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort pinned sessions' }))

    const active = screen.getByText('Oldest').closest('button')
    expect(active?.className).toContain('text-accent')
  })
})

describe('Pinned Manual order drag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPinnedSessionsMock.mockResolvedValue([])
    movePinnedSessionMock.mockResolvedValue(undefined)
  })

  it('moves a dragged row to the position it was dropped on', async () => {
    resetStores([pin(PLAIN_ID, 'i'), pin(PINNED_ID, 'q')])
    render(<Sidebar />)
    const dataTransfer = makeDataTransfer()

    fireEvent.dragStart(pinnedRowFor('Pinned session'), { dataTransfer })
    fireEvent.dragOver(pinnedRowFor('Plain session'), { dataTransfer })
    fireEvent.drop(pinnedRowFor('Plain session'), { dataTransfer })

    await waitFor(() => {
      expect(movePinnedSessionMock).toHaveBeenCalledWith({
        sessionId: PINNED_ID,
        afterSessionId: null,
        beforeSessionId: PLAIN_ID,
      })
    })
  })

  it('ignores a drop onto the dragged row itself', () => {
    resetStores([pin(PLAIN_ID, 'i'), pin(PINNED_ID, 'q')])
    render(<Sidebar />)
    const dataTransfer = makeDataTransfer()

    fireEvent.dragStart(pinnedRowFor('Plain session'), { dataTransfer })
    fireEvent.drop(pinnedRowFor('Plain session'), { dataTransfer })

    expect(movePinnedSessionMock).not.toHaveBeenCalled()
  })

  it('survives a re-render mid-drag: dragstart must not replace the dragged row', async () => {
    // The prototype proved this fails silently: replacing the dragged node mid-gesture
    // cancels the drag. jsdom cannot simulate that cancellation, so the guard here is the
    // property that prevents it — the dragged row keeps the same DOM node across a
    // re-render, and drag feedback is applied imperatively rather than through state.
    resetStores([pin(PLAIN_ID, 'i'), pin(PINNED_ID, 'q')])
    render(<Sidebar />)
    const dataTransfer = makeDataTransfer()

    const dragged = pinnedRowFor('Pinned session')
    fireEvent.dragStart(dragged, { dataTransfer })

    // Feedback is on the node itself, so no render was needed to show it.
    expect(dragged.dataset.dragging).toBe('true')
    expect(pinnedRowFor('Pinned session')).toBe(dragged)

    // Force a React re-render of the list while the drag is in flight, and flush it.
    act(() => {
      usePinnedSessionsStore.setState({ pins: [pin(PLAIN_ID, 'i'), pin(PINNED_ID, 'q')] })
    })

    // Same node instance: React reused it, so a real browser drag would still be alive.
    expect(pinnedRowFor('Pinned session')).toBe(dragged)
    expect(dragged.isConnected).toBe(true)
    expect(dragged.dataset.dragging).toBe('true')

    fireEvent.drop(pinnedRowFor('Plain session'), { dataTransfer })

    await waitFor(() => {
      expect(movePinnedSessionMock).toHaveBeenCalledWith({
        sessionId: PINNED_ID,
        afterSessionId: null,
        beforeSessionId: PLAIN_ID,
      })
    })
  })

  it('is not draggable outside Manual order', () => {
    resetStores([pin(PLAIN_ID, 'i'), pin(PINNED_ID, 'q')])
    usePinnedSessionsStore.setState({ sortMode: 'name' })
    render(<Sidebar />)

    expect(pinnedRowFor('Plain session').getAttribute('draggable')).toBe('false')
  })
})
