import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { Activity } from 'lucide-react'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import {
  type ExtensionAgentLoopAuxiliaryContribution,
  resolveExtensionAgentLoopAuxiliaryContributions,
} from '../lib/extension-agent-loop-auxiliary-surfaces'
import type { ExtensionAgentLoopSurfaceInput } from '../lib/extension-agent-loop-surface-model'
import { ExtensionFederatedModuleHost } from './ExtensionFederatedModuleHost'

const STATUS_WIDGET_MAX_HEIGHT = 160
const STATUS_WIDGET_MIN_HEIGHT = 72

function ExtensionAgentLoopStatusWidget({
  auxiliary,
  onSurfaceAction,
}: {
  readonly auxiliary: ExtensionAgentLoopAuxiliaryContribution
  readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void
}) {
  const entry = auxiliary.contribution.entry

  return (
    <PanelErrorBoundary name={`Extension status widget: ${entry.title}`}>
      <section className="rounded-lg border border-border/80 bg-bg-secondary/40 p-2">
        <div className="mb-2 flex min-w-0 items-center gap-2 text-[11px] text-text-tertiary">
          <Activity className="size-3.5 shrink-0 text-accent" />
          <span className="truncate font-medium text-text-secondary">{entry.title}</span>
        </div>
        <ExtensionFederatedModuleHost
          autoHeight
          chrome="bare"
          entry={entry}
          maxAutoHeight={STATUS_WIDGET_MAX_HEIGHT}
          minAutoHeight={STATUS_WIDGET_MIN_HEIGHT}
          onSurfaceAction={onSurfaceAction}
          surfacePayload={auxiliary.surfacePayload}
        />
      </section>
    </PanelErrorBoundary>
  )
}

export function ExtensionAgentLoopStatusWidgets({
  input,
  registry,
  projectPaths,
  onSurfaceAction,
}: {
  readonly input: ExtensionAgentLoopSurfaceInput
  readonly registry: ExtensionContributionRegistryView | null
  readonly projectPaths: readonly string[]
  readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void
}) {
  const widgets = resolveExtensionAgentLoopAuxiliaryContributions({
    input,
    registry,
    projectPaths,
    placement: 'status-widget',
  })

  if (widgets.length === 0) {
    return null
  }

  return (
    <section aria-label="Extension status widgets" className="grid gap-2">
      {widgets.map((auxiliary) => (
        <ExtensionAgentLoopStatusWidget
          auxiliary={auxiliary}
          key={`${auxiliary.contribution.entry.packagePath}:${auxiliary.contribution.entry.contentHash}:${auxiliary.contribution.entry.contributionId}`}
          onSurfaceAction={onSurfaceAction}
        />
      ))}
    </section>
  )
}
