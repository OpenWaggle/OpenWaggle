import { Hash, PanelLeft, SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { CommitDialog } from '@/components/layout/CommitDialog'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { projectName } from '@/lib/format'

interface HeaderProps {
  conversationTitle: string | null
  onToggleSidebar: () => void
  onToggleTerminal: () => void
  onToggleDiffPanel: () => void
  sidebarOpen: boolean
  terminalOpen: boolean
  onDiffRefresh: () => void
  onToast: (message: string) => void
}

export function Header({
  conversationTitle,
  onToggleSidebar,
  onToggleTerminal,
  onToggleDiffPanel,
  sidebarOpen,
  terminalOpen,
  onDiffRefresh,
  onToast,
}: HeaderProps): React.JSX.Element {
  const { projectPath } = useProject()
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

  function handleRefreshGit(): void {
    void refreshGitStatus(projectPath)
    void refreshGitBranches(projectPath)
    onDiffRefresh()
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
      onDiffRefresh()
      onToast(`Commit created: ${result.summary}`)
    }
    return result
  }

  return (
    <>
      <header className="drag-region flex shrink-0 items-center justify-between h-12 px-5 gap-3 bg-bg border-b border-border">
        {/* hdrLeft — gap 8 */}
        <div className="flex items-center gap-2">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="no-drag rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
              title="Show sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}

          {/* Thread icon */}
          <Hash className="no-drag h-3.5 w-3.5 text-text-tertiary" />

          {/* Title */}
          <span className="no-drag text-[14px] font-medium text-text-primary">
            {conversationTitle ?? 'New thread'}
          </span>

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
            onClick={onToggleTerminal}
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

          {/* Divider */}
          <div className="w-px h-5 bg-border" />

          {/* Diff stats — clickable to toggle diff panel */}
          <button
            type="button"
            onClick={onToggleDiffPanel}
            disabled={!projectPath}
            className={cn(
              'no-drag flex items-center gap-1 transition-opacity hover:opacity-80',
              !projectPath && 'pointer-events-none opacity-30',
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
