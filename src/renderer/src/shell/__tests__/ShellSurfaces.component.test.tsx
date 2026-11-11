import type { UpdateStatus } from '@shared/types/updater'
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalActivityStore, useTerminalStore } from '@/features/terminal'
import {
  DIFF_RIGHT_SIDEBAR_REQUEST,
  useRightSidebarCoordinator,
} from '@/shared/lib/right-sidebar-coordinator'
import { Button } from '@/shared/ui/Button'
import { FeedbackButton } from '../HeaderFeedbackButton'
import { useUIStore } from '../ui-store'
import { useFullscreen } from '../useFullscreen'
import { WorkspaceTerminal } from '../WorkspaceTerminal'
import { useWorkspacePanelStore } from '../workspace-panel-store'
import { renderWorkspaceShell } from './workspace-shell-render.test-harness'
import { resetWorkspaceShellStores } from './workspace-shell.test-harness'

type FullscreenHandler = (isFullscreen: boolean) => void
type UpdateStatusHandler = (status: UpdateStatus) => void

/*
 * Only the preload and the surfaces of other features are replaced: the shell, its right panel,
 * terminal drawer, toasts and monitors are the real ones, under a memory router.
 */
const shellMocks = vi.hoisted(() => {
  const fullscreen: { current: FullscreenHandler | null } = { current: null }
  const updateStatus: { current: UpdateStatusHandler | null } = { current: null }
  return {
    fullscreen,
    updateStatus,
    listActiveRuns: vi.fn(async () => []),
    unsubscribeFullscreen: vi.fn(),
    workspaceLifecycle: vi.fn(),
  }
})

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    getDesktopNativeAdmissionIssue: async () => null,
    closeBrowserPreview: async () => undefined,
    getTerminalActivitySnapshot: async () => ({ revision: 0, summaries: [], truncated: false }),
    listActiveRuns: shellMocks.listActiveRuns,
    onFullscreenChanged: (handler: FullscreenHandler) => {
      shellMocks.fullscreen.current = handler
      return shellMocks.unsubscribeFullscreen
    },
    onUpdateStatus: (handler: UpdateStatusHandler) => {
      shellMocks.updateStatus.current = handler
      return () => undefined
    },
    registerBrowserPreviewOwner: async () => undefined,
    setCurrentBrowserPreview: async () => undefined,
    unregisterBrowserPreviewOwner: async () => undefined,
  }),
}))
// Other features' surfaces, each with its own tests: markers show which chrome the shell mounts.
vi.mock('@/features/sidebar/components', () => ({ Sidebar: () => <aside>Sidebar</aside> }))
vi.mock('../Header', () => ({ Header: () => <header>Header</header> }))
// The notice after an Electron install reads its state through React Query; not under test here.
vi.mock('../ElectronMigrationNotice', () => ({ ElectronMigrationNotice: () => null }))
vi.mock('../right-panel/RightPanelHost', () => ({ RightPanelHost: () => null }))
// App data loading and shortcuts, covered by useWorkspaceLifecycle*.component.test.tsx.
vi.mock('../useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => shellMocks.workspaceLifecycle(),
}))
// Lazily loaded surfaces: the feedback form has its own tests, the floating preview needs a
// native view, and either could resolve its import after this file's cases ended.
vi.mock('@/features/feedback/components/FeedbackModal', () => ({
  FeedbackModal: () => <div>Feedback modal</div>,
}))
vi.mock('../WorkspaceBrowserFloatingPreview', () => ({
  WorkspaceBrowserFloatingPreview: () => null,
}))
// xterm needs a canvas jsdom lacks; the panel shows its owner and its close action.
vi.mock('@/features/terminal/components', () => ({
  TerminalPanel: ({ ownerKey, onClose }: { ownerKey: string; onClose: () => void }) => (
    <section aria-label={`Terminal panel ${ownerKey}`}>
      Terminal panel
      <Button variant="unstyled" type="button" onClick={onClose}>
        Close terminal
      </Button>
    </section>
  ),
}))

function dockTerminal() {
  const terminalId = useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
  const tab = useTerminalStore
    .getState()
    .groups['draft:/repo']?.tabs.find((entry) => entry.panes[0]?.terminalId === terminalId)
  if (tab === undefined) throw new Error('Expected dockable terminal tab')
  useTerminalStore.getState().moveTab('draft:/repo', 'side-panel:draft:/repo', tab.id)
  useWorkspacePanelStore.getState().showTerminal('draft:/repo')
}

function resetStores() {
  resetWorkspaceShellStores()
  useTerminalActivityStore.getState().reset()
}

describe('shell surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shellMocks.fullscreen.current = null
    shellMocks.updateStatus.current = null
    resetStores()
  })
  afterEach(resetStores)

  it('opens the feedback callback from the header button without forwarding the click event', () => {
    const onOpen = vi.fn()

    render(<FeedbackButton onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }))

    expect(onOpen).toHaveBeenCalledOnce()
    // A forwarded click event looked like an AgentErrorInfo and crashed the modal.
    expect(onOpen).toHaveBeenCalledWith()
  })

  it.each(['/', '/settings', '/settings/actions', '/usage'])(
    'mounts route-appropriate chrome and shared workspace controls at %s',
    async (pathname) => {
      useUIStore.setState({ feedbackModalOpen: true, activeView: 'chat' })
      useTerminalStore.getState().createTerminal('draft:/repo', '/repo')
      useTerminalStore.getState().setPanelOpen('draft:/repo', true)

      await renderWorkspaceShell(pathname)

      expect(screen.getByText('Sidebar')).toBeInTheDocument()
      expect(screen.queryByText('Header') !== null).toBe(pathname === '/')
      expect(screen.getByText('Route content')).toBeInTheDocument()
      expect(await screen.findByText('Terminal panel')).toBeInTheDocument()
      expect(await screen.findByText('Feedback modal')).toBeInTheDocument()
      // The monitors run on every route: background Runs are restored and updates announced.
      expect(shellMocks.workspaceLifecycle).toHaveBeenCalled()
      expect(shellMocks.listActiveRuns).toHaveBeenCalled()
      act(() => shellMocks.updateStatus.current?.({ type: 'downloaded', version: '9.9.9' }))
      expect(await screen.findByText('Update v9.9.9 ready')).toBeInTheDocument()
    },
  )

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

    await renderWorkspaceShell()

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
    dockTerminal()

    await renderWorkspaceShell()

    fireEvent.click(await screen.findByRole('button', { name: 'Close side panel' }))

    expect(useWorkspacePanelStore.getState().groups['draft:/repo']?.panelOpen).toBe(false)
    expect(useTerminalStore.getState().groups['side-panel:draft:/repo']?.tabs).toHaveLength(1)
  })

  it('creates and focuses another side-panel terminal from the surface chrome', async () => {
    dockTerminal()

    await renderWorkspaceShell()

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
    dockTerminal()

    await renderWorkspaceShell()

    const routeContent = screen.getByText('Route content')
    const main = routeContent.closest('[data-right-sidebar-main="true"]')
    const shell = await screen.findByTestId('workspace-right-panel')
    const sidebar = shell.closest('[data-right-sidebar-shell="true"]')
    fireEvent.click(within(shell).getByRole('button', { name: 'Maximize panel', pressed: false }))

    expect(screen.getByText('Route content')).toBe(routeContent)
    expect(main).toHaveAttribute('inert')
    expect(sidebar).toHaveStyle({ width: '100%' })
    expect(useWorkspacePanelStore.getState().groups['draft:/repo']?.maximized).toBe(true)

    fireEvent.click(within(shell).getByRole('button', { name: 'Maximize panel', pressed: true }))

    expect(screen.getByText('Route content')).toBe(routeContent)
    expect(main).not.toHaveAttribute('inert')
    expect(sidebar).toHaveAttribute('data-right-sidebar-maximized', 'false')
    expect(useWorkspacePanelStore.getState().groups['draft:/repo']?.maximized).toBe(false)
  })

  it('suspends the workspace panel while a route panel owns the right side', async () => {
    dockTerminal()

    await renderWorkspaceShell()

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
    const fullscreenHandler = shellMocks.fullscreen.current
    if (!fullscreenHandler) {
      throw new Error('Expected fullscreen handler to be registered')
    }

    act(() => fullscreenHandler(true))

    expect(result.current).toBe(true)
    unmount()
    expect(shellMocks.unsubscribeFullscreen).toHaveBeenCalledOnce()
  })
})
