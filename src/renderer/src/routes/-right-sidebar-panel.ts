import type { RightSidebarPanel } from '@/shell'
import type { ChatExtensionSidePanelTarget } from './-route-search'

interface ResolveRightSidebarPanelInput {
  readonly diffOpen: boolean
  readonly extensionSidePanel: ChatExtensionSidePanelTarget | null
  readonly lastPanel: RightSidebarPanel
  readonly sessionTreeOpen: boolean
}

export function resolveRightSidebarPanel(input: ResolveRightSidebarPanelInput): RightSidebarPanel {
  if (input.sessionTreeOpen) {
    return 'session-tree'
  }

  if (input.extensionSidePanel) {
    return {
      kind: 'extension-side-panel',
      extensionId: input.extensionSidePanel.extensionId,
      sidePanelId: input.extensionSidePanel.sidePanelId,
    }
  }

  if (input.diffOpen) {
    return 'diff'
  }

  return input.lastPanel
}

export function isExtensionRightSidebarPanel(
  panel: RightSidebarPanel,
): panel is Extract<RightSidebarPanel, { readonly kind: 'extension-side-panel' }> {
  return typeof panel === 'object' && panel.kind === 'extension-side-panel'
}
