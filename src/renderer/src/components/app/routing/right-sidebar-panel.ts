import type { RightSidebarPanel } from '@/stores/ui-store'

interface ResolveRightSidebarPanelInput {
  readonly diffOpen: boolean
  readonly lastPanel: RightSidebarPanel
  readonly sessionTreeOpen: boolean
}

export function resolveRightSidebarPanel(input: ResolveRightSidebarPanelInput): RightSidebarPanel {
  if (input.sessionTreeOpen) {
    return 'session-tree'
  }

  if (input.diffOpen) {
    return 'diff'
  }

  return input.lastPanel
}
