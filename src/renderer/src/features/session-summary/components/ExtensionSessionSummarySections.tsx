import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonObject } from '@shared/types/json'
import { Puzzle } from 'lucide-react'
import {
  ExtensionContributionRuntimeHost,
  resolveExtensionAgentLoopContributionEntries,
} from '@/features/extensions'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'

const MIN_EXTENSION_SECTION_HEIGHT = 64
const MAX_EXTENSION_SECTION_HEIGHT = 200

export function ExtensionSessionSummarySections({
  registry,
  projectPaths,
  sessionId,
  messageCount,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly projectPaths: readonly string[]
  readonly sessionId: string
  readonly messageCount: number
}) {
  if (!registry) return null
  const contributions = resolveExtensionAgentLoopContributionEntries({
    registry,
    target: { surface: 'transcript' },
    requestedProjectPaths: projectPaths,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS,
  })
  if (contributions.length === 0) return null
  const payload = {
    surface: 'session-summary',
    sessionId,
    projectPaths: [...projectPaths],
    messageCount,
  } satisfies JsonObject

  return contributions.map((contribution) => (
    <section
      key={`${contribution.entry.packagePath}:${contribution.entry.contributionId}`}
      className="border-t border-border p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <Puzzle className="size-3.5 text-accent" />
        <h3 className="truncate text-xs font-semibold text-text-primary">
          {contribution.entry.title}
        </h3>
      </div>
      <PanelErrorBoundary name={`Session Summary extension: ${contribution.entry.title}`}>
        <ExtensionContributionRuntimeHost
          autoHeight
          chrome="bare"
          entry={contribution.entry}
          minAutoHeight={MIN_EXTENSION_SECTION_HEIGHT}
          maxAutoHeight={MAX_EXTENSION_SECTION_HEIGHT}
          surfacePayload={payload}
        />
      </PanelErrorBoundary>
    </section>
  ))
}
