import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { useSidebarViewStore } from '../../state/sidebar-view-store'
import { Sidebar } from '../Sidebar'

const { apiMock, navigateMock, routerState } = vi.hoisted(() => ({
  apiMock: {
    archiveSession: vi.fn(),
    cancelAgent: vi.fn(),
    closeBrowserPreview: vi.fn(),
    deleteSession: vi.fn(),
    getGitStatus: vi.fn(),
    getProjectPreferences: vi.fn(),
    getProviderModels: vi.fn(),
    listActiveRuns: vi.fn(),
    listGitBranches: vi.fn(),
    listSessionsByIds: vi.fn(),
    querySessionControl: vi.fn(),
    onGitWorkingTreeChanged: () => () => {},
    openPath: vi.fn(),
    showConfirm: vi.fn(),
    unregisterBrowserPreviewOwner: vi.fn(),
    updateSettings: vi.fn(),
  },
  navigateMock: vi.fn(),
  routerState: { pathname: '/' },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useRouterState: (options: {
    readonly select: (state: { readonly location: { readonly pathname: string } }) => string
  }) => options.select({ location: { pathname: routerState.pathname } }),
}))

vi.mock('@/shell/useFullscreen', () => ({
  useFullscreen: () => false,
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

const PROJECT_PATH = '/repo/openwaggle'
const SESSION_ID = SessionId('session-project-1')
const ARCHIVED_SESSION_ID = SessionId('session-project-archived')
function makeSession(): SessionSummary {
  return {
    id: SESSION_ID,
    title: 'Existing project session',
    projectPath: PROJECT_PATH,
    createdAt: 10,
    updatedAt: 20,
  }
}

function makeArchivedSession(): SessionSummary {
  return { ...makeSession(), id: ARCHIVED_SESSION_ID, archived: true }
}

function mockProjectSessions(sessions: readonly SessionSummary[]) {
  apiMock.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
    sessions.filter((session) => ids.includes(session.id)),
  )
  apiMock.querySessionControl.mockImplementation(
    async (request: { query: { archived?: boolean; interrupted?: boolean } }) => ({
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: 'project-sessions',
      outcome: {
        operation: 'list',
        sessions: sessions
          .filter(
            (session) =>
              !request.query.interrupted &&
              Boolean(session.archived) === Boolean(request.query.archived),
          )
          .map((session) => ({
            sessionId: session.id,
            title: session.title,
            projectPath: session.projectPath,
            archived: Boolean(session.archived),
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            lineageRole: 'independent',
            directWorkerCount: 0,
          })),
      },
    }),
  )
}

function resetStores(session = makeSession()) {
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: PROJECT_PATH,
      selectedModel: SupportedModelId('openai/gpt-5'),
      recentProjects: [PROJECT_PATH],
    },
    isLoaded: true,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    baseProviderModels: [],
    providerModels: [],
  })
  useChatStore.setState({
    sessions: [session],
    sessionById: new Map(),
    missingSessionIds: new Set(),
    draftSession: null,
    activeSessionId: SESSION_ID,
    activeSession: null,
    error: null,
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: [session],
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
  })
  useSessionStatusStore.setState({
    statuses: new Map(),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
  })
  useUIStore.setState({
    ...useUIStore.getInitialState(),
    sidebarOpen: true,
  })
  useSidebarViewStore.setState({ sessionSortMode: 'recent', projectExpandedByPath: {} })
}

describe('Sidebar project actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routerState.pathname = '/'
    apiMock.archiveSession.mockResolvedValue(undefined)
    apiMock.deleteSession.mockResolvedValue(undefined)
    apiMock.closeBrowserPreview.mockResolvedValue(undefined)
    apiMock.getGitStatus.mockResolvedValue(null)
    apiMock.getProjectPreferences.mockResolvedValue(null)
    apiMock.getProviderModels.mockResolvedValue([])
    apiMock.listActiveRuns.mockResolvedValue([])
    apiMock.listGitBranches.mockResolvedValue({ ok: true, branches: [] })
    mockProjectSessions([makeSession()])
    apiMock.openPath.mockResolvedValue(undefined)
    apiMock.showConfirm.mockResolvedValue(false)
    apiMock.unregisterBrowserPreviewOwner.mockResolvedValue(undefined)
    apiMock.updateSettings.mockResolvedValue({ ok: true })
    resetStores()
  })

  it('uses the project row as a disclosure toggle without selecting a new draft', () => {
    render(<Sidebar />)

    expect(screen.getByText('Existing project session')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /collapse openwaggle/i }))

    expect(screen.queryByText('Existing project session')).toBeNull()
    expect(apiMock.updateSettings).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('records a collapsed project in the persisted view store', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /collapse openwaggle/i }))

    expect(useSidebarViewStore.getState().projectExpandedByPath).toEqual({
      [PROJECT_PATH]: false,
    })
  })

  it('renders a project collapsed when the restored state says so', () => {
    useSidebarViewStore.setState({ projectExpandedByPath: { [PROJECT_PATH]: false } })

    render(<Sidebar />)

    expect(screen.queryByText('Existing project session')).toBeNull()
    expect(screen.getByRole('button', { name: /expand openwaggle/i })).toBeInTheDocument()
  })

  it('treats a project it has never seen as expanded', () => {
    render(<Sidebar />)

    expect(screen.getByText('Existing project session')).toBeInTheDocument()
  })

  it('hides collapsed sidebar contents from accessibility and hit testing', () => {
    useUIStore.setState({ sidebarOpen: false })

    const { container } = render(<Sidebar />)
    const sidebarWrapper = container.firstElementChild

    expect(sidebarWrapper).toHaveAttribute('aria-hidden', 'true')
    expect(sidebarWrapper).toHaveAttribute('inert')
    expect(sidebarWrapper).toHaveClass('pointer-events-none', 'w-0')
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()
  })

  it('hides the app sidebar while the settings overlay is active', () => {
    routerState.pathname = '/settings'

    const { container } = render(<Sidebar />)
    const sidebarWrapper = container.firstElementChild

    expect(sidebarWrapper).toHaveAttribute('aria-hidden', 'true')
    expect(sidebarWrapper).toHaveAttribute('inert')
    expect(sidebarWrapper).toHaveClass('pointer-events-none', 'w-0')
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()
  })

  it('starts a draft for a project from the hover new-session action', async () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /new session in openwaggle/i }))

    await waitFor(() => {
      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(useChatStore.getState().draftSession).toEqual({ projectPath: PROJECT_PATH })
      expect(usePreferencesStore.getState().settings.projectPath).toBe(PROJECT_PATH)
      expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
    })
    const draftRow = screen.getByRole('button', { name: /draft session in openwaggle/i })
    expect(draftRow).toBeInTheDocument()
    expect(draftRow).toHaveClass('w-full', 'bg-bg-active')
    expect(draftRow).not.toHaveClass('mx-2')
  })

  it('opens the project folder from the project action menu', async () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /open project actions for openwaggle/i }))
    fireEvent.click(screen.getByRole('button', { name: /open in finder/i }))

    await waitFor(() => {
      expect(apiMock.openPath).toHaveBeenCalledWith(PROJECT_PATH)
    })
  })

  it('archives all visible project sessions with a count-aware confirmation', async () => {
    apiMock.showConfirm.mockResolvedValueOnce(true)
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /open project actions for openwaggle/i }))
    fireEvent.click(screen.getByRole('button', { name: /archive 1 session/i }))

    await waitFor(() => {
      expect(apiMock.showConfirm).toHaveBeenCalledWith(
        expect.stringContaining('Archive 1 session'),
        'Project: openwaggle',
      )
      expect(apiMock.showConfirm.mock.calls[0]?.join('\n')).not.toContain(PROJECT_PATH)
      expect(apiMock.archiveSession).toHaveBeenCalledWith(SESSION_ID)
      expect(apiMock.unregisterBrowserPreviewOwner).toHaveBeenCalledWith(String(SESSION_ID))
      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('permanently removes all project sessions and project references', async () => {
    const cancellation = Promise.withResolvers<void>()
    const callOrder: string[] = []
    apiMock.cancelAgent.mockImplementationOnce(async () => {
      callOrder.push('cancel:start')
      await cancellation.promise
      callOrder.push('cancel:end')
    })
    apiMock.deleteSession.mockImplementation(async () => {
      callOrder.push('delete')
    })
    mockProjectSessions([makeSession(), makeArchivedSession()])
    apiMock.listActiveRuns.mockResolvedValueOnce([
      {
        sessionId: SESSION_ID,
        model: SupportedModelId('openai/gpt-5'),
        mode: 'classic',
        startedAt: 1,
      },
    ])
    apiMock.showConfirm.mockResolvedValueOnce(true)
    usePreferencesStore.setState((state) => ({
      settings: {
        ...state.settings,
        projectDisplayNames: { [PROJECT_PATH]: 'OpenWaggle Local' },
        skillTogglesByProject: { [PROJECT_PATH]: { 'code-review': true } },
      },
    }))

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /open project actions for openwaggle/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))

    await waitFor(() => {
      expect(callOrder).toEqual(['cancel:start'])
    })
    expect(apiMock.deleteSession).not.toHaveBeenCalled()

    cancellation.resolve()

    await waitFor(() => {
      expect(apiMock.showConfirm).toHaveBeenCalledWith(
        expect.stringContaining('permanently delete 2 sessions'),
        'Project: OpenWaggle Local\nThis cannot be undone.',
      )
      expect(apiMock.showConfirm.mock.calls[0]?.join('\n')).not.toContain(PROJECT_PATH)
      expect(apiMock.cancelAgent).toHaveBeenCalledWith(SESSION_ID)
      expect(apiMock.deleteSession).toHaveBeenCalledWith(SESSION_ID)
      expect(apiMock.deleteSession).toHaveBeenCalledWith(ARCHIVED_SESSION_ID)
      expect(apiMock.unregisterBrowserPreviewOwner).toHaveBeenCalledWith(String(SESSION_ID))
      expect(apiMock.unregisterBrowserPreviewOwner).toHaveBeenCalledWith(
        String(ARCHIVED_SESSION_ID),
      )
      expect(apiMock.updateSettings).toHaveBeenCalledWith({
        projectPath: null,
        recentProjects: [],
        projectDisplayNames: {},
        skillTogglesByProject: {},
      })
      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
    })
    expect(callOrder).toEqual(['cancel:start', 'cancel:end', 'delete', 'delete'])
  })
})
