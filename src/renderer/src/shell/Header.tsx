import { match } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useState } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useDiffRouteNavigation } from '@/features/diff-panel/hooks'
import { CommitDialog } from '@/features/git/components'
import { useGit } from '@/features/git/hooks'
import { useProject, useSessions } from '@/features/sessions/hooks'
import { cn } from '@/shared/lib/cn'
import { useUIStore } from '@/shell/ui-store'
import {
  CommitButton,
  DiffToggleButton,
  HeaderLeft,
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

export function Header() {
  const { activeSession, activeSessionId } = useChat()
  const { activeSessionTree, archivedSessions, sessions } = useSessions()
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

  function handleRefreshGit() {
    // Status follows the session's working tree; the branch list is repository-level.
    void refreshGitStatus(workingPath)
    void refreshGitBranches(repositoryPath)
    bumpDiffRefreshKey()
  }

  async function handleCommitGit(message: string, amend: boolean, paths: string[]) {
    // Commit into the tree the user is looking at. Committing the primary checkout
    // while a worktree session is active would write to a tree they never reviewed.
    if (!workingPath) {
      return {
        ok: false as const,
        code: 'not-git-repo' as const,
        message: 'No project selected.',
      }
    }
    return match
      .promise(commitGit(workingPath, { message, amend, paths }))
      .with({ ok: true }, (result) => {
        bumpDiffRefreshKey()
        showToast(`Commit created: ${result.summary}`)
        return result
      })
      .with({ ok: false }, (result) => result)
      .exhaustive()
  }

  const activeBranchName = gitStatus?.branch ?? null
  const title = activeSessionTree?.session.title ?? activeSession?.title ?? 'New session'
  const currentSessionIdentity = sessionIdentity(
    [...sessions, ...archivedSessions],
    activeSessionId,
  )

  return (
    <>
      <header
        className={cn(
          'drag-region flex shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-bg px-5',
          currentSessionIdentity ? 'h-14' : 'h-12',
        )}
      >
        <HeaderLeft
          activeBranchName={activeBranchName}
          projectPath={projectPath}
          sidebarOpen={sidebarOpen}
          title={title}
          sessionIdentity={currentSessionIdentity}
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
