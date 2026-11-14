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
    shellState: () => {
      const state: ShellState = { lastRightSidebarPanel, setLastRightSidebarPanel }
      return state
    },
    setLastRightSidebarPanel,
    chatRouteEffects: vi.fn<() => void>(),
    sidePanelRefetch: vi.fn<() => void>(),
  }
})

export const routeSurfaceMocks: RouteSurfaceMocks = mocks

// The chat sections read the whole transcript pipeline; the route only routes their props.
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

// The chat panel and lazy diff pane are heavy surfaces with their own tests; these expose the route's props.
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

// A lazily loaded heavy panel with its own tests; the stand-in exposes its close action.
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

// A lazily loaded heavy panel with its own tests; the stand-in exposes its close action.
vi.mock('@/features/hive-panel/components', () => ({
  loadHivePanel: () =>
    Promise.resolve({
      default: ({ onClose }: { readonly onClose: () => void }) => (
        <aside>
          Hive panel
          <Button variant="unstyled" type="button" onClick={onClose}>
            Close Hive
          </Button>
        </aside>
      ),
    }),
}))

// Change-request and resources panels are other features' surfaces; these expose their targets.
vi.mock('@/features/session-summary/components', () => ({
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

// Extension side panels host extension iframes; the stand-in shows which panel the route opened.
vi.mock('@/features/extensions/components', () => ({
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
}))

// The contributions query needs the extension host; the route reads only its projectPaths.
vi.mock('@/features/extensions', () => ({
  useExtensionSidePanelContributions: () => ({
    error: null,
    loading: false,
    projectPaths: ['/repo'],
    refetch: mocks.sidePanelRefetch,
    registry: null,
  }),
}))

// The resizable layout measures the window; -route-surfaces reads open state from this stand-in.
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

// The '@/shell' barrel loads the whole app shell; -route-surfaces asserts the remembered panel here.
vi.mock('@/shell', () => ({
  CHAT_MIN_WIDTH: 420,
  DIFF_PANEL_MAX: 900,
  DIFF_PANEL_MIN: 360,
  SETTINGS_TABS: ['general', 'waggle', 'extensions', 'mcp', 'archived', 'connections'] as const,
  useUIStore: <T,>(selector: (state: ShellState) => T) => selector(mocks.shellState()),
}))

// The route effects navigate and load Sessions; -chat-route-effects*.component.test.tsx cover them.
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
}) {
  const rightSidebarActions: ChatRouteProps['rightSidebarActions'] = {
    onDiffOpenChange: vi.fn(),
    onExtensionSidePanelOpenChange: vi.fn(),
    onResourcesTargetChange: vi.fn(),
    onSessionTreeOpenChange: vi.fn(),
    onHiveOpenChange: vi.fn(),
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
        hiveOpen: false,
        workspaceFile: null,
        ...rightSidebar,
      }}
      rightSidebarActions={rightSidebarActions}
    />,
  )
  return rightSidebarActions
}
