import { Check, ChevronDown, FolderGit2, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import {
  CONTEXT_MENU_TRIGGER_CLASS,
  DENSE_MENU_ITEM_CLASS,
  DOCK_MENU_POPOVER_CLASS,
} from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'
import { TextInput } from '@/shared/ui/TextInput'

interface ComposerProjectMenuProps {
  readonly projectPath: string
  readonly recentProjects: readonly string[]
  readonly onOpenProject: () => Promise<void>
  readonly onSelectProjectPath: (path: string) => void
}

/** Project selection for a draft session, kept separate from environment and run target. */
export function ComposerProjectMenu({
  projectPath,
  recentProjects,
  onOpenProject,
  onSelectProjectPath,
}: ComposerProjectMenuProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const projects = [projectPath, ...recentProjects.filter((path) => path !== projectPath)]
  const normalizedQuery = query.trim().toLowerCase()
  const filteredProjects = normalizedQuery
    ? projects.filter((path) => projectName(path).toLowerCase().includes(normalizedQuery))
    : projects

  function close() {
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      ariaLabel="Choose a project"
      className={DOCK_MENU_POPOVER_CLASS}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery('')
      }}
      open={open}
      placement="top-start"
      role="dialog"
      trigger={({ toggle }) => (
        <Button
          aria-expanded={open}
          aria-label={`Project: ${projectName(projectPath)}`}
          className={CONTEXT_MENU_TRIGGER_CLASS}
          onClick={toggle}
          title={projectName(projectPath)}
          variant="unstyled"
        >
          <FolderGit2 aria-hidden="true" className="size-4 shrink-0 text-accent" />
          <span className="max-w-36 truncate font-medium">{projectName(projectPath)}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
        </Button>
      )}
    >
      <div className="mb-1.5 px-1">
        <TextInput
          aria-label="Search projects"
          className="border-border-light bg-bg px-2 text-xs"
          inputSize="sm"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects"
          type="search"
          value={query}
        />
      </div>

      <div className="max-h-55 overflow-y-auto">
        {filteredProjects.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-text-tertiary">No projects found.</div>
        ) : null}
        {filteredProjects.map((path) => {
          const current = path === projectPath
          return (
            <Button
              aria-current={current || undefined}
              aria-label={projectName(path)}
              className={DENSE_MENU_ITEM_CLASS}
              key={path}
              onClick={() => {
                close()
                if (!current) onSelectProjectPath(path)
              }}
              title={projectName(path)}
              variant="unstyled"
            >
              <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
              <span className="min-w-0 flex-1 truncate text-left">{projectName(path)}</span>
              {current ? (
                <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />
              ) : null}
            </Button>
          )
        })}
      </div>

      <div className="my-1 border-t border-border-light" />
      <Button
        aria-label="Select folder…"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => {
          close()
          void onOpenProject()
        }}
        variant="unstyled"
      >
        <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
        <span>Select folder…</span>
      </Button>
    </Popover>
  )
}
