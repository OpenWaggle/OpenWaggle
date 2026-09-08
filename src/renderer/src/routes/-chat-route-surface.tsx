import { useEffect } from 'react'
import { ChatPanelContent } from '@/features/chat/components'
import { useChatPanelSections } from '@/features/chat/hooks'
import { useExtensionSidePanelContributions } from '@/features/extensions'
import {
  DEFAULT_SESSION_RESOURCE_BROWSER_TARGET,
  type SessionResourceBrowserTarget,
} from '@/features/session-summary'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { CHAT_MIN_WIDTH, DIFF_PANEL_MAX, DIFF_PANEL_MIN, useUIStore } from '@/shell'
import { useChatRouteEffects } from './-chat-route-effects'
import { ChatRouteSidebar } from './-chat-route-sidebar'
import { isExtensionRightSidebarPanel, resolveChatRightSidebarPanel } from './-right-sidebar-panel'
import type { ChatExtensionSidePanelTarget } from './-route-search'

const DIFF_PANEL_DEFAULT_WIDTH = 600
const DIFF_PANEL_STORAGE_KEY = 'openwaggle:diff-sidebar-width'
const DIFF_PANEL_SHEET_BREAKPOINT_PX = 1180
const OVERFLOW_TOLERANCE_PX = 0.5
const RIGHT_SIDEBAR_SIZING = {
  defaultWidth: DIFF_PANEL_DEFAULT_WIDTH,
  mainMinWidth: CHAT_MIN_WIDTH,
  maxWidth: DIFF_PANEL_MAX,
  minWidth: DIFF_PANEL_MIN,
  sheetBreakpointPx: DIFF_PANEL_SHEET_BREAKPOINT_PX,
  storageKey: DIFF_PANEL_STORAGE_KEY,
}

export interface ChatRouteWorkspaceState {
  readonly branchId: string | null
  readonly nodeId: string | null
  readonly sessionId: string | null
}

export interface ChatRightSidebarRouteState {
  readonly changeRequestUrl?: string | null
  readonly diffOpen: boolean
  readonly extensionSidePanel: ChatExtensionSidePanelTarget | null
  readonly resourcesTarget: SessionResourceBrowserTarget | null
  readonly sessionTreeOpen: boolean
  readonly workspaceFile: { readonly path: string; readonly line: number | null } | null
}

interface ChatRightSidebarRouteActions {
  readonly onChangeRequestOpenChange?: (open: boolean, url?: string) => void
  readonly onDiffOpenChange: (open: boolean) => void
  readonly onExtensionSidePanelOpenChange: (
    open: boolean,
    target: ChatExtensionSidePanelTarget,
  ) => void
  readonly onResourcesTargetChange: (target: SessionResourceBrowserTarget | null) => void
  readonly onSessionTreeOpenChange: (open: boolean) => void
  readonly onWorkspaceFileOpenChange: (
    open: boolean,
    target?: { readonly path: string; readonly line?: number | null },
  ) => void
}

export interface ChatRouteSurfaceHandlers {
  readonly handleChangeRequestOpenChange: (open: boolean, url?: string) => void
  readonly handleDiffOpenChange: (open: boolean) => void
  readonly handleExtensionSidePanelOpenChange: (
    open: boolean,
    target: ChatExtensionSidePanelTarget,
  ) => void
  readonly handleResourcesTargetChange: (target: SessionResourceBrowserTarget | null) => void
  readonly handleSessionTreeOpenChange: (open: boolean) => void
  readonly handleWorkspaceFileOpenChange: (
    open: boolean,
    target?: { readonly path: string; readonly line?: number | null },
  ) => void
}

interface ChatRouteSurfaceProps {
  readonly workspace: ChatRouteWorkspaceState
  readonly rightSidebar: ChatRightSidebarRouteState
  readonly rightSidebarActions: ChatRightSidebarRouteActions
  readonly onNavigateSession?: (sessionId: string) => void
}

function isChatRightSidebarOpen(state: ChatRightSidebarRouteState) {
  return (
    (state.changeRequestUrl !== null && state.changeRequestUrl !== undefined) ||
    state.diffOpen ||
    state.resourcesTarget !== null ||
    state.sessionTreeOpen ||
    state.extensionSidePanel !== null ||
    state.workspaceFile !== null
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

  function handleChangeRequestOpenChange(open: boolean, url?: string) {
    setLastRightSidebarPanel('change-request')
    rightSidebarActions.onChangeRequestOpenChange?.(open, url)
  }

  function handleSessionTreeOpenChange(open: boolean) {
    setLastRightSidebarPanel('session-tree')
    rightSidebarActions.onSessionTreeOpenChange(open)
  }

  function handleResourcesTargetChange(target: SessionResourceBrowserTarget | null) {
    if (target) setLastRightSidebarPanel('resources')
    rightSidebarActions.onResourcesTargetChange(target)
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
    handleChangeRequestOpenChange,
    handleDiffOpenChange,
    handleExtensionSidePanelOpenChange,
    handleResourcesTargetChange,
    handleSessionTreeOpenChange,
    handleWorkspaceFileOpenChange,
  }
}

export function ChatRouteSurface({
  workspace,
  rightSidebar,
  rightSidebarActions,
  onNavigateSession,
}: ChatRouteSurfaceProps) {
  const sections = useChatPanelSections()
  const lastRightSidebarPanel = useUIStore((state) => state.lastRightSidebarPanel)
  const handlers = useChatRouteSurfaceActions(sections, rightSidebarActions)
  const {
    handleChangeRequestOpenChange,
    handleDiffOpenChange,
    handleExtensionSidePanelOpenChange,
    handleResourcesTargetChange,
    handleSessionTreeOpenChange,
    handleWorkspaceFileOpenChange,
  } = handlers
  const renderedRightSidebarPanel = resolveChatRightSidebarPanel(
    rightSidebar,
    lastRightSidebarPanel,
  )
  const sidePanelQuery = useExtensionSidePanelContributions({
    enabled: isExtensionRightSidebarPanel(renderedRightSidebarPanel),
    projectPath: sections.diff.workingPath,
    sessionId: workspace.sessionId,
  })
  const rightSidebarOpen = isChatRightSidebarOpen(rightSidebar)
  const activePathNodeIds = new Set(
    sections.transcript.activePathNodeIds ??
      sections.transcript.messages.map((message) => message.metadata?.sessionNodeId ?? message.id),
  )

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
          open={rightSidebarOpen}
          sizing={RIGHT_SIDEBAR_SIZING}
          onOpenChange={(open) => {
            if (renderedRightSidebarPanel === 'change-request') {
              handleChangeRequestOpenChange(open, rightSidebar.changeRequestUrl ?? undefined)
              return
            }
            if (renderedRightSidebarPanel === 'diff') {
              handleDiffOpenChange(open)
              return
            }
            if (renderedRightSidebarPanel === 'file') {
              handleWorkspaceFileOpenChange(open)
              return
            }
            if (renderedRightSidebarPanel === 'resources') {
              handleResourcesTargetChange(open ? DEFAULT_SESSION_RESOURCE_BROWSER_TARGET : null)
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
            <ChatRouteSidebar
              input={{
                activePathNodeIds,
                handlers,
                panel: renderedRightSidebarPanel,
                rightSidebar,
                rightSidebarOpen,
                sections,
                sidePanelQuery,
                workspace,
              }}
            />
          }
        >
          <ChatPanelContent
            sections={sections}
            rightSidebarOpen={rightSidebarOpen}
            onOpenDiff={() => handleDiffOpenChange(true)}
            onOpenChangeRequest={(url) => handleChangeRequestOpenChange(true, url)}
            onOpenResources={(target = DEFAULT_SESSION_RESOURCE_BROWSER_TARGET) =>
              handleResourcesTargetChange(target)
            }
            onOpenSessionTree={() => handleSessionTreeOpenChange(true)}
            onNavigateSession={onNavigateSession}
            onOpenExtensionSidePanel={(target) => handleExtensionSidePanelOpenChange(true, target)}
          />
        </RightSidebarLayout>
      </PanelErrorBoundary>
    </div>
  )
}
