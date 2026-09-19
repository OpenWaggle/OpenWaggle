import { activeShortcutRuleForCommand } from '@shared/utils/shortcut-rules'
import {
  ChessQueen,
  GitCommitHorizontal,
  Hash,
  LayoutList,
  ListTree,
  PanelLeft,
  Pickaxe,
  SquareTerminal,
} from 'lucide-react'
import { usePreferencesStore } from '@/features/settings/state'
import { cn } from '@/shared/lib/cn'
import { projectName } from '@/shared/lib/format'
import {
  formatAriaShortcutBinding,
  formatShortcutBinding,
  usesAppleShortcuts,
} from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'

export { DiffToggleButton } from './HeaderDiffToggleButton'

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

interface SessionSummaryButtonProps {
  readonly open: boolean
  readonly panelId: string
  readonly suppressed: boolean
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

function terminalTitle(
  projectPath: string | null,
  terminalOpen: boolean,
  shortcut: ReturnType<
    typeof usePreferencesStore.getState
  >['settings']['shortcutBindings']['terminal.toggle'],
) {
  if (!projectPath) {
    return 'No project selected'
  }

  const action = terminalOpen ? 'Hide session terminal' : 'Open session terminal'
  return `${action} (${formatShortcutBinding(shortcut)})`
}

export function TerminalButton({ open, projectPath, onToggle }: TerminalButtonProps) {
  const shortcutRules = usePreferencesStore((state) => state.settings.shortcutRules)
  const shortcut =
    activeShortcutRuleForCommand(
      shortcutRules,
      'terminal.toggle',
      {
        terminalFocus: false,
        terminalOpen: open,
        previewFocus: false,
        previewOpen: document.querySelector('[data-browser-preview-panel]') !== null,
        modelPickerOpen: false,
      },
      usesAppleShortcuts(),
    )?.shortcut ?? null
  return (
    <Button
      variant="secondary"
      size="none"
      radius="sm"
      aria-label={open ? 'Hide terminal' : 'Open terminal'}
      aria-keyshortcuts={formatAriaShortcutBinding(shortcut)}
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        'no-drag h-7 border-button-border px-2.5 @max-[720px]/header:px-2',
        !projectPath && 'pointer-events-none opacity-30',
      )}
      disabled={!projectPath}
      title={terminalTitle(projectPath, open, shortcut)}
    >
      <SquareTerminal className="size-3.5 text-text-secondary" />
      <span className="text-sm font-medium text-text-primary @max-[720px]/header:hidden">
        {open ? 'Hide' : 'Open'}
      </span>
      <span className="text-xs text-text-tertiary @max-[720px]/header:hidden">&#x2228;</span>
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
      className={cn(
        'no-drag h-7 px-2.5 @max-[720px]/header:px-2',
        disabled && 'pointer-events-none opacity-40',
      )}
      disabled={disabled}
      title={projectPath ? 'Open commit dialog' : 'No project selected'}
    >
      <GitCommitHorizontal
        aria-hidden="true"
        className="hidden size-3.5 @max-[720px]/header:block"
      />
      <span className="text-sm font-semibold text-bg @max-[720px]/header:hidden">Commit</span>
      <span className="text-xs text-bg/50 @max-[720px]/header:hidden">&#x2228;</span>
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

export function SessionSummaryButton({
  open,
  panelId,
  suppressed,
  onToggle,
}: SessionSummaryButtonProps) {
  const label = open ? 'Hide Session Summary' : 'Open Session Summary'
  const title = suppressed ? 'Session Summary is hidden while the side panel is open' : label
  return (
    <Button
      variant={open ? 'subtle' : 'secondary'}
      size="none"
      radius="sm"
      id={`${panelId}-toggle`}
      aria-pressed={open}
      aria-controls={panelId}
      aria-label={label}
      onClick={onToggle}
      disabled={suppressed}
      className="no-drag h-7 border-button-border px-2 disabled:opacity-40"
      title={title}
    >
      <LayoutList className="size-3.5 text-text-secondary" />
    </Button>
  )
}
