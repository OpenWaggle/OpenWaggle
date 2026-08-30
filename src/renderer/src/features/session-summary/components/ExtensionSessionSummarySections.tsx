import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryView,
  ExtensionSessionSummaryRowView,
} from '@shared/types/extensions'
import type { SessionResource } from '@shared/types/session-resource'
import { Puzzle } from 'lucide-react'
import { ExtensionDialogSurface } from '@/features/extensions'
import { Button } from '@/shared/ui/Button'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import {
  isEligibleSessionSummaryEntry,
  matchingSessionSummaryAction,
  type SessionSummaryExtensionSidePanelTarget,
  useSessionSummaryExtensionActions,
} from './session-summary-extension-actions'

type SessionSummaryPlacement = 'context' | 'coordination' | 'details'
const EMPTY_REGISTRY: ExtensionContributionRegistryView = { projectPaths: [], entries: [] }

export type { SessionSummaryExtensionSidePanelTarget } from './session-summary-extension-actions'

function SummaryRow({
  row,
  actionable,
  onActivate,
}: {
  readonly row: ExtensionSessionSummaryRowView
  readonly actionable: boolean
  readonly onActivate: () => void
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-left text-xs text-text-secondary">
        {row.label}
      </span>
      {row.value ? <span className="truncate text-xs text-text-primary">{row.value}</span> : null}
      {row.badge ? (
        <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          {row.badge}
        </span>
      ) : null}
      {row.count !== undefined ? (
        <span className="font-mono text-xs tabular-nums text-text-tertiary">{row.count}</span>
      ) : null}
    </>
  )

  return actionable ? (
    <Button
      variant="unstyled"
      className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 hover:bg-bg-hover"
      onClick={onActivate}
    >
      {content}
    </Button>
  ) : (
    <div className="flex h-7 items-center gap-2 px-1.5">{content}</div>
  )
}

export function ExtensionSessionSummarySections({
  registry,
  projectPaths,
  sessionId,
  messageCount,
  placement,
  resources,
  onOpenResources,
  onOpenSidePanel,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly projectPaths: readonly string[]
  readonly sessionId: string
  readonly messageCount: number
  readonly placement: SessionSummaryPlacement
  readonly resources: readonly SessionResource[]
  readonly onOpenResources: () => void
  readonly onOpenSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
}) {
  const activeRegistry = registry ?? EMPTY_REGISTRY
  const actions = useSessionSummaryExtensionActions({
    registry: activeRegistry,
    projectPaths,
    sessionId,
    messageCount,
    resources,
    onOpenResources,
    onOpenSidePanel,
  })
  if (!registry) return null

  const contributions = activeRegistry.entries.filter(
    (entry) =>
      entry.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS &&
      entry.sessionSummary?.placement === placement &&
      isEligibleSessionSummaryEntry(entry),
  )
  if (contributions.length === 0) return null

  return (
    <>
      {contributions.map((contribution) => (
        <section
          key={`${contribution.packagePath}:${contribution.contentHash}:${contribution.contributionId}`}
          className="border-t border-border p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <Puzzle className="size-3.5 text-accent" />
            <h3 className="truncate text-xs font-semibold text-text-primary">
              {contribution.title}
            </h3>
          </div>
          <PanelErrorBoundary name={`Session Summary extension: ${contribution.title}`}>
            <div className="space-y-0.5">
              {contribution.sessionSummary?.rows.map((row) => {
                const actionable =
                  Boolean(row.resourceId) ||
                  matchingSessionSummaryAction({
                    registry: activeRegistry,
                    section: contribution,
                    row,
                  }) !== null
                return (
                  <SummaryRow
                    key={row.id}
                    row={row}
                    actionable={actionable}
                    onActivate={() => void actions.activateRow(contribution, row)}
                  />
                )
              })}
            </div>
          </PanelErrorBoundary>
        </section>
      ))}
      {actions.dialogEntry ? (
        <ExtensionDialogSurface
          target={{
            extensionId: actions.dialogEntry.extensionId,
            dialogId: actions.dialogEntry.contributionId,
            packagePath: actions.dialogEntry.packagePath,
            contentHash: actions.dialogEntry.contentHash,
          }}
          projectPaths={projectPaths}
          registry={activeRegistry}
          loading={false}
          error={null}
          onRefresh={() => {}}
          onClose={() => actions.setDialogEntry(null)}
          surfacePayload={actions.payload}
        />
      ) : null}
    </>
  )
}
