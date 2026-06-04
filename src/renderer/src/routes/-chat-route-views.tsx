import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL } from '@/shell/ui-store'
import { ChatRouteSurface } from './-chat-route-surface'
import {
  type ChatExtensionSidePanelTarget,
  type ChatRouteSearch,
  extensionSidePanelTargetFromSearch,
} from './-route-search'

export function ChatIndexRouteView() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/_chat/' })
  const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined)
  const sessionTreeOpen = search.panel === 'session-tree'
  const extensionSidePanel = extensionSidePanelTargetFromSearch(search)

  function setDiffOpen(open: boolean) {
    const panel: ChatRouteSearch['panel'] = open ? 'diff' : undefined
    void navigate({
      to: '/',
      search: { diff: undefined, panel, sidePanelExtensionId: undefined, sidePanelId: undefined },
    })
  }

  function setSessionTreeOpen(open: boolean) {
    const panel: ChatRouteSearch['panel'] = open ? 'session-tree' : undefined
    void navigate({
      to: '/',
      search: { diff: undefined, panel, sidePanelExtensionId: undefined, sidePanelId: undefined },
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
      },
    })
  }

  return (
    <ChatRouteSurface
      workspace={{ branchId: null, nodeId: null, sessionId: null }}
      rightSidebar={{ diffOpen, extensionSidePanel, sessionTreeOpen }}
      rightSidebarActions={{
        onDiffOpenChange: setDiffOpen,
        onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
        onSessionTreeOpenChange: setSessionTreeOpen,
      }}
    />
  )
}

export function ChatSessionRouteView() {
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/sessions/$sessionId' })
  const search = useSearch({ from: '/sessions/$sessionId' })
  const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined)
  const sessionTreeOpen = search.panel === 'session-tree'
  const extensionSidePanel = extensionSidePanelTargetFromSearch(search)

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
      }),
    })
  }

  return (
    <ChatRouteSurface
      workspace={{ branchId: search.branch ?? null, nodeId: search.node ?? null, sessionId }}
      rightSidebar={{ diffOpen, extensionSidePanel, sessionTreeOpen }}
      rightSidebarActions={{
        onDiffOpenChange: setDiffOpen,
        onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
        onSessionTreeOpenChange: setSessionTreeOpen,
      }}
    />
  )
}
