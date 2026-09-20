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
}

interface ChatRightSidebarSelection {
  readonly changeRequestUrl?: string | null
  readonly diffOpen: boolean
  readonly extensionSidePanel: ChatExtensionSidePanelTarget | null
  readonly resourcesTarget: unknown | null
  readonly sessionTreeOpen: boolean
  readonly workspaceFile: unknown | null
}

export function resolveRightSidebarPanel(input: ResolveRightSidebarPanelInput): RightSidebarPanel {
  if (input.changeRequestOpen) {
    return 'change-request'
  }
  if (input.fileOpen) {
    return 'file'
  }
  if (input.resourcesOpen) {
    return 'resources'
  }
  if (input.sessionTreeOpen) {
    return 'session-tree'
  }

  if (input.extensionSidePanel) {
    return {
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
  }

  if (input.diffOpen) {
    return 'diff'
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
  })
}

export function isExtensionRightSidebarPanel(
  panel: RightSidebarPanel,
): panel is Extract<RightSidebarPanel, { readonly kind: 'extension-side-panel' }> {
  return typeof panel === 'object' && panel.kind === 'extension-side-panel'
}
