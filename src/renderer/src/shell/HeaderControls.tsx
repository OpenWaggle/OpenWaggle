import type { GitStatusSummary } from '@shared/types/git'
import { ChessQueen, Hash, ListTree, PanelLeft, Pickaxe, SquareTerminal } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'

interface HeaderLeftProps {
  readonly activeBranchName: string | null
  readonly projectPath: string | null
  readonly sidebarOpen: boolean
  readonly title: string
  readonly sessionIdentity?: {
    readonly role?: 'queen' | 'worker'
    readonly agentDefinitionName?: string
  }
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
  sessionIdentity,
  onToggleSidebar,
}: HeaderLeftProps) {
  const SessionIdentityIcon =
    sessionIdentity?.role === 'queen'
      ? ChessQueen
      : sessionIdentity?.role === 'worker'
        ? Pickaxe
        : undefined
  const currentProjectName = projectName(projectPath)

  return (
    <div
      data-qa="header-identity"
      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap"
    >
      {!sidebarOpen && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Show sidebar"
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
          className="no-drag shrink-0"
          title="Show sidebar"
        >
          <PanelLeft className="size-4" />
        </Button>
      )}

      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-2" data-qa="header-session-main">
          <Hash className="no-drag size-3.5 shrink-0 text-text-tertiary" />
          <span
            data-qa="header-session-title"
            className="no-drag min-w-0 truncate text-sm font-medium text-text-primary"
            title={title}
          >
            {title}
          </span>
          {activeBranchName ? (
            <span
              className="no-drag min-w-0 max-w-40 shrink truncate text-xs text-text-tertiary"
              title={activeBranchName}
            >
              / {activeBranchName}
            </span>
          ) : null}
          <span
            className="no-drag flex h-5 max-w-36 shrink-0 items-center truncate rounded border border-border bg-bg-tertiary px-2 text-xs text-text-secondary"
            title={currentProjectName}
          >
            <span className="truncate">{currentProjectName}</span>
          </span>
        </div>
        {sessionIdentity ? (
          <div
            className="no-drag mt-0.5 ml-5 flex min-h-4 items-center gap-1.5 text-xs text-text-tertiary"
            data-qa="header-session-identity"
            title={
              sessionIdentity.role === 'queen'
                ? 'Queen Session: coordinates this Hive'
                : sessionIdentity.role === 'worker'
                  ? 'Worker Session: reports through its Hive lineage'
                  : `Agent definition: ${sessionIdentity.agentDefinitionName ?? 'default'}`
            }
          >
            {SessionIdentityIcon ? (
              <>
                <SessionIdentityIcon className="size-3 shrink-0 text-accent" />
                <span className="font-medium text-text-secondary">
                  {sessionIdentity.role === 'queen' ? 'Queen' : 'Worker'}
                </span>
              </>
            ) : null}
            {sessionIdentity.agentDefinitionName ? (
              <>
                {SessionIdentityIcon ? <span className="text-border-strong">·</span> : null}
                <span className="truncate">{sessionIdentity.agentDefinitionName}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
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
      <span className="text-sm font-medium text-text-primary">{open ? 'Hide' : 'Open'}</span>
      <span className="text-xs text-text-tertiary">&#x2228;</span>
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
      <span className="text-sm font-semibold text-bg">Commit</span>
      <span className="text-xs text-bg/50">&#x2228;</span>
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
  const gitStatusState = isLoading ? 'loading' : error ? 'error' : status ? 'ready' : 'unavailable'

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
      data-git-status-state={gitStatusState}
    >
      {status ? (
        <>
          <span className="text-sm font-medium text-success">+{status.additions}</span>
          <span className="text-sm font-medium text-error">-{status.deletions}</span>
        </>
      ) : (
        <span className="text-sm font-medium text-text-tertiary">
          {diffStatusText(error, isLoading)}
        </span>
      )}
    </Button>
  )
}
