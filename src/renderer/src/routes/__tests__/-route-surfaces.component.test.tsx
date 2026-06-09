import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { ChatRouteSurface } from '../-chat-route-surface'
import { SettingsRouteSurface } from '../-settings-route-surface'
import { SkillsRouteSurface } from '../-skills-route-surface'

type SettingsTab =
  | 'general'
  | 'configuration'
  | 'waggle'
  | 'extensions'
  | 'mcp'
  | 'personalization'
  | 'git'
  | 'environments'
  | 'worktrees'
  | 'archived'
  | 'connections'
interface ExtensionRightSidebarPanel {
  readonly kind: 'extension-side-panel'
  readonly extensionId: string
  readonly sidePanelId: string
}
type RightSidebarPanel = 'diff' | 'session-tree' | ExtensionRightSidebarPanel
interface RouterState {
  readonly location: {
    readonly pathname: string
  }
}
interface ShellState {
  readonly lastRightSidebarPanel: RightSidebarPanel
  readonly setLastRightSidebarPanel: (panel: RightSidebarPanel) => void
}

const routeSurfaceMocks = vi.hoisted(() => {
  let pathname = '/settings/general'
  let lastRightSidebarPanel: RightSidebarPanel = 'diff'
  const setLastRightSidebarPanel = vi.fn((panel: RightSidebarPanel) => {
    lastRightSidebarPanel = panel
  })
  return {
    setPathname: (nextPathname: string) => {
      pathname = nextPathname
    },
    setLastPanel: (panel: RightSidebarPanel) => {
      lastRightSidebarPanel = panel
    },
    routerState: (): RouterState => ({ location: { pathname } }),
    shellState: (): ShellState => ({ lastRightSidebarPanel, setLastRightSidebarPanel }),
    setLastRightSidebarPanel,
    chatRouteEffects: vi.fn(),
    sidePanelRefetch: vi.fn(),
  }
})

vi.mock('@tanstack/react-router', () => ({
  useRouterState: <T,>(input: { readonly select: (state: RouterState) => T }) =>
    input.select(routeSurfaceMocks.routerState()),
}))

vi.mock('@/features/chat/hooks', () => ({
  useChatPanelSections: () => ({ diff: { projectPath: '/repo', onSendMessage: vi.fn() } }),
}))

vi.mock('@/features/chat/components', () => ({
  ChatPanelContent: ({ onOpenSessionTree }: { readonly onOpenSessionTree: () => void }) => (
    <main>
      Chat content
      <Button variant="unstyled" type="button" onClick={onOpenSessionTree}>
        Open tree
      </Button>
    </main>
  ),
  loadChatDiffPane: () =>
    Promise.resolve({
      default: ({ onClose }: { readonly onClose: () => void }) => (
        <aside>
          Diff pane
          <Button variant="unstyled" type="button" onClick={onClose}>
            Close diff
          </Button>
        </aside>
      ),
    }),
}))

vi.mock('@/features/session-tree/components', () => ({
  loadSessionTreePanel: () =>
    Promise.resolve({
      default: ({ onClose }: { readonly onClose: () => void }) => (
        <aside>
          Session Tree panel
          <Button variant="unstyled" type="button" onClick={onClose}>
            Close tree
          </Button>
        </aside>
      ),
    }),
}))

vi.mock('@/features/extensions', () => ({
  ExtensionSidePanelSurface: ({
    target,
    onClose,
  }: {
    readonly target: { readonly extensionId: string; readonly sidePanelId: string }
    readonly onClose: () => void
  }) => (
    <aside>
      Extension side panel {target.extensionId}/{target.sidePanelId}
      <Button variant="unstyled" type="button" onClick={onClose}>
        Close extension side panel
      </Button>
    </aside>
  ),
  useExtensionSidePanelContributions: () => ({
    error: null,
    loading: false,
    projectPaths: ['/repo'],
    refetch: routeSurfaceMocks.sidePanelRefetch,
    registry: null,
  }),
}))

vi.mock('@/features/settings/components', () => ({
  AppSettingsView: ({ activeTab }: { readonly activeTab: SettingsTab }) => (
    <section>Settings tab: {activeTab}</section>
  ),
}))

vi.mock('@/features/skills/components', () => ({
  SkillsPanel: () => <section>Skills panel</section>,
}))

vi.mock('@/shared/ui/PanelErrorBoundary', () => ({
  PanelErrorBoundary: ({ children }: { readonly children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/shared/ui/RightSidebarLayout', () => ({
  RightSidebarLayout: ({
    children,
    onOpenChange,
    sidebar,
  }: {
    readonly children: React.ReactNode
    readonly onOpenChange: (open: boolean) => void
    readonly sidebar: React.ReactNode
  }) => (
    <section>
      {children}
      {sidebar}
      <Button variant="unstyled" type="button" onClick={() => onOpenChange(false)}>
        Close right sidebar
      </Button>
    </section>
  ),
}))

vi.mock('@/shell', () => ({
  CHAT_MIN_WIDTH: 420,
  DIFF_PANEL_MAX: 900,
  DIFF_PANEL_MIN: 360,
  SETTINGS_TABS: ['general', 'waggle', 'extensions', 'mcp', 'archived', 'connections'] as const,
  useUIStore: <T,>(selector: (state: ShellState) => T) => selector(routeSurfaceMocks.shellState()),
}))

vi.mock('../-chat-route-effects', () => ({
  useChatRouteEffects: routeSurfaceMocks.chatRouteEffects,
}))

describe('route surfaces', () => {
  beforeEach(() => {
    routeSurfaceMocks.setPathname('/settings/general')
    routeSurfaceMocks.setLastPanel('diff')
    routeSurfaceMocks.setLastRightSidebarPanel.mockClear()
    routeSurfaceMocks.chatRouteEffects.mockClear()
    routeSurfaceMocks.sidePanelRefetch.mockClear()
  })

  it('derives the settings tab from the current route when the route contains a tab segment', () => {
    routeSurfaceMocks.setPathname('/settings/extensions')

    render(<SettingsRouteSurface tab="general" />)

    expect(screen.getByText('Settings tab: extensions')).toBeInTheDocument()
  })

  it('falls back to the route-provided settings tab for non-tab paths', () => {
    routeSurfaceMocks.setPathname('/settings/unknown')

    render(<SettingsRouteSurface tab="waggle" />)

    expect(screen.getByText('Settings tab: waggle')).toBeInTheDocument()
  })

  it('wraps the skills panel in its route surface', () => {
    render(<SkillsRouteSurface />)

    expect(screen.getByText('Skills panel')).toBeInTheDocument()
  })

  it('renders chat content with the active diff sidebar and closes it through route state', async () => {
    const onDiffOpenChange = vi.fn()
    const onSessionTreeOpenChange = vi.fn()

    render(
      <ChatRouteSurface
        workspace={{ branchId: 'branch-1', nodeId: 'node-1', sessionId: 'session-1' }}
        rightSidebar={{ diffOpen: true, extensionSidePanel: null, sessionTreeOpen: false }}
        rightSidebarActions={{
          onDiffOpenChange,
          onExtensionSidePanelOpenChange: vi.fn(),
          onSessionTreeOpenChange,
        }}
      />,
    )

    expect(screen.getByText('Chat content')).toBeInTheDocument()
    expect(await screen.findByText('Diff pane')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }))

    expect(routeSurfaceMocks.chatRouteEffects).toHaveBeenCalledWith({
      branchId: 'branch-1',
      diffOpen: true,
      nodeId: 'node-1',
      sessionId: 'session-1',
    })
    expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith('diff')
    expect(onDiffOpenChange).toHaveBeenCalledWith(false)
    expect(onSessionTreeOpenChange).not.toHaveBeenCalled()
  })

  it('renders Session Tree when that panel is open and routes close events to the tree toggle', async () => {
    const onDiffOpenChange = vi.fn()
    const onSessionTreeOpenChange = vi.fn()

    render(
      <ChatRouteSurface
        workspace={{ branchId: null, nodeId: null, sessionId: 'session-1' }}
        rightSidebar={{ diffOpen: false, extensionSidePanel: null, sessionTreeOpen: true }}
        rightSidebarActions={{
          onDiffOpenChange,
          onExtensionSidePanelOpenChange: vi.fn(),
          onSessionTreeOpenChange,
        }}
      />,
    )

    expect(await screen.findByText('Session Tree panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }))

    expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith('session-tree')
    expect(onSessionTreeOpenChange).toHaveBeenCalledWith(false)
    expect(onDiffOpenChange).not.toHaveBeenCalled()
  })

  it('renders extension side panels from route state and routes close events to extension search', async () => {
    const onDiffOpenChange = vi.fn()
    const onSessionTreeOpenChange = vi.fn()
    const onExtensionSidePanelOpenChange = vi.fn()

    render(
      <ChatRouteSurface
        workspace={{ branchId: null, nodeId: null, sessionId: 'session-1' }}
        rightSidebar={{
          diffOpen: false,
          extensionSidePanel: {
            extensionId: 'sample-extension',
            sidePanelId: 'sample.side-panel',
          },
          sessionTreeOpen: false,
        }}
        rightSidebarActions={{
          onDiffOpenChange,
          onExtensionSidePanelOpenChange,
          onSessionTreeOpenChange,
        }}
      />,
    )

    expect(
      await screen.findByText('Extension side panel sample-extension/sample.side-panel'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }))

    expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith({
      kind: 'extension-side-panel',
      extensionId: 'sample-extension',
      sidePanelId: 'sample.side-panel',
    })
    expect(onExtensionSidePanelOpenChange).toHaveBeenCalledWith(false, {
      extensionId: 'sample-extension',
      sidePanelId: 'sample.side-panel',
    })
    expect(onDiffOpenChange).not.toHaveBeenCalled()
    expect(onSessionTreeOpenChange).not.toHaveBeenCalled()
  })
})
