import { ChevronDown, ChevronRight, Folder, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import type { SidebarProjectGroup } from '../lib/sidebar-project-groups'
import type { SidebarStateCount } from '../lib/sidebar-row-state'
import type { SidebarProjectActions } from '../model'
import { ProjectActionsMenu } from './SidebarProjectActionsMenu'
import { SidebarProjectStatusPips } from './SidebarStatusIndicators'

interface ProjectHeaderProps {
  readonly group: SidebarProjectGroup
  readonly projectLabel: string
  readonly isCurrentProject: boolean
  readonly collapsed: boolean
  /** States worth surfacing on the heading, so a collapsed project still reports them. */
  readonly rollUp: readonly SidebarStateCount[]
  readonly actions: SidebarProjectActions
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
    readonly isCurrentProject: boolean
    readonly projectLabel: string
    readonly renaming: boolean
    readonly renameInputRef: React.RefObject<HTMLInputElement | null>
    readonly renameValue: string
  }
}) {
  if (state.renaming) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="grid w-3.5 flex-none place-items-center text-text-muted">
          <state.DisclosureIcon className="size-3" />
        </span>
        <Folder className="size-3.5 shrink-0 text-text-tertiary" />
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
      <span className="grid w-3.5 flex-none place-items-center text-text-muted">
        <state.DisclosureIcon className="size-3" />
      </span>
      <Folder className="size-3.5 shrink-0 text-text-tertiary" />
      <span
        data-qa="sidebar-project-name"
        className={cn(
          'min-w-0 flex-1 truncate font-semibold text-sm',
          state.isCurrentProject ? 'text-text-primary' : 'text-text-secondary',
        )}
      >
        {state.projectLabel}
      </span>
    </Button>
  )
}

export function SidebarProjectHeader({
  group,
  projectLabel,
  isCurrentProject,
  collapsed,
  rollUp,
  actions,
}: ProjectHeaderProps) {
  const DisclosureIcon = collapsed ? ChevronRight : ChevronDown
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
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
    setRenameValue('')
  }

  return (
    <div
      data-qa="sidebar-project-row"
      className={cn(
        'group flex h-7.5 w-full items-center gap-1.5 pr-2.5 pl-2 transition-colors hover:bg-bg-hover',
        isCurrentProject ? 'text-text-secondary' : 'text-text-tertiary',
      )}
      title={projectLabel}
    >
      <ProjectTitleArea
        state={{
          collapsed,
          DisclosureIcon,
          isCurrentProject,
          projectLabel,
          renaming,
          renameInputRef,
          renameValue,
        }}
        actions={{
          cancelRename() {
            setRenaming(false)
            setRenameValue('')
          },
          saveRename,
          setRenameValue,
          toggle() {
            actions.toggleCollapsed(group.projectPath)
          },
        }}
      />
      {/*
       * The roll-up never hides. It is the only thing on a collapsed heading that says a session in
       * there needs a person, so covering it with the hover actions loses the one fact the heading
       * exists to carry. It was hidden on hover and on focus-within, and since a click leaves the
       * heading focused, one click hid it until focus moved somewhere else entirely.
       *
       * The plain session count does still yield to the actions: a count is not attention, and
       * giving up its width keeps the actions from crowding a long project name.
       */}
      <span className="flex flex-none items-center gap-1">
        {rollUp.length === 0 ? (
          <span
            data-qa="sidebar-project-count"
            className="flex-none text-xs text-text-muted group-focus-within:hidden group-hover:hidden"
          >
            {group.sessions.length}
          </span>
        ) : (
          <SidebarProjectStatusPips counts={rollUp} />
        )}
      </span>
      <div className="flex shrink-0 items-center gap-px opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          variant="unstyled"
          type="button"
          aria-label={`New session in ${projectLabel}`}
          onClick={() => actions.newSession(group.projectPath)}
          className="grid size-5 flex-none place-items-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <Plus className="size-3" />
        </Button>
        <ProjectActionsMenu
          group={group}
          projectLabel={projectLabel}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          actions={{
            ...actions,
            rename(_path: string, name: string) {
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
