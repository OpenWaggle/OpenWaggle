import { lazy, Suspense, useEffect } from 'react'
import { ChatPanelContent, loadChatDiffPane } from '@/features/chat/components'
import { useChatPanelSections } from '@/features/chat/hooks'
import {
  ExtensionSidePanelSurface,
  useExtensionSidePanelContributions,
} from '@/features/extensions'
import { loadSessionTreePanel } from '@/features/session-tree/components'
import { WorkspaceFilePanel } from '@/features/workspace-files/components'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { CHAT_MIN_WIDTH, DIFF_PANEL_MAX, DIFF_PANEL_MIN, useUIStore } from '@/shell'
import { useChatRouteEffects } from './-chat-route-effects'
import { isExtensionRightSidebarPanel, resolveRightSidebarPanel } from './-right-sidebar-panel'
import type { ChatExtensionSidePanelTarget } from './-route-search'

const DIFF_PANEL_DEFAULT_WIDTH = 600
const DIFF_PANEL_STORAGE_KEY = 'openwaggle:diff-sidebar-width'
const DIFF_PANEL_SHEET_BREAKPOINT_PX = 1180
const OVERFLOW_TOLERANCE_PX = 0.5

const LazyChatDiffPane = lazy(loadChatDiffPane)
const LazySessionTreePanel = lazy(loadSessionTreePanel)

interface ChatRouteWorkspaceState {
  readonly branchId: string | null
  readonly nodeId: string | null
  readonly sessionId: string | null
}

interface ChatRightSidebarRouteState {
  readonly diffOpen: boolean
  readonly extensionSidePanel: ChatExtensionSidePanelTarget | null
  readonly sessionTreeOpen: boolean
  readonly workspaceFile: { readonly path: string; readonly line: number | null } | null
}

interface ChatRightSidebarRouteActions {
  readonly onDiffOpenChange: (open: boolean) => void
  readonly onExtensionSidePanelOpenChange: (
    open: boolean,
    target: ChatExtensionSidePanelTarget,
  ) => void
  readonly onSessionTreeOpenChange: (open: boolean) => void
  readonly onWorkspaceFileOpenChange: (
    open: boolean,
    target?: { readonly path: string; readonly line?: number | null },
  ) => void
}

interface ChatRouteSurfaceProps {
  readonly workspace: ChatRouteWorkspaceState
  readonly rightSidebar: ChatRightSidebarRouteState
  readonly rightSidebarActions: ChatRightSidebarRouteActions
}

function DiffSidebarFallback() {
  return (
    <output
      className="flex size-full items-center justify-center bg-diff-bg text-[13px] text-text-tertiary"
      aria-live="polite"
    >
      Loading diff…
    </output>
  )
}

function shouldAcceptDiffWidth(input: {
  readonly nextWidth: number
  readonly panel: HTMLDivElement
  readonly root: HTMLDivElement
  readonly sidebar: HTMLDivElement
}) {
  const previousPanelWidth = input.panel.style.width
  const previousSidebarWidth = input.sidebar.style.width
  input.panel.style.setProperty('width', `${String(input.nextWidth)}px`)
  input.sidebar.style.setProperty('width', `${String(input.nextWidth)}px`)

  const mainWidth = input.root.clientWidth - input.nextWidth
  const composerForm = input.root.querySelector<HTMLElement>('[data-chat-composer-form="true"]')
  const composerFits = composerForm
    ? composerForm.scrollWidth <= composerForm.clientWidth + OVERFLOW_TOLERANCE_PX
    : true
  const accepted = mainWidth >= CHAT_MIN_WIDTH && composerFits

  restoreInlineWidth(input.panel, previousPanelWidth)
  restoreInlineWidth(input.sidebar, previousSidebarWidth)
  return accepted
}

function restoreInlineWidth(element: HTMLElement, previousWidth: string) {
  if (previousWidth.length > 0) {
    element.style.setProperty('width', previousWidth)
    return
  }
  element.style.removeProperty('width')
}

function useChatRouteSurfaceActions(
  sections: ReturnType<typeof useChatPanelSections>,
  rightSidebarActions: ChatRightSidebarRouteActions,
) {
  const setLastRightSidebarPanel = useUIStore((state) => state.setLastRightSidebarPanel)
  const chatCommandRequest = useUIStore((state) => state.chatCommandRequest)
  const clearChatCommandRequest = useUIStore((state) => state.clearChatCommandRequest)

  useEffect(() => {
    if (!chatCommandRequest) return
    if (chatCommandRequest.command === 'fork-session') sections.composer.onOpenForkSelector()
    else sections.composer.onCloneToNewSession()
    clearChatCommandRequest(chatCommandRequest.id)
  }, [chatCommandRequest, clearChatCommandRequest, sections.composer])

  function handleDiffOpenChange(open: boolean) {
    setLastRightSidebarPanel('diff')
    rightSidebarActions.onDiffOpenChange(open)
  }

  function handleSessionTreeOpenChange(open: boolean) {
    setLastRightSidebarPanel('session-tree')
    rightSidebarActions.onSessionTreeOpenChange(open)
  }

  function handleExtensionSidePanelOpenChange(open: boolean, target: ChatExtensionSidePanelTarget) {
    const routeTarget = {
      extensionId: target.extensionId,
      sidePanelId: target.sidePanelId,
      ...(target.packagePath ? { packagePath: target.packagePath } : {}),
      ...(target.contentHash ? { contentHash: target.contentHash } : {}),
    }
    setLastRightSidebarPanel({ kind: 'extension-side-panel', ...routeTarget })
    rightSidebarActions.onExtensionSidePanelOpenChange(open, routeTarget)
  }

  function handleWorkspaceFileOpenChange(
    open: boolean,
    target?: { readonly path: string; readonly line?: number | null },
  ) {
    setLastRightSidebarPanel('file')
    rightSidebarActions.onWorkspaceFileOpenChange(open, target)
  }

  return {
    handleDiffOpenChange,
    handleExtensionSidePanelOpenChange,
    handleSessionTreeOpenChange,
    handleWorkspaceFileOpenChange,
  }
}

export function ChatRouteSurface({
  workspace,
  rightSidebar,
  rightSidebarActions,
}: ChatRouteSurfaceProps) {
  const sections = useChatPanelSections()
  const lastRightSidebarPanel = useUIStore((state) => state.lastRightSidebarPanel)
  const {
    handleDiffOpenChange,
    handleExtensionSidePanelOpenChange,
    handleSessionTreeOpenChange,
    handleWorkspaceFileOpenChange,
  } = useChatRouteSurfaceActions(sections, rightSidebarActions)
  const renderedRightSidebarPanel = resolveRightSidebarPanel({
    diffOpen: rightSidebar.diffOpen,
    fileOpen: rightSidebar.workspaceFile != null,
    extensionSidePanel: rightSidebar.extensionSidePanel,
    lastPanel: lastRightSidebarPanel,
    sessionTreeOpen: rightSidebar.sessionTreeOpen,
  })
  const sidePanelQuery = useExtensionSidePanelContributions({
    enabled: isExtensionRightSidebarPanel(renderedRightSidebarPanel),
    projectPath: sections.diff.workingPath,
    sessionId: workspace.sessionId,
  })

  useChatRouteEffects({
    branchId: workspace.branchId,
    diffOpen: rightSidebar.diffOpen,
    nodeId: workspace.nodeId,
    sessionId: workspace.sessionId,
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <PanelErrorBoundary name="Chat" className="flex min-w-0 flex-1 overflow-hidden">
        <RightSidebarLayout
          open={
            rightSidebar.diffOpen ||
            rightSidebar.sessionTreeOpen ||
            rightSidebar.extensionSidePanel !== null ||
            rightSidebar.workspaceFile != null
          }
          sizing={{
            defaultWidth: DIFF_PANEL_DEFAULT_WIDTH,
            mainMinWidth: CHAT_MIN_WIDTH,
            maxWidth: DIFF_PANEL_MAX,
            minWidth: DIFF_PANEL_MIN,
            sheetBreakpointPx: DIFF_PANEL_SHEET_BREAKPOINT_PX,
            storageKey: DIFF_PANEL_STORAGE_KEY,
          }}
          onOpenChange={(open) => {
            if (renderedRightSidebarPanel === 'diff') {
              handleDiffOpenChange(open)
              return
            }
            if (renderedRightSidebarPanel === 'file') {
              handleWorkspaceFileOpenChange(open)
              return
            }
            if (isExtensionRightSidebarPanel(renderedRightSidebarPanel)) {
              handleExtensionSidePanelOpenChange(open, renderedRightSidebarPanel)
              return
            }
            handleSessionTreeOpenChange(open)
          }}
          shouldAcceptWidth={shouldAcceptDiffWidth}
          sidebar={
            <Suspense fallback={<DiffSidebarFallback />}>
              {renderedRightSidebarPanel === 'session-tree' ? (
                <LazySessionTreePanel onClose={() => handleSessionTreeOpenChange(false)} />
              ) : renderedRightSidebarPanel === 'file' && rightSidebar.workspaceFile ? (
                <WorkspaceFilePanel
                  projectPath={sections.diff.workingPath}
                  relativePath={rightSidebar.workspaceFile.path}
                  line={rightSidebar.workspaceFile.line}
                  onClose={() => handleWorkspaceFileOpenChange(false)}
                  onOpenFile={(path, line) => handleWorkspaceFileOpenChange(true, { path, line })}
                />
              ) : isExtensionRightSidebarPanel(renderedRightSidebarPanel) ? (
                <ExtensionSidePanelSurface
                  error={sidePanelQuery.error?.message ?? null}
                  loading={sidePanelQuery.loading}
                  onClose={() =>
                    handleExtensionSidePanelOpenChange(false, renderedRightSidebarPanel)
                  }
                  onRefresh={() => void sidePanelQuery.refetch()}
                  projectPaths={sidePanelQuery.projectPaths}
                  registry={sidePanelQuery.registry}
                  target={renderedRightSidebarPanel}
                />
              ) : (
                <LazyChatDiffPane
                  section={sections.diff}
                  onClose={() => handleDiffOpenChange(false)}
                />
              )}
            </Suspense>
          }
        >
          <ChatPanelContent
            sections={sections}
            onOpenSessionTree={() => handleSessionTreeOpenChange(true)}
          />
        </RightSidebarLayout>
      </PanelErrorBoundary>
    </div>
  )
}
