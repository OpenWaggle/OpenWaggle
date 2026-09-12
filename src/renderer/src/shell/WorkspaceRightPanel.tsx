import { type ReactNode, useEffect } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useProject } from '@/features/sessions/hooks'
import {
  createSidePanelTerminal,
  terminalOwnerContext,
  terminalSidePanelLayoutKey,
  useTerminalStore,
} from '@/features/terminal'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { api } from '@/shared/lib/ipc'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { useUIStore } from './ui-store'
import { useBrowserPreviewOwnerRegistration } from './useBrowserPreviewOwnerRegistration'
import { WorkspacePanelContent } from './WorkspacePanelContent'
import { WorkspaceSurfaceTabs } from './WorkspaceSurfaceTabs'
import { closeBrowserTabs } from './workspace-browser-close'
import { collectOwnerReconciliationErrors } from './workspace-owner-reconciliation'
import { newWorkspaceBrowser } from './workspace-panel-actions'
import {
  type BrowserPreviewTabState,
  useWorkspacePanelStore,
  type WorkspacePanelSurface,
} from './workspace-panel-store'

const SIDE_PANEL_DEFAULT_WIDTH = 520
const SIDE_PANEL_MIN_WIDTH = 320
const SIDE_PANEL_MAX_WIDTH = 900
const SIDE_PANEL_MAIN_MIN_WIDTH = 420
const SIDE_PANEL_SHEET_BREAKPOINT_PX = 980
const SIDE_PANEL_STORAGE_KEY = 'openwaggle:workspace-side-panel-width'

interface WorkspaceRightPanelProps {
  readonly children: ReactNode
}

function hasOpenTerminalGroup(
  group: { readonly panelOpen: boolean; readonly tabs: readonly unknown[] } | undefined,
) {
  return group?.panelOpen === true && group.tabs.length > 0
}

function activeBrowserForSurface(
  surface: WorkspacePanelSurface,
  tabs: readonly BrowserPreviewTabState[],
) {
  return surface?.kind === 'browser'
    ? (tabs.find((tab) => tab.id === surface.previewId) ?? null)
    : null
}

function reconcileClosedBrowsers(ownerKey: string, closedIds: readonly string[]) {
  const closed = new Set(closedIds)
  const store = useWorkspacePanelStore.getState()
  const group = store.groups[ownerKey]
  const claim = useRightSidebarCoordinator.getState().activeClaim
  const sideGroup = useTerminalStore.getState().groups[terminalSidePanelLayoutKey(ownerKey)]
  const shouldRevealTerminal =
    claim?.kind === 'workspace' &&
    claim.ownerKey === ownerKey &&
    hasOpenTerminalGroup(sideGroup) &&
    group?.panelOpen === true &&
    group.activeSurface?.kind === 'browser' &&
    closed.has(group.activeSurface.previewId) &&
    group.browserTabs.every((tab) => closed.has(tab.id))
  return collectOwnerReconciliationErrors([
    () => {
      if (closedIds.length > 0) store.closeBrowsers(ownerKey, closedIds)
    },
    () => {
      if (shouldRevealTerminal) store.showTerminal(ownerKey)
    },
  ])
}

/**
 * Shell-level right panel for persistent Session surfaces. A docked terminal
 * uses a distinct renderer layout bucket while retaining the Session's one
 * runtime owner, so it can coexist with the bottom drawer without duplicate
 * PTY viewports or split lifecycle ownership.
 */
export function WorkspaceRightPanel({ children }: WorkspaceRightPanelProps) {
  const panel = useWorkspaceRightPanelModel()
  const isSheet = useMediaQuery(`(max-width: ${String(SIDE_PANEL_SHEET_BREAKPOINT_PX)}px)`)

  return (
    <RightSidebarLayout
      maximized={panel.maximized}
      open={panel.activeSurface !== null}
      sizing={{
        defaultWidth: SIDE_PANEL_DEFAULT_WIDTH,
        mainMinWidth: SIDE_PANEL_MAIN_MIN_WIDTH,
        maxWidth: SIDE_PANEL_MAX_WIDTH,
        minWidth: SIDE_PANEL_MIN_WIDTH,
        sheetBreakpointPx: SIDE_PANEL_SHEET_BREAKPOINT_PX,
        storageKey: SIDE_PANEL_STORAGE_KEY,
      }}
      sidebar={
        <div className="flex size-full min-h-0 flex-col" data-testid="workspace-right-panel">
          <WorkspaceSurfaceTabs
            model={{
              activeSurface: panel.activeSurface,
              browserTabs: panel.browserTabs,
              canCreateTerminal: panel.owner.defaultCwd !== null,
              canMaximize: !isSheet,
              hasTerminal: panel.hasTerminal,
              maximized: panel.maximized,
            }}
            actions={{
              closeBrowsers: panel.closeBrowsers,
              closePanel: panel.hidePanel,
              newBrowser: panel.newBrowser,
              newTerminal: panel.newSideTerminal,
              selectBrowser: panel.showBrowser,
              selectTerminal: panel.showTerminal,
              setBrowserAudioMuted: panel.setBrowserAudioMuted,
              toggleMaximized: panel.toggleMaximized,
            }}
          />
          <WorkspacePanelContent
            activeBrowser={panel.activeBrowser}
            activeSurface={panel.activeSurface}
            onCloseBrowser={panel.closeBrowser}
            onReturnToDrawer={panel.returnToDrawer}
            owner={panel.owner}
            sidePanelKey={panel.sidePanelKey}
          />
        </div>
      }
      onOpenChange={(open) => {
        if (!open) panel.hidePanel()
      }}
    >
      {children}
    </RightSidebarLayout>
  )
}

function useWorkspaceRightPanelModel() {
  const { activeSession } = useChat()
  const { projectPath } = useProject()
  const owner = terminalOwnerContext(activeSession, projectPath)
  const sidePanelKey = terminalSidePanelLayoutKey(owner.ownerKey)
  const sideGroup = useTerminalStore((state) => state.groups[sidePanelKey])
  const hasTerminal = hasOpenTerminalGroup(sideGroup)
  const panelGroup = useWorkspacePanelStore((state) => state.groups[owner.ownerKey])
  const browserTabs = panelGroup?.browserTabs ?? []
  const requestedSurface = panelGroup?.panelOpen
    ? resolveActiveSurface(panelGroup.activeSurface, {
        browserTabs,
        hasTerminal,
      })
    : null
  const activeSurface = useCoordinatedWorkspaceSurface(owner.ownerKey, requestedSurface)
  const maximized = panelGroup?.maximized ?? false
  const activeBrowser = activeBrowserForSurface(activeSurface, browserTabs)
  const showToast = useUIStore((state) => state.showToast)
  useCurrentBrowserPreview(owner.ownerKey, panelGroup?.activeSurface ?? null, browserTabs)

  const returnToDrawer = () => {
    if (owner.ownerKey.length === 0 || sidePanelKey.length === 0) return
    useTerminalStore.getState().moveAllTabs(sidePanelKey, owner.ownerKey)
    useWorkspacePanelStore.getState().hideTerminal(owner.ownerKey)
  }

  const closeBrowsers = async (previewIds: readonly string[]) => {
    const ids = new Set(previewIds)
    const targets = browserTabs.filter((tab) => ids.has(tab.id))
    if (targets.length === 0) return
    try {
      const { closedIds, errors } = await closeBrowserTabs(targets)
      errors.push(...reconcileClosedBrowsers(owner.ownerKey, closedIds))
      if (errors.length > 0) throw errors[0]
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Browser tabs could not close.', 'error')
    }
  }
  const closeBrowser = (previewId: string) => void closeBrowsers([previewId])

  const hidePanel = () => useWorkspacePanelStore.getState().hidePanel(owner.ownerKey)
  const newBrowser = () => void newWorkspaceBrowser(owner.ownerKey)
  const newSideTerminal = () => createSidePanelTerminal(owner.ownerKey, owner.defaultCwd)
  const toggleMaximized = () =>
    useWorkspacePanelStore.getState().setMaximized(owner.ownerKey, !maximized)
  const setBrowserAudioMuted = (previewId: string, audioMuted: boolean) => {
    void api
      .setBrowserPreviewAudioMuted(previewId, audioMuted)
      .then((state) => {
        useWorkspacePanelStore.getState().updateBrowser(state.ownerKey, state.previewId, {
          audioMuted: state.audioMuted,
          audible: state.audible,
          favicon: state.favicon,
          controller: state.controller,
        })
      })
      .catch((error: unknown) => {
        showToast(
          error instanceof Error ? error.message : 'Browser tab audio could not change.',
          'error',
        )
      })
  }

  return {
    activeBrowser,
    activeSurface,
    browserTabs,
    closeBrowser,
    closeBrowsers: (previewIds: readonly string[]) => void closeBrowsers(previewIds),
    hasTerminal,
    hidePanel,
    maximized,
    newBrowser,
    newSideTerminal,
    owner,
    returnToDrawer,
    setBrowserAudioMuted,
    showBrowser: (previewId: string) =>
      useWorkspacePanelStore.getState().showBrowser(owner.ownerKey, previewId),
    showTerminal: () => useWorkspacePanelStore.getState().showTerminal(owner.ownerKey),
    sidePanelKey,
    toggleMaximized,
  }
}

function useCurrentBrowserPreview(
  ownerKey: string,
  selectedSurface: WorkspacePanelSurface,
  tabs: readonly BrowserPreviewTabState[],
) {
  const selectedPreviewId =
    selectedSurface?.kind === 'browser' &&
    tabs.some((tab) => tab.id === selectedSurface.previewId && tab.kind === 'preview')
      ? selectedSurface.previewId
      : null
  useBrowserPreviewOwnerRegistration(ownerKey, selectedPreviewId)
}

function useCoordinatedWorkspaceSurface(
  ownerKey: string,
  requestedSurface: WorkspacePanelSurface,
): WorkspacePanelSurface {
  const activeClaim = useRightSidebarCoordinator((state) => state.activeClaim)
  const surfaceRequested = requestedSurface !== null

  useEffect(() => {
    const coordinator = useRightSidebarCoordinator.getState()
    if (!surfaceRequested) {
      coordinator.releaseWorkspace(ownerKey)
      return
    }
    if (coordinator.activeClaim?.kind === 'route') return
    coordinator.claimWorkspace(ownerKey)
    return () => useRightSidebarCoordinator.getState().releaseWorkspace(ownerKey)
  }, [ownerKey, surfaceRequested])

  return activeClaim?.kind === 'workspace' && activeClaim.ownerKey === ownerKey
    ? requestedSurface
    : null
}

function resolveActiveSurface(
  requested: WorkspacePanelSurface,
  available: {
    readonly browserTabs: readonly { readonly id: string }[]
    readonly hasTerminal: boolean
  },
): WorkspacePanelSurface {
  if (requested?.kind === 'terminal' && available.hasTerminal) return requested
  if (
    requested?.kind === 'browser' &&
    available.browserTabs.some((tab) => tab.id === requested.previewId)
  ) {
    return requested
  }
  if (available.hasTerminal) return { kind: 'terminal' }
  const browser = available.browserTabs[available.browserTabs.length - 1]
  return browser === undefined ? null : { kind: 'browser', previewId: browser.id }
}
