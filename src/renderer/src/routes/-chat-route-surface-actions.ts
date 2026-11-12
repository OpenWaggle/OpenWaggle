import { useEffect } from 'react'
import type { useChatPanelSections } from '@/features/chat/hooks'
import type { SessionResourceBrowserTarget } from '@/features/session-summary'
import { useUIStore } from '@/shell'
import type { ChatRightSidebarRouteActions, ChatRouteSurfaceHandlers } from './-chat-route-surface'
import {
  coordinateChangeRequestPanel,
  coordinateDiffPanel,
  coordinateExtensionPanel,
  coordinateHivePanel,
  coordinateResourcesPanel,
  coordinateSessionTreePanel,
  coordinateWorkspaceFilePanel,
} from './-right-sidebar-coordination'
import type { ChatExtensionSidePanelTarget } from './-route-search'

export function useChatRouteSurfaceActions(
  sections: ReturnType<typeof useChatPanelSections>,
  rightSidebarActions: ChatRightSidebarRouteActions,
): ChatRouteSurfaceHandlers {
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
    coordinateDiffPanel(open)
    setLastRightSidebarPanel('diff')
    rightSidebarActions.onDiffOpenChange(open)
  }

  function handleChangeRequestOpenChange(open: boolean, url?: string) {
    coordinateChangeRequestPanel(open)
    setLastRightSidebarPanel('change-request')
    rightSidebarActions.onChangeRequestOpenChange?.(open, url)
  }

  function handleSessionTreeOpenChange(open: boolean) {
    coordinateSessionTreePanel(open)
    setLastRightSidebarPanel('session-tree')
    rightSidebarActions.onSessionTreeOpenChange(open)
  }

  function handleHiveOpenChange(open: boolean) {
    coordinateHivePanel(open)
    setLastRightSidebarPanel('hive')
    rightSidebarActions.onHiveOpenChange(open)
  }

  function handleResourcesTargetChange(target: SessionResourceBrowserTarget | null) {
    coordinateResourcesPanel(target !== null)
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
    coordinateExtensionPanel(open, routeTarget)
    setLastRightSidebarPanel({ kind: 'extension-side-panel', ...routeTarget })
    rightSidebarActions.onExtensionSidePanelOpenChange(open, routeTarget)
  }

  function handleWorkspaceFileOpenChange(
    open: boolean,
    target?: { readonly path: string; readonly line?: number | null },
  ) {
    coordinateWorkspaceFilePanel(open, target)
    setLastRightSidebarPanel('file')
    rightSidebarActions.onWorkspaceFileOpenChange(open, target)
  }

  return {
    handleChangeRequestOpenChange,
    handleDiffOpenChange,
    handleExtensionSidePanelOpenChange,
    handleResourcesTargetChange,
    handleSessionTreeOpenChange,
    handleHiveOpenChange,
    handleWorkspaceFileOpenChange,
  }
}
