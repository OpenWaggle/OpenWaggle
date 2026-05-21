import type { GitStatusSummary } from '@shared/types/git'
import { Hash, ListTree, PanelLeft, SquareTerminal } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'

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

export function HeaderLeft({
  activeBranchName,
  projectPath,
  sidebarOpen,
  title,
  onToggleSidebar,
}: HeaderLeftProps) {
  return (
    <div className="flex items-center gap-2">
      {!sidebarOpen && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Show sidebar"
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
          className="no-drag"
          title="Show sidebar"
        >
          <PanelLeft className="size-4" />
        </Button>
      )}

      <Hash className="no-drag size-3.5 text-text-tertiary" />
      <span className="no-drag text-[14px] font-medium text-text-primary">{title}</span>
      <span className="no-drag text-[12px] text-text-tertiary">/ {activeBranchName}</span>
      <span className="no-drag flex items-center h-5 px-2 rounded border border-border bg-bg-tertiary text-[12px] text-text-secondary">
        {projectName(projectPath)}
      </span>
      <span className="no-drag text-[16px] leading-none text-text-tertiary">···</span>
    </div>
  )
}

function terminalTitle(projectPath: string | null, terminalOpen: boolean) {
  if (!projectPath) {
    return 'No project selected'
  }

  return terminalOpen ? 'Hide terminal' : 'Open terminal'
}

export function TerminalButton({ open, projectPath, onToggle }: TerminalButtonProps) {
  return (
    <Button
      variant="secondary"
      size="none"
      radius="sm"
      aria-label={open ? 'Hide terminal' : 'Open terminal'}
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        'no-drag h-7 border-button-border px-2.5',
        !projectPath && 'pointer-events-none opacity-30',
      )}
      disabled={!projectPath}
      title={terminalTitle(projectPath, open)}
    >
      <SquareTerminal className="size-3.5 text-text-secondary" />
      <span className="text-[13px] font-medium text-text-primary">{open ? 'Hide' : 'Open'}</span>
      <span className="text-[9px] text-text-tertiary">&#x2228;</span>
    </Button>
  )
}

export function CommitButton({ isCommitting, projectPath, onOpen }: CommitButtonProps) {
  const disabled = !projectPath || isCommitting

  return (
    <Button
      variant="primary"
      size="none"
      radius="sm"
      aria-label="Open commit dialog"
      onClick={onOpen}
      className={cn('no-drag h-7 px-2.5', disabled && 'pointer-events-none opacity-40')}
      disabled={disabled}
      title={projectPath ? 'Open commit dialog' : 'No project selected'}
    >
      <span className="text-[13px] font-semibold text-bg">Commit</span>
      <span className="text-[9px] text-bg/50">&#x2228;</span>
    </Button>
  )
}

export function SessionTreeButton({
  hasSessionTree,
  isChatRoute,
  open,
  onToggle,
}: SessionTreeButtonProps) {
  const disabled = !hasSessionTree || !isChatRoute

  return (
    <Button
      variant={open ? 'subtle' : 'secondary'}
      size="none"
      radius="sm"
      aria-label="Toggle Session Tree"
      aria-expanded={open}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'no-drag h-7 border-button-border px-2',
        disabled && 'pointer-events-none opacity-30',
      )}
      title={hasSessionTree ? 'Toggle Session Tree' : 'No session tree available'}
    >
      <ListTree className="size-3.5 text-text-secondary" />
    </Button>
  )
}

function diffStatusText(error: string | null, isLoading: boolean) {
  if (isLoading) {
    return 'Loading diff…'
  }

  return error ? 'Git unavailable' : 'Diff unavailable'
}

export function DiffToggleButton({
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
    <Button
      variant="ghost"
      size="none"
      aria-label="Toggle diff panel"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'no-drag gap-1 hover:opacity-80',
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
    </Button>
  )
}
