import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import type { SessionResource } from '@shared/types/session-resource'
import { ExtensionDialogSurface } from '@/features/extensions'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import type { SessionResourceBrowserTarget } from '../model/session-resource-browser'
import { ExtensionSessionSummarySection } from './ExtensionSessionSummarySection'
import {
  isEligibleSessionSummaryEntry,
  type SessionSummaryExtensionSidePanelTarget,
  useSessionSummaryExtensionActions,
} from './session-summary-extension-actions'

type SessionSummaryPlacement = 'context' | 'coordination' | 'details'
const EMPTY_REGISTRY: ExtensionContributionRegistryView = { projectPaths: [], entries: [] }

export interface ExtensionSessionSummarySectionsProps {
  readonly registry: ExtensionContributionRegistryView | null
  readonly projectPaths: readonly string[]
  readonly sessionId: string
  readonly messageCount: number
  readonly placement: SessionSummaryPlacement
  readonly resources: readonly SessionResource[]
  readonly onOpenResources: (target: SessionResourceBrowserTarget) => void
  readonly onOpenSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
}

function entryMatchesSession(entry: ExtensionContributionRegistryEntry, sessionId: string) {
  return (
    (entry.sessionId === undefined || entry.sessionId === sessionId) &&
    (entry.target?.sessionIds === undefined || entry.target.sessionIds.includes(sessionId))
  )
}

export function SessionScopedExtensionSummarySections({
  registry,
  projectPaths,
  sessionId,
  messageCount,
  placement,
  resources,
  onOpenResources,
  onOpenSidePanel,
}: ExtensionSessionSummarySectionsProps) {
  const activeRegistry = registry ?? EMPTY_REGISTRY
  const sessionRegistry = {
    ...activeRegistry,
    entries: activeRegistry.entries.filter((entry) => entryMatchesSession(entry, sessionId)),
  } satisfies ExtensionContributionRegistryView
  const sessionResources = resources.filter((resource) => String(resource.sessionId) === sessionId)
  const actions = useSessionSummaryExtensionActions({
    registry: sessionRegistry,
    projectPaths,
    sessionId,
    messageCount,
    resources: sessionResources,
    onOpenResources,
    onOpenSidePanel,
  })
  if (!registry) return null

  const contributions = sessionRegistry.entries.filter(
    (entry) =>
      entry.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS &&
      entry.sessionSummary?.placement === placement &&
      isEligibleSessionSummaryEntry(entry),
  )
  if (contributions.length === 0) return null

  return (
    <>
      {contributions.map((contribution) => (
        <PanelErrorBoundary
          key={`${sessionId}:${contribution.packagePath}:${contribution.contentHash}:${contribution.contributionId}`}
          name={`Session Summary extension: ${contribution.title}`}
        >
          <ExtensionSessionSummarySection
            contribution={contribution}
            sessionId={sessionId}
            projectPath={projectPaths[0] ?? null}
            registry={sessionRegistry}
            onActivate={(row) => void actions.activateRow(contribution, row)}
          />
        </PanelErrorBoundary>
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
          registry={sessionRegistry}
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
