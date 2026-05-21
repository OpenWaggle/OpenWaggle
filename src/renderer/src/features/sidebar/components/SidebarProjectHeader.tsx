import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  Edit3,
  Folder,
  MoreHorizontal,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { TextInput } from '@/shared/ui/TextInput'
import type { SidebarProjectGroup } from '../lib/sidebar-project-groups'
import type { SidebarProjectActions } from '../model'

interface ProjectHeaderProps {
  readonly group: SidebarProjectGroup
  readonly projectLabel: string
  readonly isCurrentProject: boolean
  readonly collapsed: boolean
  readonly actions: SidebarProjectActions
}

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

function ProjectActionsMenu({
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
          className="flex size-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <MoreHorizontal className="size-3.5" />
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

function ProjectRenameInput({
  value,
  inputRef,
  onChange,
  onSave,
  onCancel,
}: {
  readonly value: string
  readonly inputRef: React.RefObject<HTMLInputElement | null>
  readonly onChange: (value: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}) {
  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onSave}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onSave()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      variant="transparent"
      inputSize="sm"
      className="min-w-0 flex-1 px-0 font-medium"
    />
  )
}

function ProjectTitleArea({
  actions,
  state,
}: {
  readonly actions: {
    readonly cancelRename: () => void
    readonly saveRename: () => void
    readonly setRenameValue: (value: string) => void
    readonly toggle: () => void
  }
  readonly state: {
    readonly collapsed: boolean
    readonly DisclosureIcon: typeof ChevronDown
    readonly projectLabel: string
    readonly renaming: boolean
    readonly renameInputRef: React.RefObject<HTMLInputElement | null>
    readonly renameValue: string
  }
}) {
  if (state.renaming) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <state.DisclosureIcon className="size-3 shrink-0 text-text-muted" />
        <Folder className="size-3.5 shrink-0" />
        <ProjectRenameInput
          value={state.renameValue}
          inputRef={state.renameInputRef}
          onChange={actions.setRenameValue}
          onSave={actions.saveRename}
          onCancel={actions.cancelRename}
        />
      </div>
    )
  }

  return (
    <Button
      variant="unstyled"
      type="button"
      aria-label={`${state.collapsed ? 'Expand' : 'Collapse'} ${state.projectLabel}`}
      aria-expanded={!state.collapsed}
      onClick={actions.toggle}
      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
    >
      <state.DisclosureIcon className="size-3 shrink-0 text-text-muted" />
      <Folder className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{state.projectLabel}</span>
    </Button>
  )
}

export function SidebarProjectHeader({
  group,
  projectLabel,
  isCurrentProject,
  collapsed,
  actions,
}: ProjectHeaderProps) {
  const DisclosureIcon = collapsed ? ChevronRight : ChevronDown
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(projectLabel)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renaming) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renaming])

  function saveRename() {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== projectLabel) actions.rename(group.projectPath, trimmed)
    setRenaming(false)
  }

  return (
    <div
      className={cn(
        'group flex h-7 w-full items-center gap-1.5 px-4 transition-colors hover:bg-bg-hover',
        isCurrentProject ? 'text-text-secondary' : 'text-text-tertiary',
      )}
      title={group.projectPath}
    >
      <ProjectTitleArea
        state={{
          collapsed,
          DisclosureIcon,
          projectLabel,
          renaming,
          renameInputRef,
          renameValue,
        }}
        actions={{
          cancelRename() {
            setRenaming(false)
            setRenameValue(projectLabel)
          },
          saveRename,
          setRenameValue,
          toggle() {
            actions.toggleCollapsed(group.projectPath)
          },
        }}
      />
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="unstyled"
          type="button"
          aria-label={`New session in ${projectLabel}`}
          onClick={() => actions.newSession(group.projectPath)}
          className="flex size-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <Edit3 className="size-3.5" />
        </Button>
        <ProjectActionsMenu
          group={group}
          projectLabel={projectLabel}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          actions={{
            ...actions,
            rename(_path, name) {
              setMenuOpen(false)
              setRenameValue(name)
              setRenaming(true)
            },
          }}
        />
      </div>
    </div>
  )
}
