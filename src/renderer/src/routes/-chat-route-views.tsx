import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL } from '@/shell/ui-store'
import {
  type ChatExtensionSidePanelTarget,
  type ChatRouteSearch,
  extensionSidePanelTargetFromSearch,
  NOTIFICATION_PROTOTYPE_ROUTES_ENABLED,
  type NotificationPrototypeVariant,
} from './-route-search'

function notificationPrototypeSearch(
  previous: ChatRouteSearch,
  variant: NotificationPrototypeVariant,
): ChatRouteSearch {
  return { ...previous, prototype: 'notifications', variant }
}

function notificationPrototypeAvailable() {
  return NOTIFICATION_PROTOTYPE_ROUTES_ENABLED && window.location.protocol === 'http:'
}

const LazyChatRouteSurface = lazy(() =>
  import('./-chat-route-surface').then((module) => ({
    default: module.ChatRouteSurface,
  })),
)

const LazyNotificationPrototypeRouteView = lazy(() =>
  import('./-notification-prototype').then((module) => ({
    default: module.NotificationPrototypeRouteView,
  })),
)

function ChatRouteSurfaceFallback() {
  return (
    <output
      aria-live="polite"
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-bg text-[13px] text-text-tertiary"
    >
      Loading chat…
    </output>
  )
}

function NotificationPrototypeFallback() {
  return (
    <output
      aria-live="polite"
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-bg text-[13px] text-text-tertiary"
    >
      Loading prototype…
    </output>
  )
}

export function ChatIndexRouteView() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/_chat/' })
  const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined)
  const sessionTreeOpen = search.panel === 'session-tree'
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
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      },
    })
  }

  function setPrototypeVariant(variant: NotificationPrototypeVariant) {
    void navigate({
      to: '/',
      search: (previous: ChatRouteSearch) => notificationPrototypeSearch(previous, variant),
    })
  }

  if (notificationPrototypeAvailable() && search.prototype === 'notifications') {
    return (
      <Suspense fallback={<NotificationPrototypeFallback />}>
        <LazyNotificationPrototypeRouteView
          variant={search.variant ?? 'B1'}
          onVariantChange={setPrototypeVariant}
        />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<ChatRouteSurfaceFallback />}>
      <LazyChatRouteSurface
        workspace={{ branchId: null, nodeId: null, sessionId: null }}
        rightSidebar={{ diffOpen, extensionSidePanel, sessionTreeOpen, workspaceFile }}
        rightSidebarActions={{
          onDiffOpenChange: setDiffOpen,
          onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
          onSessionTreeOpenChange: setSessionTreeOpen,
          onWorkspaceFileOpenChange: setWorkspaceFileOpen,
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
  const extensionSidePanel = extensionSidePanelTargetFromSearch(search)
  const workspaceFile =
    search.panel === 'file' && search.filePath
      ? { path: search.filePath, line: search.fileLine ?? null }
      : null

  function setDiffOpen(open: boolean) {
    const panel: ChatRouteSearch['panel'] = open ? 'diff' : undefined
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous: ChatRouteSearch) => ({
        ...previous,
        diff: undefined,
        panel,
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
        sidePanelExtensionId: open ? target.extensionId : undefined,
        sidePanelId: open ? target.sidePanelId : undefined,
        sidePanelPackagePath: open ? target.packagePath : undefined,
        sidePanelContentHash: open ? target.contentHash : undefined,
      }),
    })
  }

  function setWorkspaceFileOpen(open: boolean, target?: { path: string; line?: number | null }) {
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
        sidePanelExtensionId: undefined,
        sidePanelId: undefined,
        sidePanelPackagePath: undefined,
        sidePanelContentHash: undefined,
      }),
    })
  }

  function setPrototypeVariant(variant: NotificationPrototypeVariant) {
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous: ChatRouteSearch) => notificationPrototypeSearch(previous, variant),
    })
  }

  if (notificationPrototypeAvailable() && search.prototype === 'notifications') {
    return (
      <Suspense fallback={<NotificationPrototypeFallback />}>
        <LazyNotificationPrototypeRouteView
          variant={search.variant ?? 'B1'}
          onVariantChange={setPrototypeVariant}
        />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<ChatRouteSurfaceFallback />}>
      <LazyChatRouteSurface
        workspace={{ branchId: search.branch ?? null, nodeId: search.node ?? null, sessionId }}
        rightSidebar={{ diffOpen, extensionSidePanel, sessionTreeOpen, workspaceFile }}
        rightSidebarActions={{
          onDiffOpenChange: setDiffOpen,
          onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
          onSessionTreeOpenChange: setSessionTreeOpen,
          onWorkspaceFileOpenChange: setWorkspaceFileOpen,
        }}
      />
    </Suspense>
  )
}
