import { useNavigate, useSearch } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import type { SessionResourceBrowserTarget } from '@/features/session-summary'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL } from '@/shell/ui-store'
import type { ChatExtensionSidePanelTarget, ChatRouteSearch } from './-route-search'
import {
  extensionSidePanelTargetFromSearch,
  resourceBrowserTargetFromSearch,
} from './-route-search'

const LazyChatRouteSurface = lazy(() =>
  import('./-chat-route-surface').then((module) => ({
    default: module.ChatRouteSurface,
  })),
)

function useChatIndexSidebarActions() {
  const navigate = useNavigate()

  function setDiffOpen(open: boolean) {
    const panel: ChatRouteSearch['panel'] = open ? 'diff' : undefined
    void navigate({
      to: '/',
      search: {
        diff: undefined,
        panel,
        resourceId: undefined,
        resourceView: undefined,
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      },
    })
  }

  function setSessionTreeOpen(open: boolean) {
    const panel: ChatRouteSearch['panel'] = open ? 'session-tree' : undefined
    void navigate({
      to: '/',
      search: {
        diff: undefined,
        panel,
        resourceId: undefined,
        resourceView: undefined,
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      },
    })
  }

  function setResourcesTarget(target: SessionResourceBrowserTarget | null) {
    const panel: ChatRouteSearch['panel'] = target ? 'resources' : undefined
    void navigate({
      to: '/',
      search: {
        diff: undefined,
        panel,
        resourceId: target?.resourceId,
        resourceView: target?.view,
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      },
    })
  }

  function setExtensionSidePanelOpen(open: boolean, target: ChatExtensionSidePanelTarget) {
    void navigate({
      to: '/',
      search: {
        diff: undefined,
        panel: open ? EXTENSION_SIDE_PANEL_ROUTE_PANEL : undefined,
        resourceId: undefined,
        resourceView: undefined,
        sidePanelExtensionId: open ? target.extensionId : undefined,
        sidePanelId: open ? target.sidePanelId : undefined,
        sidePanelPackagePath: open ? target.packagePath : undefined,
        sidePanelContentHash: open ? target.contentHash : undefined,
      },
    })
  }

  function setWorkspaceFileOpen(open: boolean, target?: { path: string; line?: number | null }) {
    const panel: ChatRouteSearch['panel'] = open ? 'file' : undefined
    void navigate({
      to: '/',
      search: {
        diff: undefined,
        panel,
        filePath: open ? target?.path : undefined,
        fileLine: open ? (target?.line ?? undefined) : undefined,
        resourceId: undefined,
        resourceView: undefined,
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      },
    })
  }

  return {
    onChangeRequestOpenChange: () => {
      // A request inspector is unavailable before a Session exists.
    },
    onDiffOpenChange: setDiffOpen,
    onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
    onResourcesTargetChange: setResourcesTarget,
    onSessionTreeOpenChange: setSessionTreeOpen,
    onWorkspaceFileOpenChange: setWorkspaceFileOpen,
  }
}

export function ChatIndexRouteView() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/_chat/' })
  const actions = useChatIndexSidebarActions()

  return (
    <Suspense
      fallback={
        <output
          aria-live="polite"
          className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-bg text-sm text-text-tertiary"
        >
          Loading chat…
        </output>
      }
    >
      <LazyChatRouteSurface
        workspace={{ branchId: null, nodeId: null, sessionId: null }}
        rightSidebar={{
          changeRequestUrl: null,
          diffOpen: search.panel === 'diff' || (search.diff === 1 && search.panel === undefined),
          extensionSidePanel: extensionSidePanelTargetFromSearch(search),
          resourcesTarget: resourceBrowserTargetFromSearch(search),
          sessionTreeOpen: search.panel === 'session-tree',
          workspaceFile:
            search.panel === 'file' && search.filePath
              ? { path: search.filePath, line: search.fileLine ?? null }
              : null,
        }}
        rightSidebarActions={actions}
        onNavigateSession={(targetSessionId) => {
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: targetSessionId } })
        }}
      />
    </Suspense>
  )
}
