import type { RightSidebarPanel } from '@/shell'
import type { ChatExtensionSidePanelTarget } from './-route-search'

interface ResolveRightSidebarPanelInput {
  readonly changeRequestOpen?: boolean
  readonly diffOpen: boolean
  readonly fileOpen?: boolean
  readonly extensionSidePanel: ChatExtensionSidePanelTarget | null
  readonly lastPanel: RightSidebarPanel
  readonly resourcesOpen?: boolean
  readonly sessionTreeOpen: boolean
  readonly hiveOpen: boolean
}

interface ChatRightSidebarSelection {
  readonly changeRequestUrl?: string | null
  readonly diffOpen: boolean
  readonly extensionSidePanel: ChatExtensionSidePanelTarget | null
  readonly resourcesTarget: unknown
  readonly sessionTreeOpen: boolean
  readonly hiveOpen: boolean
  readonly workspaceFile: unknown
}

export function resolveRightSidebarPanel(input: ResolveRightSidebarPanelInput) {
  if (input.changeRequestOpen) {
    const panel: RightSidebarPanel = 'change-request'
    return panel
  }
  if (input.fileOpen) {
    const panel: RightSidebarPanel = 'file'
    return panel
  }
  if (input.resourcesOpen) {
    const panel: RightSidebarPanel = 'resources'
    return panel
  }
  if (input.sessionTreeOpen) {
    const panel: RightSidebarPanel = 'session-tree'
    return panel
  }
  if (input.hiveOpen) {
    const panel: RightSidebarPanel = 'hive'
    return panel
  }

  if (input.extensionSidePanel) {
    const panel: RightSidebarPanel = {
      kind: 'extension-side-panel',
      extensionId: input.extensionSidePanel.extensionId,
      sidePanelId: input.extensionSidePanel.sidePanelId,
      ...(input.extensionSidePanel.packagePath
        ? { packagePath: input.extensionSidePanel.packagePath }
        : {}),
      ...(input.extensionSidePanel.contentHash
        ? { contentHash: input.extensionSidePanel.contentHash }
        : {}),
    }
    return panel
  }

  if (input.diffOpen) {
    const panel: RightSidebarPanel = 'diff'
    return panel
  }

  return input.lastPanel
}

export function resolveChatRightSidebarPanel(
  state: ChatRightSidebarSelection,
  lastPanel: RightSidebarPanel,
) {
  return resolveRightSidebarPanel({
    changeRequestOpen: state.changeRequestUrl !== null && state.changeRequestUrl !== undefined,
    diffOpen: state.diffOpen,
    fileOpen: state.workspaceFile !== null,
    extensionSidePanel: state.extensionSidePanel,
    lastPanel,
    resourcesOpen: state.resourcesTarget !== null,
    sessionTreeOpen: state.sessionTreeOpen,
    hiveOpen: state.hiveOpen,
  })
}

export function isExtensionRightSidebarPanel(
  panel: RightSidebarPanel,
): panel is Extract<RightSidebarPanel, { readonly kind: 'extension-side-panel' }> {
  return typeof panel === 'object' && panel.kind === 'extension-side-panel'
}
