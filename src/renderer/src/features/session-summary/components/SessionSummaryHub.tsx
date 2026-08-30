import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { SessionDetail } from '@shared/types/session'
import { ChevronRight, Info } from 'lucide-react'
import { useState } from 'react'
import { useCombinedVcsStatus } from '@/features/git'
import { useGit } from '@/features/git/hooks'
import { Button } from '@/shared/ui/Button'
import { useSessionResources } from '../hooks/useSessionResources'
import { ChangeRequestComposer } from './ChangeRequestComposer'
import { ExtensionSessionSummarySections } from './ExtensionSessionSummarySections'
import { HiveSummarySection } from './HiveSummarySection'
import { EnvironmentSummarySection, ResourceSummarySection } from './SessionSummarySections'

function readExpanded(sessionId: string, key: string, fallback: boolean) {
  const stored = localStorage.getItem(`openwaggle:session-summary:${sessionId}:${key}`)
  return stored === null ? fallback : stored === 'true'
}

function usePersistedExpanded(sessionId: string, key: string, fallback: boolean) {
  const [expanded, setExpanded] = useState(() => readExpanded(sessionId, key, fallback))
  const update = (next: boolean) => {
    setExpanded(next)
    localStorage.setItem(`openwaggle:session-summary:${sessionId}:${key}`, String(next))
  }
  return [expanded, update] as const
}

export interface SessionSummaryHubInput {
  readonly session: SessionDetail | null
  readonly messageCount: number
  readonly hidden: boolean
  readonly onOpenDiff: () => void
  readonly onOpenResources: () => void
  readonly onNavigateSession: (sessionId: string) => void
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
}

export function SessionSummaryHub({ input }: { readonly input: SessionSummaryHubInput }) {
  const {
    session,
    messageCount,
    hidden,
    onOpenDiff,
    onOpenResources,
    onNavigateSession,
    extensionRegistry,
    extensionProjectPaths,
  } = input
  const sessionId = session ? String(session.id) : 'none'
  const [panelExpanded, setPanelExpanded] = usePersistedExpanded(sessionId, 'panel', true)
  const [environmentExpanded, setEnvironmentExpanded] = usePersistedExpanded(
    sessionId,
    'environment',
    true,
  )
  const [outputsExpanded, setOutputsExpanded] = usePersistedExpanded(sessionId, 'outputs', false)
  const [sourcesExpanded, setSourcesExpanded] = usePersistedExpanded(sessionId, 'sources', false)
  const [composerOpen, setComposerOpen] = useState(false)
  const git = useGit()
  const combined = useCombinedVcsStatus(git.workingPath, messageCount)
  const resources = useSessionResources(session ? sessionId : null, messageCount)

  if (!session || messageCount === 0 || hidden) return null

  const allResources = resources.data ?? []
  const outputs = allResources.filter((resource) => resource.isOutput)
  const sources = allResources.filter((resource) => resource.isSource)
  if (!panelExpanded) {
    return (
      <Button
        variant="secondary"
        size="icon-sm"
        className="absolute right-4 top-4 z-20 rounded-full shadow-lg"
        aria-label="Open Session Summary"
        onClick={() => setPanelExpanded(true)}
      >
        <Info className="size-4" />
      </Button>
    )
  }

  return (
    <>
      <aside
        aria-label="Session Summary"
        className="absolute right-4 top-4 z-20 w-80 overflow-hidden rounded-2xl border border-border-light bg-bg-secondary/95 shadow-2xl backdrop-blur"
      >
        <header className="flex h-11 items-center justify-between px-3">
          <h2 className="text-sm font-semibold text-text-primary">Session Summary</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse Session Summary"
            onClick={() => setPanelExpanded(false)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </header>

        <EnvironmentSummarySection
          expanded={environmentExpanded}
          environmentMode={session.environmentMode ?? 'local'}
          gitStatus={git.status}
          vcsStatus={combined.status}
          onExpandedChange={setEnvironmentExpanded}
          onOpenDiff={onOpenDiff}
          onCreateChangeRequest={() => setComposerOpen(true)}
        />

        <HiveSummarySection sessionId={sessionId} onNavigateSession={onNavigateSession} />

        <ResourceSummarySection
          title="Outputs"
          resources={outputs}
          expanded={outputsExpanded}
          onExpandedChange={setOutputsExpanded}
          onOpenResources={onOpenResources}
        />
        <ResourceSummarySection
          title="Sources"
          resources={sources}
          expanded={sourcesExpanded}
          onExpandedChange={setSourcesExpanded}
          onOpenResources={onOpenResources}
        />
        <ExtensionSessionSummarySections
          registry={extensionRegistry}
          projectPaths={extensionProjectPaths}
          sessionId={sessionId}
          messageCount={messageCount}
        />
      </aside>

      {composerOpen && git.workingPath ? (
        <ChangeRequestComposer
          session={session}
          workingPath={git.workingPath}
          gitStatus={git.status}
          vcsStatus={combined.status}
          onClose={() => setComposerOpen(false)}
          onCompleted={() => {
            void combined.refresh()
            void git.refreshStatus(git.workingPath)
          }}
        />
      ) : null}
    </>
  )
}
