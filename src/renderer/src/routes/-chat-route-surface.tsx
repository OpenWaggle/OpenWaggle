import { type ComponentProps, lazy, Suspense } from 'react'
import { ChatPanelContent } from '@/features/chat/components'
import { useChatPanelSections } from '@/features/chat/hooks'
import { useExtensionSidePanelContributions } from '@/features/extensions'
import {
  DEFAULT_SESSION_RESOURCE_BROWSER_TARGET,
  type SessionResourceBrowserTarget,
} from '@/features/session-summary'
import { terminalOwnerContext } from '@/features/terminal'
import { useRightPanelMaximizeStore } from '@/shared/lib/right-panel-maximize'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { RIGHT_PANEL_SIZING } from '@/shared/ui/right-sidebar-sizing-presets'
import { CHAT_MIN_WIDTH, useUIStore } from '@/shell'
import { useChatRouteEffects } from './-chat-route-effects'
import { useChatRouteSurfaceActions } from './-chat-route-surface-actions'
import { routePanelRequestKey, useRoutePanelClaim } from './-right-sidebar-coordination'
import { isExtensionRightSidebarPanel, resolveChatRightSidebarPanel } from './-right-sidebar-panel'
import type { ChatExtensionSidePanelTarget } from './-route-search'

// The route's right sidebar (diff, files, Hive, Session tree, resources, change requests,
// extension panels) renders only while it is open, so its panels load on first open instead of
// with the chat (renderer-load B8).
const LazyChatRouteSidebar = lazy(() =>
  import('./-chat-route-sidebar').then((module) => ({ default: module.ChatRouteSidebar })),
)

function ChatRouteSidebarSlot({
  input,
}: {
  readonly input: ComponentProps<typeof LazyChatRouteSidebar>['input']
}) {
  return (
    <PanelErrorBoundary name="Session sidebar" className="size-full">
      <Suspense
        fallback={
          <output
            aria-label="Loading"
            className="flex size-full items-center justify-center bg-diff-bg text-sm text-text-tertiary"
            aria-live="polite"
          >
            Loading…
          </output>
        }
      >
        <LazyChatRouteSidebar input={input} />
      </Suspense>
    </PanelErrorBoundary>
  )
}

const OVERFLOW_TOLERANCE_PX = 0.5
/** Route panels share the Right panel's one width and narrow-window rule (ADR 0043). */
const RIGHT_SIDEBAR_SIZING = RIGHT_PANEL_SIZING

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
  readonly hiveOpen: boolean
  readonly workspaceFile: { readonly path: string; readonly line: number | null } | null
}

export interface ChatRightSidebarRouteActions {
  readonly onChangeRequestOpenChange?: (open: boolean, url?: string) => void
  readonly onDiffOpenChange: (open: boolean) => void
  readonly onExtensionSidePanelOpenChange: (
    open: boolean,
    target: ChatExtensionSidePanelTarget,
  ) => void
  readonly onResourcesTargetChange: (target: SessionResourceBrowserTarget | null) => void
  readonly onSessionTreeOpenChange: (open: boolean) => void
  readonly onHiveOpenChange: (open: boolean) => void
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
  readonly handleHiveOpenChange: (open: boolean) => void
  readonly handleWorkspaceFileOpenChange: (
    open: boolean,
    target?: { readonly path: string; readonly line?: number | null },
  ) => void
}

interface ChatRouteSurfaceProps {
  readonly workspace: ChatRouteWorkspaceState
  readonly rightSidebar: ChatRightSidebarRouteState
  readonly rightSidebarActions: ChatRightSidebarRouteActions
}

function isChatRightSidebarOpen(state: ChatRightSidebarRouteState) {
  return (
    (state.changeRequestUrl !== null && state.changeRequestUrl !== undefined) ||
    state.diffOpen ||
    state.resourcesTarget !== null ||
    state.sessionTreeOpen ||
    state.hiveOpen ||
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

export function ChatRouteSurface({
  workspace,
  rightSidebar,
  rightSidebarActions,
}: ChatRouteSurfaceProps) {
  const sections = useChatPanelSections()
  const lastRightSidebarPanel = useUIStore((state) => state.lastRightSidebarPanel)
  const handlers = useChatRouteSurfaceActions(sections, rightSidebarActions)
  const {
    handleChangeRequestOpenChange,
    handleDiffOpenChange,
    handleExtensionSidePanelOpenChange,
    handleHiveOpenChange,
    handleResourcesTargetChange,
    handleSessionTreeOpenChange,
    handleWorkspaceFileOpenChange,
  } = handlers
  const renderedRightSidebarPanel = resolveChatRightSidebarPanel(
    rightSidebar,
    lastRightSidebarPanel,
  )
  const routePanelRequested = isChatRightSidebarOpen(rightSidebar)
  const routePanelKey = routePanelRequested
    ? routePanelRequestKey(renderedRightSidebarPanel, rightSidebar.workspaceFile)
    : null
  const routePanelScope =
    workspace.sessionId ?? (terminalOwnerContext(null, sections.diff.workingPath).ownerKey || null)
  const routePanelOpen = useRoutePanelClaim(routePanelKey, routePanelScope)
  const routePanelMaximized = useRightPanelMaximizeStore(
    (state) => state.target?.maximized === true,
  )
  const sidePanelQuery = useExtensionSidePanelContributions({
    enabled: isExtensionRightSidebarPanel(renderedRightSidebarPanel),
    projectPath: sections.diff.workingPath,
    sessionId: workspace.sessionId,
  })
  const workspaceSidebarOpen = useRightSidebarCoordinator(
    (state) =>
      state.activeClaim?.kind === 'workspace' && state.activeClaim.ownerKey === routePanelScope,
  )
  const rightSidebarOpen = routePanelOpen || workspaceSidebarOpen
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
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-chat-route-session-id={workspace.sessionId ?? ''}
    >
      <PanelErrorBoundary name="Chat" className="flex min-w-0 flex-1 overflow-hidden">
        <RightSidebarLayout
          maximized={routePanelMaximized}
          open={routePanelOpen}
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
            if (renderedRightSidebarPanel === 'hive') {
              handleHiveOpenChange(open)
              return
            }
            handleSessionTreeOpenChange(open)
          }}
          shouldAcceptWidth={shouldAcceptDiffWidth}
          sidebar={
            <ChatRouteSidebarSlot
              input={{
                activePathNodeIds,
                handlers,
                panel: renderedRightSidebarPanel,
                rightSidebar,
                rightSidebarOpen: routePanelOpen,
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
            onOpenExtensionSidePanel={(target) => handleExtensionSidePanelOpenChange(true, target)}
          />
        </RightSidebarLayout>
      </PanelErrorBoundary>
    </div>
  )
}
