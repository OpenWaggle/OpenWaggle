import type { GitStatusSummary } from '@shared/types/git'
import { Bug, Hash, ListTree, PanelLeft, SquareTerminal } from 'lucide-react'
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

interface HeaderLeftProps {
  readonly activeBranchName: string
  readonly projectPath: string | null
  readonly sidebarOpen: boolean
  readonly title: string
  readonly onToggleSidebar: () => void
}

interface TerminalButtonProps {
  readonly open: boolean
  readonly projectPath: string | null
  readonly onToggle: () => void
}

interface CommitButtonProps {
  readonly isCommitting: boolean
  readonly projectPath: string | null
  readonly onOpen: () => void
}

interface SessionTreeButtonProps {
  readonly hasSessionTree: boolean
  readonly isChatRoute: boolean
  readonly open: boolean
  readonly onToggle: () => void
}

interface DiffToggleButtonProps {
  readonly error: string | null
  readonly isChatRoute: boolean
  readonly isLoading: boolean
  readonly open: boolean
  readonly projectPath: string | null
  readonly status: GitStatusSummary | null
  readonly onToggle: () => void
}

function HeaderLeft({
  activeBranchName,
  projectPath,
  sidebarOpen,
  title,
  onToggleSidebar,
}: HeaderLeftProps) {
  return (
    <div className="flex items-center gap-2">
      {!sidebarOpen && (
        <button
          type="button"
          aria-label="Show sidebar"
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
          className="no-drag rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          title="Show sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}

      <Hash className="no-drag h-3.5 w-3.5 text-text-tertiary" />
      <span className="no-drag text-[14px] font-medium text-text-primary">{title}</span>
      <span className="no-drag text-[12px] text-text-tertiary">/ {activeBranchName}</span>
      <span className="no-drag flex items-center h-5 px-2 rounded border border-border bg-bg-tertiary text-[12px] text-text-secondary">
        {projectName(projectPath)}
      </span>
      <span className="no-drag text-[16px] leading-none text-text-tertiary">···</span>
    </div>
  )
}

function terminalTitle(projectPath: string | null, terminalOpen: boolean): string {
  if (!projectPath) {
    return 'No project selected'
  }

  return terminalOpen ? 'Hide terminal' : 'Open terminal'
}

function TerminalButton({ open, projectPath, onToggle }: TerminalButtonProps) {
  return (
    <button
      type="button"
      aria-label={open ? 'Hide terminal' : 'Open terminal'}
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        'no-drag flex items-center gap-1 h-7 px-2.5 rounded-[5px] border border-button-border',
        'transition-colors hover:bg-bg-hover',
        !projectPath && 'pointer-events-none opacity-30',
      )}
      disabled={!projectPath}
      title={terminalTitle(projectPath, open)}
    >
      <SquareTerminal className="h-3.5 w-3.5 text-text-secondary" />
      <span className="text-[13px] font-medium text-text-primary">{open ? 'Hide' : 'Open'}</span>
      <span className="text-[9px] text-text-tertiary">&#x2228;</span>
    </button>
  )
}

function CommitButton({ isCommitting, projectPath, onOpen }: CommitButtonProps) {
  const disabled = !projectPath || isCommitting

  return (
    <button
      type="button"
      aria-label="Open commit dialog"
      onClick={onOpen}
      className={cn(
        'no-drag flex items-center gap-1 h-7 px-2.5 rounded-[5px]',
        'bg-gradient-to-b from-accent to-accent-dim',
        'transition-opacity',
        disabled && 'pointer-events-none opacity-40',
      )}
      disabled={disabled}
      title={projectPath ? 'Open commit dialog' : 'No project selected'}
    >
      <span className="text-[13px] font-semibold text-bg">Commit</span>
      <span className="text-[9px] text-bg/50">&#x2228;</span>
    </button>
  )
}

function FeedbackButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Report a bug"
      onClick={onOpen}
      className="no-drag flex items-center gap-1 h-7 px-2 rounded-[5px] border border-button-border transition-colors hover:bg-bg-hover"
      title="Report a bug"
    >
      <Bug className="h-3.5 w-3.5 text-text-secondary" />
    </button>
  )
}

function SessionTreeButton({
  hasSessionTree,
  isChatRoute,
  open,
  onToggle,
}: SessionTreeButtonProps) {
  const disabled = !hasSessionTree || !isChatRoute

  return (
    <button
      type="button"
      aria-label="Toggle Session Tree"
      aria-expanded={open}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'no-drag flex h-7 items-center gap-1 rounded-[5px] border border-button-border px-2 transition-colors hover:bg-bg-hover',
        disabled && 'pointer-events-none opacity-30',
        open && 'bg-bg-active text-text-primary',
      )}
      title={hasSessionTree ? 'Toggle Session Tree' : 'No session tree available'}
    >
      <ListTree className="h-3.5 w-3.5 text-text-secondary" />
    </button>
  )
}

function diffStatusText(error: string | null, isLoading: boolean): string {
  if (isLoading) {
    return 'Loading diff…'
  }

  return error ? 'Git unavailable' : 'Diff unavailable'
}

function DiffToggleButton({
  error,
  isChatRoute,
  isLoading,
  open,
  projectPath,
  status,
  onToggle,
}: DiffToggleButtonProps) {
  const disabled = !projectPath || !isChatRoute

  return (
    <button
      type="button"
      aria-label="Toggle diff panel"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'no-drag flex items-center gap-1 transition-opacity hover:opacity-80',
        disabled && 'pointer-events-none opacity-30',
        open && 'opacity-100',
      )}
      title="Toggle diff panel"
    >
      {status ? (
        <>
          <span className="text-[13px] font-medium text-success">+{status.additions}</span>
          <span className="text-[13px] font-medium text-error">-{status.deletions}</span>
        </>
      ) : (
        <span className="text-[13px] font-medium text-text-tertiary">
          {diffStatusText(error, isLoading)}
        </span>
      )}
    </button>
  )
}

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
