import { AlertTriangle, Archive, Edit3, Folder, MoreHorizontal } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import type { SidebarProjectGroup } from '../lib/sidebar-project-groups'
import type { SidebarProjectActions } from '../model'

/**
 * A project heading's overflow menu, split out of the header so that file stays within its
 * size budget after the status roll-up moved in.
 */
function ProjectMenuButton({
  danger = false,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly icon: typeof Folder
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent',
        danger ? 'text-error' : 'text-text-secondary',
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span>{label}</span>
    </Button>
  )
}

export function ProjectActionsMenu({
  group,
  projectLabel,
  menuOpen,
  setMenuOpen,
  actions,
}: {
  readonly group: SidebarProjectGroup
  readonly projectLabel: string
  readonly menuOpen: boolean
  readonly setMenuOpen: (open: boolean) => void
  readonly actions: SidebarProjectActions
}) {
  const sessionCount = group.sessions.length
  const archiveLabel =
    sessionCount === 0
      ? 'No sessions to archive'
      : `Archive ${sessionCount} session${sessionCount === 1 ? '' : 's'}...`

  function closeAfter(action: () => void) {
    setMenuOpen(false)
    action()
  }

  return (
    <Popover
      open={menuOpen}
      onOpenChange={setMenuOpen}
      placement="bottom-end"
      className="min-w-[190px] py-1"
      trigger={({ isOpen, toggle }) => (
        <Button
          variant="unstyled"
          type="button"
          aria-label={`Open project actions for ${projectLabel}`}
          aria-expanded={isOpen}
          onClick={(event) => {
            event.stopPropagation()
            toggle()
          }}
          className="grid size-5 flex-none place-items-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <MoreHorizontal className="size-[13px]" />
        </Button>
      )}
    >
      <ProjectMenuButton
        icon={Folder}
        label="Open in Finder"
        onClick={() => closeAfter(() => actions.openInFinder(group.projectPath))}
      />
      <ProjectMenuButton
        icon={Edit3}
        label="Rename project"
        onClick={() => closeAfter(() => actions.rename(group.projectPath, projectLabel))}
      />
      <ProjectMenuButton
        disabled={sessionCount === 0}
        icon={Archive}
        label={archiveLabel}
        onClick={() => closeAfter(() => actions.archiveSessions(group.projectPath, group.sessions))}
      />
      <ProjectMenuButton
        danger
        icon={AlertTriangle}
        label="Remove..."
        onClick={() => closeAfter(() => actions.remove(group.projectPath))}
      />
    </Popover>
  )
}
