import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { SessionDetail } from '@shared/types/session'
import type { SessionResourceBrowserTarget } from '../model/session-resource-browser'
import type { SessionSummaryExtensionSidePanelTarget } from './session-summary-extension-actions'

export interface SessionSummaryHubInput {
  readonly session: SessionDetail | null
  readonly activeBranchId?: string | null
  readonly activePathNodeIds?: readonly string[]
  readonly messageCount: number
  /** A newly spawned Worker can need Hive navigation before its first message. */
  readonly hiveAvailable?: boolean
  readonly workspaceActivityAvailable?: boolean
  readonly autoHidden: boolean
  readonly rightSidebarOpen: boolean
  readonly onOpenDiff: () => void
  readonly onOpenChangeRequest?: (url: string) => void
  readonly onOpenResources: (target: SessionResourceBrowserTarget) => void
  readonly onNavigateSession: (sessionId: string) => void
  readonly onOpenExtensionSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
}

export function hasSummaryContent(input: SessionSummaryHubInput) {
  return (
    input.messageCount > 0 ||
    input.hiveAvailable === true ||
    input.workspaceActivityAvailable === true
  )
}
