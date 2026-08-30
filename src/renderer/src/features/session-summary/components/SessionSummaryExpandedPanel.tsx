import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import { ChevronRight } from 'lucide-react'
import type { GitQuickAction } from '@/features/git'
import { Button } from '@/shared/ui/Button'
import {
  ExtensionSessionSummarySections,
  type SessionSummaryExtensionSidePanelTarget,
} from './ExtensionSessionSummarySections'
import { HiveSummarySection } from './HiveSummarySection'
import { EnvironmentSummarySection, ResourceSummarySection } from './SessionSummarySections'

export interface SessionSummaryExpandedPanelInput {
  readonly session: SessionDetail
  readonly sessionId: string
  readonly messageCount: number
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly quickAction: GitQuickAction
  readonly environmentExpanded: boolean
  readonly outputsExpanded: boolean
  readonly sourcesExpanded: boolean
  readonly outputs: readonly SessionResource[]
  readonly sources: readonly SessionResource[]
  readonly resources: readonly SessionResource[]
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
  readonly onCollapse: () => void
  readonly onEnvironmentExpandedChange: (expanded: boolean) => void
  readonly onOutputsExpandedChange: (expanded: boolean) => void
  readonly onSourcesExpandedChange: (expanded: boolean) => void
  readonly onOpenDiff: () => void
  readonly onOpenResources: () => void
  readonly onNavigateSession: (sessionId: string) => void
  readonly onCreateChangeRequest: () => void
  readonly onQuickAction: () => void
  readonly onOpenExtensionSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
}

function ExtensionSections({
  input,
  placement,
}: {
  readonly input: SessionSummaryExpandedPanelInput
  readonly placement: 'context' | 'coordination' | 'details'
}) {
  return (
    <ExtensionSessionSummarySections
      registry={input.extensionRegistry}
      projectPaths={input.extensionProjectPaths}
      sessionId={input.sessionId}
      messageCount={input.messageCount}
      placement={placement}
      resources={input.resources}
      onOpenResources={input.onOpenResources}
      onOpenSidePanel={input.onOpenExtensionSidePanel}
    />
  )
}

export function SessionSummaryExpandedPanel({
  input,
}: {
  readonly input: SessionSummaryExpandedPanelInput
}) {
  return (
    <div className="pointer-events-none absolute inset-y-4 right-4 z-20 flex items-start">
      <aside
        aria-label="Session Summary"
        className="pointer-events-auto flex max-h-full w-80 flex-col overflow-hidden rounded-2xl border border-border-light bg-bg-secondary/95 shadow-2xl backdrop-blur"
      >
        <header className="flex h-11 items-center justify-between px-3">
          <h2 className="text-sm font-semibold text-text-primary">Session Summary</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse Session Summary"
            onClick={input.onCollapse}
          >
            <ChevronRight className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <EnvironmentSummarySection
            input={{
              expanded: input.environmentExpanded,
              environmentMode: input.session.environmentMode ?? 'local',
              gitStatus: input.gitStatus,
              vcsStatus: input.vcsStatus,
              onExpandedChange: input.onEnvironmentExpandedChange,
              onOpenDiff: input.onOpenDiff,
              onCreateChangeRequest: input.onCreateChangeRequest,
              quickAction: input.quickAction,
              onQuickAction: input.onQuickAction,
            }}
          />
          <ExtensionSections input={input} placement="context" />
          <HiveSummarySection
            sessionId={input.sessionId}
            onNavigateSession={input.onNavigateSession}
          />
          <ExtensionSections input={input} placement="coordination" />
          <ResourceSummarySection
            title="Outputs"
            resources={input.outputs}
            expanded={input.outputsExpanded}
            onExpandedChange={input.onOutputsExpandedChange}
            onOpenResources={input.onOpenResources}
          />
          <ResourceSummarySection
            title="Sources"
            resources={input.sources}
            expanded={input.sourcesExpanded}
            onExpandedChange={input.onSourcesExpandedChange}
            onOpenResources={input.onOpenResources}
          />
          <ExtensionSections input={input} placement="details" />
        </div>
      </aside>
    </div>
  )
}
