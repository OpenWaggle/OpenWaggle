import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { type ComponentProps, lazy, Suspense } from 'react'
import type { SessionResourceBrowserTarget } from '@/features/session-summary'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL } from '@/shell/ui-store'
import {
  type ChatExtensionSidePanelTarget,
  type ChatRouteSearch,
  changeRequestUrlFromSearch,
  extensionSidePanelTargetFromSearch,
  resourceBrowserTargetFromSearch,
} from './-route-search'

const LazyChatRouteSurface = lazy(() =>
  import('./-chat-route-surface').then((module) => ({
    default: module.ChatRouteSurface,
  })),
)

function ChatRouteSurfaceFallback() {
  return (
    <output
      aria-live="polite"
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-bg text-sm text-text-tertiary"
    >
      Loading chat…
    </output>
  )
}

type LazyChatRouteSurfaceInput = ComponentProps<typeof LazyChatRouteSurface>

function ChatRouteSurfaceView({ input }: { readonly input: LazyChatRouteSurfaceInput }) {
  return (
    <Suspense fallback={<ChatRouteSurfaceFallback />}>
      <LazyChatRouteSurface {...input} />
    </Suspense>
  )
}

function useSessionWorkspaceFileOpen(sessionId: string) {
  const navigate = useNavigate()
  return (open: boolean, target?: { path: string; line?: number | null }) => {
    const panel: ChatRouteSearch['panel'] = open ? 'file' : undefined
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous: ChatRouteSearch) => ({
        ...previous,
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
      }),
    })
  }
}

function useChatSessionSidebarActions(sessionId: string) {
  const navigate = useNavigate()
  const setWorkspaceFileOpen = useSessionWorkspaceFileOpen(sessionId)

  function setChangeRequestOpen(open: boolean, url?: string) {
    const panel: ChatRouteSearch['panel'] = open && url ? 'change-request' : undefined
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous: ChatRouteSearch) => ({
        ...previous,
        diff: undefined,
        panel,
        changeRequestUrl: panel ? url : undefined,
        changeRequestSessionId: panel ? sessionId : undefined,
        filePath: undefined,
        fileLine: undefined,
        resourceId: undefined,
        resourceView: undefined,
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      }),
    })
  }

  function setDiffOpen(open: boolean) {
    const panel: ChatRouteSearch['panel'] = open ? 'diff' : undefined
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous: ChatRouteSearch) => ({
        ...previous,
        diff: undefined,
        panel,
        resourceId: undefined,
        resourceView: undefined,
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      }),
    })
  }

  function setSessionTreeOpen(open: boolean) {
    const panel: ChatRouteSearch['panel'] = open ? 'session-tree' : undefined
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous: ChatRouteSearch) => ({
        ...previous,
        diff: undefined,
        panel,
        resourceId: undefined,
        resourceView: undefined,
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      }),
    })
  }

  function setResourcesTarget(target: SessionResourceBrowserTarget | null) {
    const panel: ChatRouteSearch['panel'] = target ? 'resources' : undefined
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous: ChatRouteSearch) => ({
        ...previous,
        diff: undefined,
        panel,
        resourceId: target?.resourceId,
        resourceView: target?.view,
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      }),
    })
  }

  function setExtensionSidePanelOpen(open: boolean, target: ChatExtensionSidePanelTarget) {
    const panel: ChatRouteSearch['panel'] = open ? EXTENSION_SIDE_PANEL_ROUTE_PANEL : undefined

    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous: ChatRouteSearch) => ({
        ...previous,
        diff: undefined,
        panel,
        resourceId: undefined,
        resourceView: undefined,
        sidePanelExtensionId: open ? target.extensionId : undefined,
        sidePanelId: open ? target.sidePanelId : undefined,
        sidePanelPackagePath: open ? target.packagePath : undefined,
        sidePanelContentHash: open ? target.contentHash : undefined,
      }),
    })
  }

  return {
    onChangeRequestOpenChange: setChangeRequestOpen,
    onDiffOpenChange: setDiffOpen,
    onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
    onResourcesTargetChange: setResourcesTarget,
    onSessionTreeOpenChange: setSessionTreeOpen,
    onWorkspaceFileOpenChange: setWorkspaceFileOpen,
  } satisfies LazyChatRouteSurfaceInput['rightSidebarActions']
}

export function ChatSessionRouteView() {
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/sessions/$sessionId' })
  const search = useSearch({ from: '/sessions/$sessionId' })
  const rightSidebarActions = useChatSessionSidebarActions(sessionId)

  const rightSidebar = {
    changeRequestUrl: changeRequestUrlFromSearch(search, sessionId),
    diffOpen: search.panel === 'diff' || (search.diff === 1 && search.panel === undefined),
    extensionSidePanel: extensionSidePanelTargetFromSearch(search),
    resourcesTarget: resourceBrowserTargetFromSearch(search),
    sessionTreeOpen: search.panel === 'session-tree',
    workspaceFile:
      search.panel === 'file' && search.filePath
        ? { path: search.filePath, line: search.fileLine ?? null }
        : null,
  } satisfies LazyChatRouteSurfaceInput['rightSidebar']

  return (
    <ChatRouteSurfaceView
      input={{
        workspace: { branchId: search.branch ?? null, nodeId: search.node ?? null, sessionId },
        rightSidebar,
        rightSidebarActions,
        onNavigateSession: (targetSessionId) => {
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: targetSessionId } })
        },
      }}
    />
  )
}
