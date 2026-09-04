import { match } from '@diegogbrisa/ts-match'
import { useState } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useDiffRouteNavigation } from '@/features/diff-panel/hooks'
import { CommitDialog } from '@/features/git/components'
import { useGit } from '@/features/git/hooks'
import {
  isSessionSummaryPanelVisible,
  useRecordSessionCommit,
  useSessionSummaryUIStore,
} from '@/features/session-summary'
import { useProject, useSessions } from '@/features/sessions/hooks'
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

export function Header() {
  const { activeSession } = useChat()
  const { activeSessionTree } = useSessions()
  const { projectPath } = useProject()

  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const terminalOpen = useUIStore((s) => s.terminalOpen)

  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleTerminal = useUIStore((s) => s.toggleTerminal)
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
  const { diffOpen, isChatRoute, sessionTreeOpen, toggleDiff, toggleSessionTree } =
    useDiffRouteNavigation()
  const activeSessionId = activeSession ? activeSession.id : null
  const recordSessionCommit = useRecordSessionCommit(activeSessionId)
  const sessionSummaryPanel = useSessionSummaryUIStore((state) =>
    activeSessionId ? state.panels[activeSessionId] : undefined,
  )
  const toggleSessionSummary = useSessionSummaryUIStore((state) => state.togglePanel)

  function handleRefreshGit() {
    void refreshGitStatus(workingPath)
    void refreshGitBranches(repositoryPath)
    bumpDiffRefreshKey()
  }

  async function handleCommitGit(message: string, amend: boolean, paths: string[]) {
    // Commit into the tree being reviewed, never the primary checkout behind a worktree Session.
    if (!workingPath) {
      return {
        ok: false as const,
        code: 'not-git-repo' as const,
        message: 'No project selected.',
      }
    }
    return match
      .promise(commitGit(workingPath, { message, amend, paths }))
      .with({ ok: true }, async (result) => {
        await recordSessionCommit({ commitHash: result.commitHash, title: message.trim() })
        bumpDiffRefreshKey()
        showToast(`Commit created: ${result.summary}`)
        return result
      })
      .with({ ok: false }, (result) => result)
      .exhaustive()
  }

  const activeBranchName = gitStatus?.branch ?? null
  const title = activeSessionTree?.session.title ?? activeSession?.title ?? 'New session'

  return (
    <>
      <header className="drag-region flex h-12 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-bg px-5">
        <HeaderLeft
          activeBranchName={activeBranchName}
          projectPath={projectPath}
          sidebarOpen={sidebarOpen}
          title={title}
          onToggleSidebar={toggleSidebar}
        />

        <div data-qa="header-actions" className="flex shrink-0 items-center gap-2">
          <TerminalButton open={terminalOpen} projectPath={projectPath} onToggle={toggleTerminal} />
          <CommitButton
            isCommitting={gitCommitting}
            projectPath={projectPath}
            onOpen={() => setCommitOpen(true)}
          />
          <FeedbackButton onOpen={openFeedbackModal} />
          {activeSessionId && isChatRoute && sessionSummaryPanel?.available ? (
            <SessionSummaryButton
              open={
                sessionSummaryPanel.rightSidebarOpen
                  ? sessionSummaryPanel.expanded
                  : isSessionSummaryPanelVisible(sessionSummaryPanel)
              }
              panelId={`session-summary-${activeSessionId}`}
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
