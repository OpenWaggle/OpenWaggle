import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalActivityStore, useTerminalStore } from '@/features/terminal'
import {
  DIFF_RIGHT_SIDEBAR_REQUEST,
  useRightSidebarCoordinator,
} from '@/shared/lib/right-sidebar-coordinator'
import { Button } from '@/shared/ui/Button'
import { FeedbackButton } from '../HeaderFeedbackButton'
import { useUIStore } from '../ui-store'
import { useFullscreen } from '../useFullscreen'
import { WorkspaceShell } from '../WorkspaceShell'
import { WorkspaceTerminal } from '../WorkspaceTerminal'
import { useWorkspacePanelStore } from '../workspace-panel-store'

type FullscreenHandler = (isFullscreen: boolean) => void

const shellMocks = vi.hoisted(() => {
  let fullscreenHandler: FullscreenHandler | null = null
  const unsubscribeFullscreen = vi.fn()
  const unsubscribeBrowserPreviewState = vi.fn()
  const unsubscribeBrowserPreviewOpenRequest = vi.fn()
  const unsubscribeBrowserPreviewOpenRequestCancellation = vi.fn()
  const unsubscribeTerminalActivity = vi.fn()
  return {
    backgroundRunMonitor: vi.fn(),
    autoUpdater: vi.fn(),
    getTerminalActivitySnapshot: vi.fn(async () => ({
      revision: 0,
      summaries: [],
      truncated: false,
    })),
    getFullscreenHandler: () => fullscreenHandler,
    onBrowserPreviewState: vi.fn(() => unsubscribeBrowserPreviewState),
    onBrowserPreviewOpenRequest: vi.fn(() => unsubscribeBrowserPreviewOpenRequest),
    onBrowserPreviewOpenRequestCancellation: vi.fn(
      () => unsubscribeBrowserPreviewOpenRequestCancellation,
    ),
    onTerminalActivitySnapshot: vi.fn(() => unsubscribeTerminalActivity),
    projectPath: '/repo',
    registerBrowserPreviewOwner: vi.fn(async () => undefined),
    setCurrentBrowserPreview: vi.fn(async () => undefined),
    unregisterBrowserPreviewOwner: vi.fn(async () => undefined),
    unsubscribeBrowserPreviewState,
    unsubscribeBrowserPreviewOpenRequest,
    unsubscribeBrowserPreviewOpenRequestCancellation,
    unsubscribeFullscreen,
    unsubscribeTerminalActivity,
    workspaceLifecycle: vi.fn(),
    onFullscreenChanged: vi.fn((handler: FullscreenHandler) => {
      fullscreenHandler = handler
      return unsubscribeFullscreen
    }),
  }
})

vi.mock('@/features/chat/hooks/useBackgroundRunMonitor', () => ({
  useBackgroundRunMonitor: () => shellMocks.backgroundRunMonitor(),
}))

vi.mock('@/features/feedback/components/FeedbackModal', () => ({
  FeedbackModal: () => <div>Feedback modal</div>,
}))

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: shellMocks.projectPath }),
}))

vi.mock('@/features/sidebar/components/Sidebar', () => ({
  Sidebar: () => <aside>Sidebar</aside>,
}))

vi.mock('@/features/terminal/components', () => ({
  TerminalPanel: ({
    ownerKey,
    onClose,
  }: {
    readonly ownerKey: string
    readonly onClose: () => void
  }) => (
    <section aria-label={`Terminal panel ${ownerKey}`}>
      Terminal panel
      <Button variant="unstyled" type="button" onClick={onClose}>
        Close terminal
      </Button>
    </section>
  ),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getDesktopNativeAdmissionIssue: vi.fn(async () => null),
    closeBrowserPreview: vi.fn(async () => undefined),
    getTerminalActivitySnapshot: shellMocks.getTerminalActivitySnapshot,
    onBrowserPreviewState: shellMocks.onBrowserPreviewState,
    onBrowserPreviewOpenRequest: shellMocks.onBrowserPreviewOpenRequest,
    onBrowserPreviewOpenRequestCancellation: shellMocks.onBrowserPreviewOpenRequestCancellation,
    onFullscreenChanged: shellMocks.onFullscreenChanged,
    onTerminalActivitySnapshot: shellMocks.onTerminalActivitySnapshot,
    registerBrowserPreviewOwner: shellMocks.registerBrowserPreviewOwner,
    setCurrentBrowserPreview: shellMocks.setCurrentBrowserPreview,
    unregisterBrowserPreviewOwner: shellMocks.unregisterBrowserPreviewOwner,
  },
}))

vi.mock('../Header', () => ({ Header: () => <header>Header</header> }))
vi.mock('../ToastOverlay', () => ({ ToastOverlay: () => <div>Toasts</div> }))
vi.mock('../useAutoUpdater', () => ({ useAutoUpdater: () => shellMocks.autoUpdater() }))
vi.mock('../useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => shellMocks.workspaceLifecycle(),
}))

describe('shell surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    useUIStore.setState({ feedbackModalOpen: false, terminalOpen: false })
    useTerminalActivityStore.getState().reset()
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
    useWorkspacePanelStore.setState({ groups: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
  })

  it('opens the feedback callback from the header button without forwarding the click event', () => {
    const onOpen = vi.fn()

    render(<FeedbackButton onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }))

    expect(onOpen).toHaveBeenCalledOnce()
    // openFeedbackModal takes an optional AgentErrorInfo. Forwarding the click
    // event made it a truthy non-error object and crashed the modal.
    expect(onOpen).toHaveBeenCalledWith()
  })

  it('mounts workspace chrome, lifecycle hooks, terminal, and feedback modal from store state', async () => {
    useUIStore.setState({ feedbackModalOpen: true })
    useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
    useTerminalStore.getState().setPanelOpen('draft:/repo', true)

    render(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )

    expect(screen.getByText('Sidebar')).toBeInTheDocument()
    expect(screen.getByText('Header')).toBeInTheDocument()
    expect(screen.getByText('Route content')).toBeInTheDocument()
    expect(await screen.findByText('Terminal panel')).toBeInTheDocument()
    expect(await screen.findByText('Feedback modal')).toBeInTheDocument()
    expect(shellMocks.workspaceLifecycle).toHaveBeenCalledOnce()
    expect(shellMocks.backgroundRunMonitor).toHaveBeenCalledOnce()
    expect(shellMocks.autoUpdater).toHaveBeenCalledOnce()
  })

  it('closes the workspace terminal through the terminal panel close action', async () => {
    useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
    useTerminalStore.getState().setPanelOpen('draft:/repo', true)

    render(<WorkspaceTerminal />)
    fireEvent.click(await screen.findByRole('button', { name: 'Close terminal' }))

    expect(useTerminalStore.getState().groups['draft:/repo']?.panelOpen).toBe(false)
  })

  it('renders an independent right-panel terminal group and returns it to the drawer', async () => {
    useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
    const dockedTerminalId = useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
    const dockedTab = useTerminalStore
      .getState()
      .groups['draft:/repo']?.tabs.find((tab) => tab.panes[0]?.terminalId === dockedTerminalId)
    if (dockedTab === undefined) throw new Error('Expected dockable terminal tab')
    useTerminalStore.getState().moveTab('draft:/repo', 'side-panel:draft:/repo', dockedTab.id)
    useWorkspacePanelStore.getState().showTerminal('draft:/repo')

    render(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )

    const sidePanel = await screen.findByTestId('workspace-right-panel')
    expect(
      await within(sidePanel).findByRole('region', {
        name: 'Terminal panel side-panel:draft:/repo',
      }),
    ).toBeInTheDocument()
    fireEvent.click(within(sidePanel).getByRole('button', { name: 'Close terminal' }))

    expect(useTerminalStore.getState().groups['side-panel:draft:/repo']).toMatchObject({
      panelOpen: false,
      tabs: [],
    })
    expect(useTerminalStore.getState().groups['draft:/repo']?.tabs).toHaveLength(2)
  })

  it('hides the whole right panel while preserving docked terminals', async () => {
    const terminalId = useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
    const tab = useTerminalStore
      .getState()
      .groups['draft:/repo']?.tabs.find((entry) => entry.panes[0]?.terminalId === terminalId)
    if (tab === undefined) throw new Error('Expected dockable terminal tab')
    useTerminalStore.getState().moveTab('draft:/repo', 'side-panel:draft:/repo', tab.id)
    useWorkspacePanelStore.getState().showTerminal('draft:/repo')

    render(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Close side panel' }))

    expect(useWorkspacePanelStore.getState().groups['draft:/repo']?.panelOpen).toBe(false)
    expect(useTerminalStore.getState().groups['side-panel:draft:/repo']?.tabs).toHaveLength(1)
  })

  it('creates and focuses another side-panel terminal from the surface chrome', async () => {
    const terminalId = useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
    const tab = useTerminalStore
      .getState()
      .groups['draft:/repo']?.tabs.find((entry) => entry.panes[0]?.terminalId === terminalId)
    if (tab === undefined) throw new Error('Expected dockable terminal tab')
    useTerminalStore.getState().moveTab('draft:/repo', 'side-panel:draft:/repo', tab.id)
    useWorkspacePanelStore.getState().showTerminal('draft:/repo')

    render(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )

    const sidePanel = await screen.findByTestId('workspace-right-panel')
    fireEvent.click(within(sidePanel).getByRole('button', { name: 'New terminal in side panel' }))

    const sideGroup = useTerminalStore.getState().groups['side-panel:draft:/repo']
    expect(sideGroup?.tabs).toHaveLength(2)
    expect(sideGroup?.panelOpen).toBe(true)
    expect(sideGroup?.tabs.at(-1)?.panes[0]?.terminalId).toBe(sideGroup?.tabs.at(-1)?.activePaneId)
    expect(useWorkspacePanelStore.getState().groups['draft:/repo']).toMatchObject({
      activeSurface: { kind: 'terminal' },
      panelOpen: true,
    })
  })

  it('maximizes and restores the side panel without destroying chat or retained width', async () => {
    const terminalId = useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
    const tab = useTerminalStore
      .getState()
      .groups['draft:/repo']?.tabs.find((entry) => entry.panes[0]?.terminalId === terminalId)
    if (tab === undefined) throw new Error('Expected dockable terminal tab')
    useTerminalStore.getState().moveTab('draft:/repo', 'side-panel:draft:/repo', tab.id)
    useWorkspacePanelStore.getState().showTerminal('draft:/repo')

    render(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )

    const routeContent = screen.getByText('Route content')
    const main = routeContent.closest('[data-right-sidebar-main="true"]')
    const shell = await screen.findByTestId('workspace-right-panel')
    const sidebar = shell.closest('[data-right-sidebar-shell="true"]')
    fireEvent.click(within(shell).getByRole('button', { name: 'Maximize side panel' }))

    expect(screen.getByText('Route content')).toBe(routeContent)
    expect(main).toHaveAttribute('inert')
    expect(sidebar).toHaveStyle({ width: '100%' })
    expect(useWorkspacePanelStore.getState().groups['draft:/repo']?.maximized).toBe(true)

    fireEvent.click(within(shell).getByRole('button', { name: 'Restore side panel' }))

    expect(screen.getByText('Route content')).toBe(routeContent)
    expect(main).not.toHaveAttribute('inert')
    expect(sidebar).toHaveAttribute('data-right-sidebar-maximized', 'false')
    expect(useWorkspacePanelStore.getState().groups['draft:/repo']?.maximized).toBe(false)
  })

  it('suspends the workspace panel while a route panel owns the right side', async () => {
    const terminalId = useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
    const tab = useTerminalStore
      .getState()
      .groups['draft:/repo']?.tabs.find((entry) => entry.panes[0]?.terminalId === terminalId)
    if (tab === undefined) throw new Error('Expected dockable terminal tab')
    useTerminalStore.getState().moveTab('draft:/repo', 'side-panel:draft:/repo', tab.id)
    useWorkspacePanelStore.getState().showTerminal('draft:/repo')

    render(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )

    const workspacePanel = await screen.findByTestId('workspace-right-panel')
    const workspaceShell = workspacePanel.closest('[data-right-sidebar-shell="true"]')
    expect(workspaceShell).not.toBeNull()
    expect(workspaceShell).not.toHaveStyle({ width: '0px' })

    act(() => useRightSidebarCoordinator.getState().claimRoute(DIFF_RIGHT_SIDEBAR_REQUEST))

    expect(workspaceShell).toHaveStyle({ width: '0px' })
    expect(useWorkspacePanelStore.getState().groups['draft:/repo']?.panelOpen).toBe(true)
    expect(useTerminalStore.getState().groups['side-panel:draft:/repo']?.tabs).toHaveLength(1)

    act(() => useWorkspacePanelStore.getState().showTerminal('draft:/repo'))
    expect(workspaceShell).not.toHaveAttribute('inert')
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: 'draft:/repo',
    })
  })

  it('tracks fullscreen state from the preload event subscription and cleans up on unmount', () => {
    const { result, unmount } = renderHook(() => useFullscreen())
    const fullscreenHandler = shellMocks.getFullscreenHandler()
    if (!fullscreenHandler) {
      throw new Error('Expected fullscreen handler to be registered')
    }

    act(() => fullscreenHandler(true))

    expect(result.current).toBe(true)
    unmount()
    expect(shellMocks.unsubscribeFullscreen).toHaveBeenCalledOnce()
  })
})
