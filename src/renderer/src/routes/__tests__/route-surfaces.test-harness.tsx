import { render } from '@testing-library/react'
import { type Mock, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { ChatRouteSurface } from '../-chat-route-surface'

interface ExtensionRightSidebarPanel {
  readonly kind: 'extension-side-panel'
  readonly extensionId: string
  readonly sidePanelId: string
}
type RightSidebarPanel =
  | 'change-request'
  | 'diff'
  | 'resources'
  | 'session-tree'
  | ExtensionRightSidebarPanel
interface ShellState {
  readonly lastRightSidebarPanel: RightSidebarPanel
  readonly setLastRightSidebarPanel: (panel: RightSidebarPanel) => void
}

interface RouteSurfaceMocks {
  readonly setWorkingPath: (path: string | null) => void
  readonly workingPath: () => string | null
  readonly setLastPanel: (panel: RightSidebarPanel) => void
  readonly shellState: () => ShellState
  readonly setLastRightSidebarPanel: Mock<(panel: RightSidebarPanel) => void>
  readonly chatRouteEffects: Mock<() => void>
  readonly sidePanelRefetch: Mock<() => void>
}

const mocks = vi.hoisted(() => {
  let workingPath: string | null = '/repo'
  let lastRightSidebarPanel: RightSidebarPanel = 'diff'
  const setLastRightSidebarPanel = vi.fn((panel: RightSidebarPanel) => {
    lastRightSidebarPanel = panel
  })
  return {
    setWorkingPath: (path: string | null) => {
      workingPath = path
    },
    workingPath: () => workingPath,
    setLastPanel: (panel: RightSidebarPanel) => {
      lastRightSidebarPanel = panel
    },
    shellState: (): ShellState => ({ lastRightSidebarPanel, setLastRightSidebarPanel }),
    setLastRightSidebarPanel,
    chatRouteEffects: vi.fn<() => void>(),
    sidePanelRefetch: vi.fn<() => void>(),
  }
})

export const routeSurfaceMocks: RouteSurfaceMocks = mocks

vi.mock('@/features/chat/hooks', () => ({
  useChatPanelSections: () => ({
    diff: {
      projectPath: mocks.workingPath(),
      workingPath: mocks.workingPath(),
      onSendMessage: vi.fn(),
    },
    transcript: { messages: [] },
  }),
}))

vi.mock('@/features/chat/components', () => ({
  ChatPanelContent: ({
    onOpenSessionTree,
    rightSidebarOpen,
  }: {
    readonly onOpenSessionTree: () => void
    readonly rightSidebarOpen: boolean
  }) => (
    <main data-summary-suppressed={rightSidebarOpen}>
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
  ChangeRequestPanel: ({
    requestUrl,
    onClose,
  }: {
    readonly requestUrl: string | null
    readonly onClose: () => void
  }) => (
    <aside>
      Change request panel: {requestUrl}
      <Button variant="unstyled" type="button" onClick={onClose}>
        Close change request
      </Button>
    </aside>
  ),
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
    refetch: mocks.sidePanelRefetch,
    registry: null,
  }),
}))

vi.mock('@/shared/ui/PanelErrorBoundary', () => ({
  PanelErrorBoundary: ({ children }: { readonly children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/shared/ui/RightSidebarLayout', () => ({
  RightSidebarLayout: ({
    children,
    open,
    onOpenChange,
    sidebar,
  }: {
    readonly children: React.ReactNode
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly sidebar: React.ReactNode
  }) => (
    <section data-testid="route-right-sidebar-layout" data-open={open}>
      {children}
      {open ? (
        <>
          {sidebar}
          <Button variant="unstyled" type="button" onClick={() => onOpenChange(false)}>
            Close right sidebar
          </Button>
        </>
      ) : null}
    </section>
  ),
}))

vi.mock('@/shell', () => ({
  CHAT_MIN_WIDTH: 420,
  DIFF_PANEL_MAX: 900,
  DIFF_PANEL_MIN: 360,
  SETTINGS_TABS: ['general', 'waggle', 'extensions', 'mcp', 'archived', 'connections'] as const,
  useUIStore: <T,>(selector: (state: ShellState) => T) => selector(mocks.shellState()),
}))

vi.mock('../-chat-route-effects', () => ({
  useChatRouteEffects: mocks.chatRouteEffects,
}))

type ChatRouteProps = Parameters<typeof ChatRouteSurface>[0]

export function renderChatRoute({
  workspace = { branchId: null, nodeId: null, sessionId: 'session-1' },
  rightSidebar,
  actions = {},
}: {
  readonly workspace?: ChatRouteProps['workspace']
  readonly rightSidebar: Partial<ChatRouteProps['rightSidebar']>
  readonly actions?: Partial<ChatRouteProps['rightSidebarActions']>
}): ChatRouteProps['rightSidebarActions'] {
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
