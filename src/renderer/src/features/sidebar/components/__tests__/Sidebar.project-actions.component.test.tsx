import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { Sidebar } from '../Sidebar'

const {
  archiveSessionMock,
  cancelAgentMock,
  deleteSessionMock,
  getGitStatusMock,
  getProjectPreferencesMock,
  getProviderModelsMock,
  listActiveRunsMock,
  listArchivedSessionsMock,
  listGitBranchesMock,
  navigateMock,
  openPathMock,
  routerState,
  showConfirmMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  archiveSessionMock: vi.fn(),
  cancelAgentMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  getGitStatusMock: vi.fn(),
  getProjectPreferencesMock: vi.fn(),
  getProviderModelsMock: vi.fn(),
  listActiveRunsMock: vi.fn(),
  listArchivedSessionsMock: vi.fn(),
  listGitBranchesMock: vi.fn(),
  navigateMock: vi.fn(),
  openPathMock: vi.fn(),
  routerState: { pathname: '/' },
  showConfirmMock: vi.fn(),
  updateSettingsMock: vi.fn(),
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

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    archiveSession: archiveSessionMock,
    cancelAgent: cancelAgentMock,
    deleteSession: deleteSessionMock,
    getGitStatus: getGitStatusMock,
    getProjectPreferences: getProjectPreferencesMock,
    getProviderModels: getProviderModelsMock,
    listActiveRuns: listActiveRunsMock,
    listArchivedSessions: listArchivedSessionsMock,
    listGitBranches: listGitBranchesMock,
    openPath: openPathMock,
    showConfirm: showConfirmMock,
    updateSettings: updateSettingsMock,
  },
}))

const PROJECT_PATH = '/repo/openwaggle'
const SESSION_ID = SessionId('session-project-1')
const ARCHIVED_SESSION_ID = SessionId('session-project-archived')

function createDeferred() {
  let resolveDeferred = () => {}
  const promise = new Promise<void>((resolve) => {
    resolveDeferred = resolve
  })
  return { promise, resolve: resolveDeferred }
}

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
  return {
    ...makeSession(),
    id: ARCHIVED_SESSION_ID,
    title: 'Archived project session',
    updatedAt: 5,
  }
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
}

describe('Sidebar project actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routerState.pathname = '/'
    archiveSessionMock.mockResolvedValue(undefined)
    deleteSessionMock.mockResolvedValue(undefined)
    getGitStatusMock.mockResolvedValue(null)
    getProjectPreferencesMock.mockResolvedValue(null)
    getProviderModelsMock.mockResolvedValue([])
    listActiveRunsMock.mockResolvedValue([])
    listArchivedSessionsMock.mockResolvedValue([])
    listGitBranchesMock.mockResolvedValue({ ok: true, branches: [] })
    openPathMock.mockResolvedValue(undefined)
    showConfirmMock.mockResolvedValue(false)
    updateSettingsMock.mockResolvedValue({ ok: true })
    resetStores()
  })

  it('uses the project row as a disclosure toggle without selecting a new draft', () => {
    render(<Sidebar />)

    expect(screen.getByText('Existing project session')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /collapse openwaggle/i }))

    expect(screen.queryByText('Existing project session')).toBeNull()
    expect(updateSettingsMock).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
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
      expect(openPathMock).toHaveBeenCalledWith(PROJECT_PATH)
    })
  })

  it('archives all visible project sessions with a count-aware confirmation', async () => {
    showConfirmMock.mockResolvedValueOnce(true)
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /open project actions for openwaggle/i }))
    fireEvent.click(screen.getByRole('button', { name: /archive 1 session/i }))

    await waitFor(() => {
      expect(showConfirmMock).toHaveBeenCalledWith(
        expect.stringContaining('Archive 1 session'),
        expect.stringContaining(PROJECT_PATH),
      )
      expect(archiveSessionMock).toHaveBeenCalledWith(SESSION_ID)
      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('permanently removes all project sessions and project references', async () => {
    const cancellation = createDeferred()
    const callOrder: string[] = []
    cancelAgentMock.mockImplementationOnce(async () => {
      callOrder.push('cancel:start')
      await cancellation.promise
      callOrder.push('cancel:end')
    })
    deleteSessionMock.mockImplementation(async () => {
      callOrder.push('delete')
    })
    listArchivedSessionsMock.mockResolvedValueOnce([makeArchivedSession()])
    listActiveRunsMock.mockResolvedValueOnce([
      {
        sessionId: SESSION_ID,
        model: SupportedModelId('openai/gpt-5'),
        mode: 'classic',
        startedAt: 1,
      },
    ])
    showConfirmMock.mockResolvedValueOnce(true)
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
    expect(deleteSessionMock).not.toHaveBeenCalled()

    cancellation.resolve()

    await waitFor(() => {
      expect(showConfirmMock).toHaveBeenCalledWith(
        expect.stringContaining('permanently delete 2 sessions'),
        expect.stringContaining(PROJECT_PATH),
      )
      expect(cancelAgentMock).toHaveBeenCalledWith(SESSION_ID)
      expect(deleteSessionMock).toHaveBeenCalledWith(SESSION_ID)
      expect(deleteSessionMock).toHaveBeenCalledWith(ARCHIVED_SESSION_ID)
      expect(updateSettingsMock).toHaveBeenCalledWith({
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
