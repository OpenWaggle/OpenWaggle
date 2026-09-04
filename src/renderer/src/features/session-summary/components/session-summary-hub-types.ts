import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { SessionDetail } from '@shared/types/session'
import type { SessionResourceBrowserTarget } from '../model/session-resource-browser'
import type { SessionSummaryExtensionSidePanelTarget } from './session-summary-extension-actions'

export interface SessionSummaryHubInput {
  readonly session: SessionDetail | null
  readonly messageCount: number
  readonly autoHidden: boolean
  readonly rightSidebarOpen: boolean
  readonly onOpenDiff: () => void
  readonly onOpenResources: (target: SessionResourceBrowserTarget) => void
  readonly onNavigateSession: (sessionId: string) => void
  readonly onOpenExtensionSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
}
