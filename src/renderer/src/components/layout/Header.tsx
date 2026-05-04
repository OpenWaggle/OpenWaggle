import { Bug, GitBranch, Hash, PanelLeft, SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { CommitDialog } from '@/components/layout/CommitDialog'
import { useChat } from '@/hooks/useChat'
import { useDiffRouteNavigation } from '@/hooks/useDiffRouteNavigation'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { useSessions } from '@/hooks/useSessions'
import { cn } from '@/lib/cn'
import { projectName } from '@/lib/format'
import { useUIStore } from '@/stores/ui-store'

export function Header() {
  const { activeConversation } = useChat()
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

  function handleRefreshGit(): void {
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
    const result = await commitGit(projectPath, { message, amend, paths })
    if (result.ok) {
      bumpDiffRefreshKey()
      showToast(`Commit created: ${result.summary}`)
    }
    return result
  }

  const activeBranchName =
    activeSessionTree?.branches.find(
      (branch) => branch.id === activeSessionTree.session.lastActiveBranchId,
    )?.name ??
    activeSessionTree?.branches[0]?.name ??
    'main'

  return (
    <>
      <header className="drag-region flex shrink-0 items-center justify-between h-12 px-5 gap-3 bg-bg border-b border-border">
        {/* hdrLeft — gap 8 */}
        <div className="flex items-center gap-2">
          {!sidebarOpen && (
            <button
              type="button"
              aria-label="Show sidebar"
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
              className="no-drag rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
              title="Show sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}

          <Hash className="no-drag h-3.5 w-3.5 text-text-tertiary" />

          <span className="no-drag text-[14px] font-medium text-text-primary">
            {activeSessionTree?.session.title ?? activeConversation?.title ?? 'New session'}
          </span>

          <span className="no-drag text-[12px] text-text-tertiary">/ {activeBranchName}</span>

          {/* Project pill */}
          <span className="no-drag flex items-center h-5 px-2 rounded border border-border bg-bg-tertiary text-[12px] text-text-secondary">
            {projectName(projectPath)}
          </span>

          {/* Dots */}
          <span className="no-drag text-[16px] leading-none text-text-tertiary">···</span>
        </div>

        {/* hdrRight — gap 8 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={terminalOpen ? 'Hide terminal' : 'Open terminal'}
            aria-expanded={terminalOpen}
            onClick={toggleTerminal}
            className={cn(
              'no-drag flex items-center gap-1 h-7 px-2.5 rounded-[5px] border border-button-border',
              'transition-colors hover:bg-bg-hover',
              !projectPath && 'pointer-events-none opacity-30',
            )}
            disabled={!projectPath}
            title={
              projectPath
                ? terminalOpen
                  ? 'Hide terminal'
                  : 'Open terminal'
                : 'No project selected'
            }
          >
            <SquareTerminal className="h-3.5 w-3.5 text-text-secondary" />
            <span className="text-[13px] font-medium text-text-primary">
              {terminalOpen ? 'Hide' : 'Open'}
            </span>
            <span className="text-[9px] text-text-tertiary">&#x2228;</span>
          </button>

          <button
            type="button"
            aria-label="Open commit dialog"
            onClick={() => setCommitOpen(true)}
            className={cn(
              'no-drag flex items-center gap-1 h-7 px-2.5 rounded-[5px]',
              'bg-gradient-to-b from-accent to-accent-dim',
              'transition-opacity',
              (!projectPath || gitCommitting) && 'pointer-events-none opacity-40',
            )}
            disabled={!projectPath || gitCommitting}
            title={projectPath ? 'Open commit dialog' : 'No project selected'}
          >
            <span className="text-[13px] font-semibold text-bg">Commit</span>
            <span className="text-[9px] text-bg/50">&#x2228;</span>
          </button>

          <button
            type="button"
            aria-label="Report a bug"
            onClick={() => openFeedbackModal()}
            className="no-drag flex items-center gap-1 h-7 px-2 rounded-[5px] border border-button-border transition-colors hover:bg-bg-hover"
            title="Report a bug"
          >
            <Bug className="h-3.5 w-3.5 text-text-secondary" />
          </button>

          {/* Divider */}
          <div className="w-px h-5 bg-border" />

          <button
            type="button"
            aria-label="Toggle Session Tree"
            aria-expanded={sessionTreeOpen}
            onClick={toggleSessionTree}
            disabled={!activeSessionTree || !isChatRoute}
            className={cn(
              'no-drag flex h-7 items-center gap-1 rounded-[5px] border border-button-border px-2 transition-colors hover:bg-bg-hover',
              (!activeSessionTree || !isChatRoute) && 'pointer-events-none opacity-30',
              sessionTreeOpen && 'bg-bg-active text-text-primary',
            )}
            title={activeSessionTree ? 'Toggle Session Tree' : 'No session tree available'}
          >
            <GitBranch className="h-3.5 w-3.5 text-text-secondary" />
          </button>

          {/* Diff stats — clickable to toggle diff panel */}
          <button
            type="button"
            aria-label="Toggle diff panel"
            onClick={toggleDiff}
            disabled={!projectPath || !isChatRoute}
            className={cn(
              'no-drag flex items-center gap-1 transition-opacity hover:opacity-80',
              (!projectPath || !isChatRoute) && 'pointer-events-none opacity-30',
              diffOpen && 'opacity-100',
            )}
            title="Toggle diff panel"
          >
            {gitStatus ? (
              <>
                <span className="text-[13px] font-medium text-success">+{gitStatus.additions}</span>
                <span className="text-[13px] font-medium text-error">-{gitStatus.deletions}</span>
              </>
            ) : (
              <span className="text-[13px] font-medium text-text-tertiary">
                {gitLoading ? 'Loading diff…' : gitError ? 'Git unavailable' : 'Diff unavailable'}
              </span>
            )}
          </button>
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
