import { match } from '@diegogbrisa/ts-match'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { GitStackedAction } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { ListFilter } from 'lucide-react'
import { useState } from 'react'
import {
  CommitMessageDialog,
  resolveQuickAction,
  useCombinedVcsStatus,
  useStackedGitActions,
} from '@/features/git'
import { useGit } from '@/features/git/hooks'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useSessionResources } from '../hooks/useSessionResources'
import { ChangeRequestComposer } from './ChangeRequestComposer'
import type { SessionSummaryExtensionSidePanelTarget } from './ExtensionSessionSummarySections'
import { SessionSummaryExpandedPanel } from './SessionSummaryExpandedPanel'

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

function runSessionQuickAction(input: {
  readonly quickAction: ReturnType<typeof resolveQuickAction>
  readonly changeRequestUrl: string | undefined
  readonly run: (action: GitStackedAction) => unknown
  readonly openCommitDialog: (action: GitStackedAction) => void
  readonly openChangeRequestComposer: () => void
}) {
  match(input.quickAction.kind)
    .with('show_hint', () => {})
    .with('open_pr', () => {
      if (input.changeRequestUrl) void api.openExternal(input.changeRequestUrl)
    })
    .with('open_publish', () => void input.run('push'))
    .with('run_pull', () => void input.run('pull'))
    .with('run_action', () => {
      const action = input.quickAction.action
      if (!action) return
      if (action === 'commit' || action === 'commit_push') return input.openCommitDialog(action)
      if (action === 'create_pr' || action === 'commit_push_pr') {
        return input.openChangeRequestComposer()
      }
      return input.run(action)
    })
    .exhaustive()
}

function SessionSummaryToggle({
  expanded,
  panelId,
  onToggle,
}: {
  readonly expanded: boolean
  readonly panelId: string
  readonly onToggle: () => void
}) {
  return (
    <Button
      variant={expanded ? 'subtle' : 'secondary'}
      size="icon-sm"
      className="absolute right-4 top-4 z-30 shadow-lg"
      aria-controls={panelId}
      aria-expanded={expanded}
      aria-label={expanded ? 'Hide Session Summary' : 'Open Session Summary'}
      title={expanded ? 'Hide Session Summary' : 'Open Session Summary'}
      onClick={onToggle}
    >
      <ListFilter className="size-4" />
    </Button>
  )
}

function useSessionSummaryPanelVisibility(
  sessionId: string,
  autoHidden: boolean,
  rightSidebarOpen: boolean,
) {
  const [expanded, setExpanded] = usePersistedExpanded(sessionId, 'panel', true)
  const [forcedOpen, setForcedOpen] = useState(false)
  const visible = !rightSidebarOpen && expanded && (!autoHidden || forcedOpen)
  const close = () => {
    setExpanded(false)
    setForcedOpen(false)
  }
  const toggle = () => {
    if (visible) return close()
    setExpanded(true)
    setForcedOpen(autoHidden)
  }
  return { close, toggle, visible }
}

export interface SessionSummaryHubInput {
  readonly session: SessionDetail | null
  readonly messageCount: number
  readonly autoHidden: boolean
  readonly rightSidebarOpen: boolean
  readonly onOpenDiff: () => void
  readonly onOpenResources: () => void
  readonly onNavigateSession: (sessionId: string) => void
  readonly onOpenExtensionSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
}

export function SessionSummaryHub({ input }: { readonly input: SessionSummaryHubInput }) {
  const {
    session,
    messageCount,
    autoHidden,
    rightSidebarOpen,
    onOpenDiff,
    onOpenResources,
    onNavigateSession,
    onOpenExtensionSidePanel,
    extensionRegistry,
    extensionProjectPaths,
  } = input
  const sessionId = session ? String(session.id) : 'none'
  const panelId = `session-summary-${sessionId}`
  const panel = useSessionSummaryPanelVisibility(sessionId, autoHidden, rightSidebarOpen)
  const [environmentExpanded, setEnvironmentExpanded] = usePersistedExpanded(
    sessionId,
    'environment',
    true,
  )
  const [outputsExpanded, setOutputsExpanded] = usePersistedExpanded(sessionId, 'outputs', false)
  const [sourcesExpanded, setSourcesExpanded] = usePersistedExpanded(sessionId, 'sources', false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [pendingCommitAction, setPendingCommitAction] = useState<GitStackedAction | null>(null)
  const git = useGit()
  const combined = useCombinedVcsStatus(git.workingPath, messageCount)
  const stackedActions = useStackedGitActions({
    workingPath: git.workingPath,
    onCompleted: () => {
      void combined.refresh()
      if (git.workingPath) void git.refreshStatus(git.workingPath)
    },
  })
  const quickAction = resolveQuickAction(combined.status, stackedActions.isRunning)
  const resources = useSessionResources(session ? sessionId : null)

  if (!session || messageCount === 0) return null

  const allResources = resources.data ?? []
  const outputs = allResources.filter((resource) => resource.isOutput)
  const sources = allResources.filter((resource) => resource.isSource)
  const runQuickAction = () =>
    runSessionQuickAction({
      quickAction,
      changeRequestUrl: combined.status?.changeRequest?.url,
      run: stackedActions.run,
      openCommitDialog: setPendingCommitAction,
      openChangeRequestComposer: () => setComposerOpen(true),
    })

  return (
    <>
      <SessionSummaryToggle expanded={panel.visible} panelId={panelId} onToggle={panel.toggle} />
      {panel.visible ? (
        <SessionSummaryExpandedPanel
          input={{
            panelId,
            session,
            sessionId,
            messageCount,
            gitStatus: git.status,
            vcsStatus: combined.status,
            quickAction,
            environmentExpanded,
            outputsExpanded,
            sourcesExpanded,
            outputs,
            sources,
            resources: allResources,
            extensionRegistry,
            extensionProjectPaths,
            onCollapse: panel.close,
            onEnvironmentExpandedChange: setEnvironmentExpanded,
            onOutputsExpandedChange: setOutputsExpanded,
            onSourcesExpandedChange: setSourcesExpanded,
            onOpenDiff,
            onOpenResources,
            onNavigateSession,
            onCreateChangeRequest: () => setComposerOpen(true),
            onQuickAction: runQuickAction,
            onOpenExtensionSidePanel,
          }}
        />
      ) : null}

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
      <CommitMessageDialog
        open={pendingCommitAction !== null}
        fileCount={git.status?.filesChanged ?? 0}
        onCancel={() => setPendingCommitAction(null)}
        onConfirm={(commitMessage) => {
          const action = pendingCommitAction
          setPendingCommitAction(null)
          if (!action) return
          void stackedActions.run(action, {
            commitMessage,
            paths: git.status?.changedFiles.map((file) => file.path) ?? [],
          })
        }}
      />
    </>
  )
}
