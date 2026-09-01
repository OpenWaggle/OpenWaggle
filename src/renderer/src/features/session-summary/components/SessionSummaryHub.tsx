import { match } from '@diegogbrisa/ts-match'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { GitStackedAction } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CommitMessageDialog,
  resolveQuickAction,
  useCombinedVcsStatus,
  useStackedGitActions,
} from '@/features/git'
import { useGit } from '@/features/git/hooks'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { useSessionResources } from '../hooks/useSessionResources'
import {
  isSessionSummaryPanelVisible,
  type SessionSummaryPanelState,
  useSessionSummaryUIStore,
} from '../state/session-summary-ui-store'
import { ChangeRequestComposer } from './ChangeRequestComposer'
import type { SessionSummaryExtensionSidePanelTarget } from './ExtensionSessionSummarySections'
import type { SessionResourceFilter } from './SessionResourcesPanel'
import { SessionSummaryExpandedPanel } from './SessionSummaryExpandedPanel'

function readExpanded(sessionId: string, key: string, fallback: boolean) {
  try {
    const stored = localStorage.getItem(`openwaggle:session-summary:${sessionId}:${key}`)
    return stored === null ? fallback : stored === 'true'
  } catch {
    return fallback
  }
}

function usePersistedExpanded(sessionId: string, key: string, fallback: boolean) {
  const [expanded, setExpanded] = useState(() => readExpanded(sessionId, key, fallback))
  const update = (next: boolean) => {
    setExpanded(next)
    try {
      localStorage.setItem(`openwaggle:session-summary:${sessionId}:${key}`, String(next))
    } catch {
      // Persistence is optional. Keep the current renderer state usable.
    }
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

export interface SessionSummaryHubInput {
  readonly session: SessionDetail | null
  readonly messageCount: number
  readonly autoHidden: boolean
  readonly rightSidebarOpen: boolean
  readonly onOpenDiff: () => void
  readonly onOpenResources: (filter?: SessionResourceFilter) => void
  readonly onNavigateSession: (sessionId: string) => void
  readonly onOpenExtensionSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
}

function useSyncSessionSummaryPanel(input: SessionSummaryHubInput, sessionId: string) {
  const syncPanel = useSessionSummaryUIStore((state) => state.syncPanel)
  const { session, messageCount, autoHidden, rightSidebarOpen } = input
  useEffect(() => {
    if (!session) return
    syncPanel(sessionId, {
      available: messageCount > 0,
      autoHidden,
      rightSidebarOpen,
    })
  }, [autoHidden, messageCount, rightSidebarOpen, session, sessionId, syncPanel])
}

function panelIsVisible(
  input: SessionSummaryHubInput,
  panel: SessionSummaryPanelState | undefined,
  sessionId: string,
) {
  if (!panel) {
    return (
      input.messageCount > 0 &&
      readExpanded(sessionId, 'panel', true) &&
      !input.autoHidden &&
      !input.rightSidebarOpen
    )
  }
  return isSessionSummaryPanelVisible(panel, {
    available: input.messageCount > 0,
    autoHidden: input.autoHidden,
    rightSidebarOpen: input.rightSidebarOpen,
  })
}

function useRestoreFocusWhenPanelHides(panelId: string, panelVisible: boolean) {
  const panelHadFocus = useRef(false)

  useLayoutEffect(() => {
    if (!panelVisible) return
    const panel = document.getElementById(panelId)
    if (!panel) return

    panelHadFocus.current = panel.contains(document.activeElement)
    const rememberPanelFocus = () => {
      panelHadFocus.current = true
    }
    panel.addEventListener('focusin', rememberPanelFocus)

    return () => {
      panel.removeEventListener('focusin', rememberPanelFocus)
      const activeElement = document.activeElement
      const focusNeedsRestoring =
        panelHadFocus.current &&
        (!activeElement || activeElement === document.body || panel.contains(activeElement))
      panelHadFocus.current = false
      if (!focusNeedsRestoring) return
      queueMicrotask(() => {
        const sidebar = document.querySelector<HTMLElement>('[data-right-sidebar-shell="true"]')
        if (sidebar && !sidebar.closest('[inert]')) return
        document.getElementById(`${panelId}-toggle`)?.focus()
      })
    }
  }, [panelId, panelVisible])
}

function focusSummaryToggle(panelId: string, preventScroll = false) {
  document.getElementById(`${panelId}-toggle`)?.focus({ preventScroll })
}

function closeAndRestore(
  closePanel: (sessionId: string) => void,
  sessionId: string,
  panelId: string,
) {
  closePanel(sessionId)
  queueMicrotask(() => focusSummaryToggle(panelId))
}

export function SessionSummaryHub({ input }: { readonly input: SessionSummaryHubInput }) {
  const { session, messageCount } = input
  const sessionId = session ? String(session.id) : 'none'
  const panelId = `session-summary-${sessionId}`
  const panelState = useSessionSummaryUIStore((state) => state.panels[sessionId])
  const closePanel = useSessionSummaryUIStore((state) => state.closePanel)
  const openResourceViewer = useUIStore((state) => state.openResourceViewer)
  useSyncSessionSummaryPanel(input, sessionId)
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
    sessionId: session?.id,
    onCompleted: () => {
      void combined.refresh()
      if (git.workingPath) void git.refreshStatus(git.workingPath)
    },
  })
  const quickAction = resolveQuickAction(combined.status, stackedActions.isRunning)
  const resources = useSessionResources(session ? sessionId : null)
  const panelVisible = panelIsVisible(input, panelState, sessionId)
  useRestoreFocusWhenPanelHides(panelId, panelVisible)

  if (!session || messageCount === 0) return null

  const closePanelAndRestoreFocus = () => closeAndRestore(closePanel, sessionId, panelId)
  const prepareForSidebarOpen = () => focusSummaryToggle(panelId, true)

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
      {panelVisible ? (
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
            extensionRegistry: input.extensionRegistry,
            extensionProjectPaths: input.extensionProjectPaths,
            onCollapse: closePanelAndRestoreFocus,
            onEnvironmentExpandedChange: setEnvironmentExpanded,
            onOutputsExpandedChange: setOutputsExpanded,
            onSourcesExpandedChange: setSourcesExpanded,
            onOpenDiff: () => {
              prepareForSidebarOpen()
              input.onOpenDiff()
            },
            onOpenResources: (filter) => {
              prepareForSidebarOpen()
              input.onOpenResources(filter)
            },
            onOpenImage: (resourceId) => openResourceViewer(sessionId, resourceId),
            onNavigateSession: input.onNavigateSession,
            onCreateChangeRequest: () => setComposerOpen(true),
            onQuickAction: runQuickAction,
            onOpenExtensionSidePanel: input.onOpenExtensionSidePanel
              ? (target) => {
                  prepareForSidebarOpen()
                  input.onOpenExtensionSidePanel?.(target)
                }
              : undefined,
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
