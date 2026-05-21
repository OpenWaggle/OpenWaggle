import { match } from '@diegogbrisa/ts-match'
import { useState } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useDiffRouteNavigation } from '@/features/diff-panel/hooks'
import { CommitDialog } from '@/features/git/components'
import { useGit } from '@/features/git/hooks'
import { useProject, useSessions } from '@/features/sessions/hooks'
import { useUIStore } from '@/shell/ui-store'
import {
  CommitButton,
  DiffToggleButton,
  HeaderLeft,
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
  } = useGit()

  const [commitOpen, setCommitOpen] = useState(false)
  const { diffOpen, isChatRoute, sessionTreeOpen, toggleDiff, toggleSessionTree } =
    useDiffRouteNavigation()

  function handleRefreshGit() {
    void refreshGitStatus(projectPath)
    void refreshGitBranches(projectPath)
    bumpDiffRefreshKey()
  }

  async function handleCommitGit(message: string, amend: boolean, paths: string[]) {
    if (!projectPath) {
      return {
        ok: false as const,
        code: 'not-git-repo' as const,
        message: 'No project selected.',
      }
    }
    return match
      .promise(commitGit(projectPath, { message, amend, paths }))
      .with({ ok: true }, (result) => {
        bumpDiffRefreshKey()
        showToast(`Commit created: ${result.summary}`)
        return result
      })
      .with({ ok: false }, (result) => result)
      .exhaustive()
  }

  const activeBranchName =
    activeSessionTree?.branches.find(
      (branch) => branch.id === activeSessionTree.session.lastActiveBranchId,
    )?.name ??
    activeSessionTree?.branches[0]?.name ??
    'main'
  const title = activeSessionTree?.session.title ?? activeSession?.title ?? 'New session'

  return (
    <>
      <header className="drag-region flex shrink-0 items-center justify-between h-12 px-5 gap-3 bg-bg border-b border-border">
        <HeaderLeft
          activeBranchName={activeBranchName}
          projectPath={projectPath}
          sidebarOpen={sidebarOpen}
          title={title}
          onToggleSidebar={toggleSidebar}
        />

        <div className="flex items-center gap-2">
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
