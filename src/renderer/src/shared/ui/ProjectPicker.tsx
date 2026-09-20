import { Check, ChevronDown, FolderGit2, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS } from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'
import { TextInput } from '@/shared/ui/TextInput'

export function ProjectPicker({
  resourceName,
  projects,
  selectedProject,
  displayNames,
  onSelect,
  onOpenFolder,
}: {
  readonly resourceName: string
  readonly projects: readonly string[]
  readonly selectedProject: string | null
  readonly displayNames: Readonly<Record<string, string>>
  readonly onSelect: (path: string) => void
  readonly onOpenFolder: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const label = (path: string) => displayNames[path]?.trim() || projectName(path)
  const selectedLabel = selectedProject ? label(selectedProject) : 'Choose project'
  const normalizedQuery = query.trim().toLowerCase()
  const filteredProjects = normalizedQuery
    ? projects.filter((path) => `${label(path)} ${path}`.toLowerCase().includes(normalizedQuery))
    : projects

  function close() {
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      ariaLabel={`Choose a project for ${resourceName}`}
      className="w-72 p-2"
      escapeClipping
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery('')
      }}
      open={open}
      placement="bottom-end"
      role="dialog"
      trigger={({ toggle }) => (
        <Button
          aria-label={`Project: ${selectedLabel}`}
          className="min-w-0 max-w-56 gap-1.5"
          onClick={toggle}
          size="sm"
          title={selectedProject ?? undefined}
          variant="secondary"
        >
          <FolderGit2 aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
          <span className="min-w-0 truncate">{selectedLabel}</span>
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
      <div className="max-h-60 overflow-y-auto">
        {filteredProjects.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-text-tertiary">No projects found.</p>
        ) : null}
        {filteredProjects.map((path) => (
          <Button
            aria-current={path === selectedProject || undefined}
            aria-label={label(path)}
            className={DENSE_MENU_ITEM_CLASS}
            key={path}
            onClick={() => {
              close()
              onSelect(path)
            }}
            title={path}
            variant="unstyled"
          >
            <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate">{label(path)}</span>
              <span className="block truncate text-xs text-text-muted">{path}</span>
            </span>
            {path === selectedProject ? (
              <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />
            ) : null}
          </Button>
        ))}
      </div>
      <div className="my-1 border-t border-border-light" />
      <Button
        aria-label="Open project folder…"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => {
          close()
          onOpenFolder()
        }}
        variant="unstyled"
      >
        <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
        <span>Open project folder…</span>
      </Button>
    </Popover>
  )
}
