import { match } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { GitCommitSuccess } from '@shared/types/git'
import type { SessionSummary } from '@shared/types/session'
import { useLayoutEffect, useState } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useDiffRouteNavigation } from '@/features/diff-panel/hooks'
import { CommitDialog } from '@/features/git/components'
import { useGit } from '@/features/git/hooks'
import { ProjectActionsControl } from '@/features/project-actions'
import {
  isSessionSummaryPanelVisible,
  type SessionSummaryPanelState,
  useSessionSummaryUIStore,
} from '@/features/session-summary'
import { useProject, useSessions } from '@/features/sessions/hooks'
import { useTerminalCommands } from '@/features/terminal'
import { cn } from '@/shared/lib/cn'
import { useUIStore } from '@/shell/ui-store'
import {
  CommitButton,
  DiffToggleButton,
  HeaderLeft,
  SessionSummaryButton,
  SessionTreeButton,
  TerminalButton,
} from './HeaderControls'
import { FeedbackButton } from './HeaderFeedbackButton'

function sessionIdentity(sessions: readonly SessionSummary[], activeSessionId: SessionId | null) {
  const lineage = sessions.find((session) => session.id === activeSessionId)?.lineage
  if (!lineage) return undefined
  if (lineage.role === 'independent') {
    return lineage.agentDefinitionName
      ? { agentDefinitionName: lineage.agentDefinitionName }
      : undefined
  }
  return {
    role: lineage.role,
    ...(lineage.agentDefinitionName ? { agentDefinitionName: lineage.agentDefinitionName } : {}),
  }
}

function directCommitToast(result: GitCommitSuccess): {
  readonly message: string
  readonly variant: 'error' | undefined
} {
  const outputFailure = result.commitOutput?.ok === false ? result.commitOutput : null
  return {
    message: outputFailure?.message ?? `Commit created: ${result.summary}`,
    variant: outputFailure ? 'error' : undefined,
  }
}

function useSessionSummaryToggleFocus(
  activeSessionId: string | null,
  panel: SessionSummaryPanelState | undefined,
) {
  const targetSessionId = useSessionSummaryUIStore((state) => state.toggleFocusTargetSessionId)
  const clearToggleFocus = useSessionSummaryUIStore((state) => state.clearToggleFocus)
  const panelAvailable = panel?.available
  useLayoutEffect(() => {
    if (!activeSessionId || targetSessionId !== activeSessionId || panelAvailable === undefined)
      return
    if (panelAvailable) {
      document.getElementById(`session-summary-${activeSessionId}-toggle`)?.focus()
    }
    clearToggleFocus(activeSessionId)
  }, [activeSessionId, clearToggleFocus, panelAvailable, targetSessionId])
}

function useHeaderGit(activeSessionId: SessionId | null) {
  const bumpDiffRefreshKey = useUIStore((s) => s.bumpDiffRefreshKey)
  const showToast = useUIStore((s) => s.showToast)
  const git = useGit()
  const [commitOpen, setCommitOpen] = useState(false)

  function handleRefreshGit() {
    // Status follows the session's working tree; the branch list is repository-level.
    void git.refreshStatus(git.workingPath)
    void git.refreshBranches(git.repositoryPath)
    bumpDiffRefreshKey()
  }

  async function handleCommitGit(message: string, amend: boolean, paths: string[]) {
    // Commit into the session tree the user reviewed, never its hidden primary checkout.
    if (!git.workingPath) {
      return {
        ok: false as const,
        code: 'not-git-repo' as const,
        message: 'No project selected.',
      }
    }
    return match
      .promise(
        git.commit(git.workingPath, {
          sessionId: activeSessionId ?? undefined,
          message,
          amend,
          paths,
        }),
      )
      .with({ ok: true }, (result) => {
        bumpDiffRefreshKey()
        const toast = directCommitToast(result)
        showToast(toast.message, toast.variant)
        return result
      })
      .with({ ok: false }, (result) => result)
      .exhaustive()
  }

  return { git, commitOpen, setCommitOpen, handleRefreshGit, handleCommitGit }
}

/**
 * The selected Session's title, never another Session's.
 *
 * The Session tree and detail both refresh asynchronously after a switch, and reading the stale
 * tree first showed the previous Session's title over the new transcript. The sidebar catalog
 * already holds the selected Session's title at the moment of the switch (ADR 0036).
 */
function headerTitle(input: {
  readonly activeSessionId: SessionId | null
  readonly activeSession: { readonly id: SessionId; readonly title: string } | null
  readonly activeSessionTree: { readonly session: SessionSummary } | null
  readonly sessions: readonly SessionSummary[]
}) {
  const { activeSessionId } = input
  if (!activeSessionId) return 'New session'
  if (input.activeSessionTree?.session.id === activeSessionId) {
    return input.activeSessionTree.session.title
  }
  if (input.activeSession?.id === activeSessionId) return input.activeSession.title
  return input.sessions.find((session) => session.id === activeSessionId)?.title ?? 'New session'
}

export function Header() {
  const { activeSession, activeSessionId } = useChat()
  const { activeSessionTree, archivedSessions, sessions } = useSessions()
  const { projectPath } = useProject()

  const sidebarOpen = useUIStore((s) => s.sidebarOpen)

  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const openFeedbackModal = useUIStore((s) => s.openFeedbackModal)

  const { git, commitOpen, setCommitOpen, handleRefreshGit, handleCommitGit } =
    useHeaderGit(activeSessionId)
  const { panelOpen: terminalOpen, toggleTerminal } = useTerminalCommands()
  const { diffOpen, isChatRoute, sessionTreeOpen, toggleDiff, toggleSessionTree } =
    useDiffRouteNavigation()
  const activeSessionKey = activeSession ? String(activeSession.id) : null
  const sessionSummaryPanel = useSessionSummaryUIStore((state) =>
    activeSessionKey ? state.panels[activeSessionKey] : undefined,
  )
  const toggleSessionSummary = useSessionSummaryUIStore((state) => state.togglePanel)
  useSessionSummaryToggleFocus(activeSessionKey, sessionSummaryPanel)

  const title = headerTitle({ activeSessionId, activeSession, activeSessionTree, sessions })
  const currentSessionIdentity = sessionIdentity(
    [...(activeSessionTree ? [activeSessionTree.session] : []), ...sessions, ...archivedSessions],
    activeSessionId,
  )

  return (
    <>
      <header
        className={cn(
          '@container/header drag-region flex shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-bg px-5',
          currentSessionIdentity ? 'h-14' : 'h-12',
        )}
      >
        <HeaderLeft
          activeBranchName={git.status?.branch ?? null}
          projectPath={projectPath}
          sidebarOpen={sidebarOpen}
          title={title}
          sessionIdentity={currentSessionIdentity}
          onToggleSidebar={toggleSidebar}
        />

        <div
          data-qa="header-actions"
          className="flex shrink-0 items-center gap-2 @max-[720px]/header:gap-1"
        >
          <ProjectActionsControl projectPath={projectPath} />
          <TerminalButton open={terminalOpen} projectPath={projectPath} onToggle={toggleTerminal} />
          <CommitButton
            isCommitting={git.isCommitting}
            projectPath={projectPath}
            onOpen={() => setCommitOpen(true)}
          />
          <FeedbackButton onOpen={openFeedbackModal} />
          {activeSessionKey && isChatRoute && sessionSummaryPanel?.available ? (
            <SessionSummaryButton
              open={isSessionSummaryPanelVisible(sessionSummaryPanel)}
              panelId={`session-summary-${activeSessionKey}`}
              suppressed={sessionSummaryPanel.rightSidebarOpen}
              onToggle={() => toggleSessionSummary(activeSessionKey)}
            />
          ) : null}
          <div className="w-px h-5 bg-border" />
          <SessionTreeButton
            hasSessionTree={Boolean(activeSessionTree)}
            isChatRoute={isChatRoute}
            open={sessionTreeOpen}
            onToggle={toggleSessionTree}
          />
          <DiffToggleButton
            error={git.error}
            isChatRoute={isChatRoute}
            isLoading={git.isLoading}
            open={diffOpen}
            projectPath={projectPath}
            status={git.status}
            onToggle={toggleDiff}
          />
        </div>
      </header>

      {commitOpen && (
        <CommitDialog
          projectPath={projectPath}
          status={git.status}
          statusError={git.error}
          isRefreshing={git.isLoading}
          isCommitting={git.isCommitting}
          onRefresh={handleRefreshGit}
          onCommit={handleCommitGit}
          onClose={() => setCommitOpen(false)}
        />
      )}
    </>
  )
}
