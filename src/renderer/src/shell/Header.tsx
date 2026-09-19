import { match } from '@diegogbrisa/ts-match'
import type { GitCommitSuccess } from '@shared/types/git'
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

export function Header() {
  const { activeSession } = useChat()
  const { activeSessionTree } = useSessions()
  const { projectPath } = useProject()

  const sidebarOpen = useUIStore((s) => s.sidebarOpen)

  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const bumpDiffRefreshKey = useUIStore((s) => s.bumpDiffRefreshKey)
  const showToast = useUIStore((s) => s.showToast)
  const openFeedbackModal = useUIStore((s) => s.openFeedbackModal)

  const {
    status: gitStatus,
    error: gitError,
    isLoading: gitLoading,
    isCommitting: gitCommitting,
    refreshStatus: refreshGitStatus,
    refreshBranches: refreshGitBranches,
    commit: commitGit,
    workingPath,
    repositoryPath,
  } = useGit()

  const [commitOpen, setCommitOpen] = useState(false)
  const { panelOpen: terminalOpen, toggleTerminal } = useTerminalCommands()
  const { diffOpen, isChatRoute, sessionTreeOpen, toggleDiff, toggleSessionTree } =
    useDiffRouteNavigation()
  const activeSessionId = activeSession ? String(activeSession.id) : null
  const sessionSummaryPanel = useSessionSummaryUIStore((state) =>
    activeSessionId ? state.panels[activeSessionId] : undefined,
  )
  const toggleSessionSummary = useSessionSummaryUIStore((state) => state.togglePanel)
  useSessionSummaryToggleFocus(activeSessionId, sessionSummaryPanel)

  function handleRefreshGit() {
    // Status follows the session's working tree; the branch list is repository-level.
    void refreshGitStatus(workingPath)
    void refreshGitBranches(repositoryPath)
    bumpDiffRefreshKey()
  }

  async function handleCommitGit(message: string, amend: boolean, paths: string[]) {
    // Commit into the session tree the user reviewed, never its hidden primary checkout.
    if (!workingPath) {
      return {
        ok: false as const,
        code: 'not-git-repo' as const,
        message: 'No project selected.',
      }
    }
    return match
      .promise(commitGit(workingPath, { sessionId: activeSession?.id, message, amend, paths }))
      .with({ ok: true }, (result) => {
        bumpDiffRefreshKey()
        const toast = directCommitToast(result)
        showToast(toast.message, toast.variant)
        return result
      })
      .with({ ok: false }, (result) => result)
      .exhaustive()
  }

  const title = activeSessionTree?.session.title ?? activeSession?.title ?? 'New session'

  return (
    <>
      <header className="@container/header drag-region flex h-12 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-bg px-5">
        <HeaderLeft
          activeBranchName={gitStatus?.branch ?? null}
          projectPath={projectPath}
          sidebarOpen={sidebarOpen}
          title={title}
          onToggleSidebar={toggleSidebar}
        />

        <div
          data-qa="header-actions"
          className="flex shrink-0 items-center gap-2 @max-[720px]/header:gap-1"
        >
          <ProjectActionsControl projectPath={projectPath} />
          <TerminalButton open={terminalOpen} projectPath={projectPath} onToggle={toggleTerminal} />
          <CommitButton
            isCommitting={gitCommitting}
            projectPath={projectPath}
            onOpen={() => setCommitOpen(true)}
          />
          <FeedbackButton onOpen={openFeedbackModal} />
          {activeSessionId && isChatRoute && sessionSummaryPanel?.available ? (
            <SessionSummaryButton
              open={isSessionSummaryPanelVisible(sessionSummaryPanel)}
              panelId={`session-summary-${activeSessionId}`}
              suppressed={sessionSummaryPanel.rightSidebarOpen}
              onToggle={() => toggleSessionSummary(activeSessionId)}
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
            error={gitError}
            isChatRoute={isChatRoute}
            isLoading={gitLoading}
            open={diffOpen}
            projectPath={projectPath}
            status={gitStatus}
            onToggle={toggleDiff}
          />
        </div>
      </header>

      {commitOpen && (
        <CommitDialog
          projectPath={projectPath}
          status={gitStatus}
          statusError={gitError}
          isRefreshing={gitLoading}
          isCommitting={gitCommitting}
          onRefresh={handleRefreshGit}
          onCommit={handleCommitGit}
          onClose={() => setCommitOpen(false)}
        />
      )}
    </>
  )
}
