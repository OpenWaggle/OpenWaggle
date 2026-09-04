import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { type ComponentProps, lazy, Suspense } from 'react'
import type { SessionResourceBrowserTarget } from '@/features/session-summary'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL } from '@/shell/ui-store'
import {
  type ChatExtensionSidePanelTarget,
  type ChatRouteSearch,
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

export function ChatIndexRouteView() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/_chat/' })
  const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined)
  const sessionTreeOpen = search.panel === 'session-tree'
  const resourcesTarget = resourceBrowserTargetFromSearch(search)
  const extensionSidePanel = extensionSidePanelTargetFromSearch(search)
  const workspaceFile =
    search.panel === 'file' && search.filePath
      ? { path: search.filePath, line: search.fileLine ?? null }
      : null

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

  return (
    <Suspense fallback={<ChatRouteSurfaceFallback />}>
      <LazyChatRouteSurface
        workspace={{ branchId: null, nodeId: null, sessionId: null }}
        rightSidebar={{
          diffOpen,
          extensionSidePanel,
          resourcesTarget,
          sessionTreeOpen,
          workspaceFile,
        }}
        rightSidebarActions={{
          onDiffOpenChange: setDiffOpen,
          onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
          onResourcesTargetChange: setResourcesTarget,
          onSessionTreeOpenChange: setSessionTreeOpen,
          onWorkspaceFileOpenChange: setWorkspaceFileOpen,
        }}
        onNavigateSession={(targetSessionId) => {
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: targetSessionId } })
        }}
      />
    </Suspense>
  )
}

export function ChatSessionRouteView() {
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/sessions/$sessionId' })
  const search = useSearch({ from: '/sessions/$sessionId' })
  const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined)
  const sessionTreeOpen = search.panel === 'session-tree'
  const resourcesTarget = resourceBrowserTargetFromSearch(search)
  const extensionSidePanel = extensionSidePanelTargetFromSearch(search)
  const workspaceFile =
    search.panel === 'file' && search.filePath
      ? { path: search.filePath, line: search.fileLine ?? null }
      : null
  const setWorkspaceFileOpen = useSessionWorkspaceFileOpen(sessionId)

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

  const rightSidebar = {
    diffOpen,
    extensionSidePanel,
    resourcesTarget,
    sessionTreeOpen,
    workspaceFile,
  } satisfies LazyChatRouteSurfaceInput['rightSidebar']
  const rightSidebarActions = {
    onDiffOpenChange: setDiffOpen,
    onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
    onResourcesTargetChange: setResourcesTarget,
    onSessionTreeOpenChange: setSessionTreeOpen,
    onWorkspaceFileOpenChange: setWorkspaceFileOpen,
  } satisfies LazyChatRouteSurfaceInput['rightSidebarActions']

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
