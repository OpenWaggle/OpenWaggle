import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { ChatRouteSurface } from '../-chat-route-surface'

interface ExtensionRightSidebarPanel {
  readonly kind: 'extension-side-panel'
  readonly extensionId: string
  readonly sidePanelId: string
}
type RightSidebarPanel = 'diff' | 'resources' | 'session-tree' | ExtensionRightSidebarPanel
interface ShellState {
  readonly lastRightSidebarPanel: RightSidebarPanel
  readonly setLastRightSidebarPanel: (panel: RightSidebarPanel) => void
}

const routeSurfaceMocks = vi.hoisted(() => {
  let lastRightSidebarPanel: RightSidebarPanel = 'diff'
  const setLastRightSidebarPanel = vi.fn((panel: RightSidebarPanel) => {
    lastRightSidebarPanel = panel
  })
  return {
    setLastPanel: (panel: RightSidebarPanel) => {
      lastRightSidebarPanel = panel
    },
    shellState: (): ShellState => ({ lastRightSidebarPanel, setLastRightSidebarPanel }),
    setLastRightSidebarPanel,
    chatRouteEffects: vi.fn(),
    sidePanelRefetch: vi.fn(),
  }
})

vi.mock('@/features/chat/hooks', () => ({
  useChatPanelSections: () => ({
    diff: { projectPath: '/repo', onSendMessage: vi.fn() },
    transcript: { messages: [] },
  }),
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

vi.mock('@/features/session-summary', () => ({
  SessionResourcesPanel: ({
    target,
    onClose,
    onTargetChange,
  }: {
    readonly target: { readonly view: 'sources' | 'outputs'; readonly resourceId?: string }
    readonly onClose: () => void
    readonly onTargetChange: (target: { readonly view: 'sources' | 'outputs' }) => void
  }) => (
    <aside>
      Session resources panel: {target.view}/{target.resourceId ?? 'all'}
      <Button variant="unstyled" type="button" onClick={() => onTargetChange({ view: 'sources' })}>
        Show sources
      </Button>
      <Button variant="unstyled" type="button" onClick={onClose}>
        Close resources
      </Button>
    </aside>
  ),
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

type ChatRouteProps = Parameters<typeof ChatRouteSurface>[0]

function renderChatRoute({
  workspace = { branchId: null, nodeId: null, sessionId: 'session-1' },
  rightSidebar,
  actions = {},
}: {
  readonly workspace?: ChatRouteProps['workspace']
  readonly rightSidebar: Partial<ChatRouteProps['rightSidebar']>
  readonly actions?: Partial<ChatRouteProps['rightSidebarActions']>
}) {
  const rightSidebarActions = {
    onDiffOpenChange: vi.fn(),
    onExtensionSidePanelOpenChange: vi.fn(),
    onResourcesTargetChange: vi.fn(),
    onSessionTreeOpenChange: vi.fn(),
    onWorkspaceFileOpenChange: vi.fn(),
    ...actions,
  }
  render(
    <ChatRouteSurface
      workspace={workspace}
      rightSidebar={{
        diffOpen: false,
        extensionSidePanel: null,
        resourcesTarget: null,
        sessionTreeOpen: false,
        workspaceFile: null,
        ...rightSidebar,
      }}
      rightSidebarActions={rightSidebarActions}
    />,
  )
  return rightSidebarActions
}

describe('route surfaces', () => {
  beforeEach(() => {
    routeSurfaceMocks.setLastPanel('diff')
    routeSurfaceMocks.setLastRightSidebarPanel.mockClear()
    routeSurfaceMocks.chatRouteEffects.mockClear()
    routeSurfaceMocks.sidePanelRefetch.mockClear()
  })

  it('renders chat content with the active diff sidebar and closes it through route state', async () => {
    const onDiffOpenChange = vi.fn()
    const onSessionTreeOpenChange = vi.fn()

    renderChatRoute({
      workspace: { branchId: 'branch-1', nodeId: 'node-1', sessionId: 'session-1' },
      rightSidebar: { diffOpen: true },
      actions: { onDiffOpenChange, onSessionTreeOpenChange },
    })

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

    renderChatRoute({
      rightSidebar: { sessionTreeOpen: true },
      actions: { onDiffOpenChange, onSessionTreeOpenChange },
    })

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

    renderChatRoute({
      rightSidebar: {
        extensionSidePanel: {
          extensionId: 'sample-extension',
          sidePanelId: 'sample.side-panel',
        },
      },
      actions: { onDiffOpenChange, onExtensionSidePanelOpenChange, onSessionTreeOpenChange },
    })

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

  it('binds the resource sidebar to its explicit view and resource target', () => {
    const onResourcesTargetChange = vi.fn()

    renderChatRoute({
      rightSidebar: { resourcesTarget: { view: 'outputs', resourceId: 'created-pr' } },
      actions: { onResourcesTargetChange },
    })

    expect(screen.getByText('Session resources panel: outputs/created-pr')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }))
    expect(onResourcesTargetChange).toHaveBeenCalledWith({ view: 'sources' })

    fireEvent.click(screen.getByRole('button', { name: 'Close resources' }))
    expect(onResourcesTargetChange).toHaveBeenCalledWith(null)
  })
})
