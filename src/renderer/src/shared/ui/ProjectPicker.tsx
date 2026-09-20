import type { SessionProjectPage } from '@shared/types/session'
import { Check, ChevronDown, FolderGit2, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS } from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'
import { TextInput } from '@/shared/ui/TextInput'
import { useProjectCatalog } from './useProjectCatalog'

const MAX_PROJECT_SEARCH_LENGTH = 256

function catalogPageButtonLabel(catalog: ReturnType<typeof useProjectCatalog>) {
  if (catalog.loading) return 'Loading more projects…'
  if (catalog.error) return 'Retry loading projects'
  return catalog.nextCursor ? 'Load more projects' : 'All projects loaded'
}

function ProjectPickerCatalogStatus({
  catalog,
  search,
}: {
  readonly catalog: ReturnType<typeof useProjectCatalog>
  readonly search: string
}) {
  return (
    <>
      {catalog.loading ? (
        <p className="px-2.5 py-2 text-xs text-text-tertiary" role="status">
          Loading projects…
        </p>
      ) : null}
      {catalog.error && !catalog.hasPaged ? (
        <Button
          className={DENSE_MENU_ITEM_CLASS}
          onClick={() => catalog.retry(search)}
          variant="unstyled"
        >
          Could not load projects. Retry
        </Button>
      ) : null}
      {catalog.nextCursor || catalog.hasPaged ? (
        <Button
          aria-disabled={catalog.loading || (!catalog.nextCursor && !catalog.error)}
          className={DENSE_MENU_ITEM_CLASS}
          onClick={() => (catalog.error ? catalog.retry(search) : catalog.loadMore(search))}
          variant="unstyled"
        >
          {catalogPageButtonLabel(catalog)}
        </Button>
      ) : null}
    </>
  )
}

function ProjectPickerOptions({
  paths,
  selectedProject,
  label,
  onSelect,
  catalog,
  search,
}: {
  readonly paths: readonly string[]
  readonly selectedProject: string | null
  readonly label: (path: string) => string
  readonly onSelect: (path: string) => void
  readonly catalog: ReturnType<typeof useProjectCatalog>
  readonly search: string
}) {
  return (
    <div className="max-h-60 overflow-y-auto">
      {paths.length === 0 && !catalog.loading ? (
        <p className="px-2.5 py-2 text-xs text-text-tertiary">No projects found.</p>
      ) : null}
      {paths.map((path) => (
        <Button
          aria-current={path === selectedProject || undefined}
          aria-label={`${label(path)} (${path})`}
          className={DENSE_MENU_ITEM_CLASS}
          key={path}
          onClick={() => onSelect(path)}
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
      <ProjectPickerCatalogStatus catalog={catalog} search={search} />
    </div>
  )
}

function ProjectPickerTrigger({
  label,
  path,
  onClick,
}: {
  readonly label: string
  readonly path: string | null
  readonly onClick: () => void
}) {
  return (
    <Button
      aria-label={`Project: ${label}`}
      className="min-w-0 max-w-56 gap-1.5"
      onClick={onClick}
      size="sm"
      title={path ?? undefined}
      variant="secondary"
    >
      <FolderGit2 aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
    </Button>
  )
}

export function ProjectPicker({
  resourceName,
  projects,
  selectedProject,
  displayNames,
  onSelect,
  onOpenFolder,
  loadProjectsPage,
}: {
  readonly resourceName: string
  readonly projects: readonly string[]
  readonly selectedProject: string | null
  readonly displayNames: Readonly<Record<string, string>>
  readonly onSelect: (path: string) => void
  readonly onOpenFolder: () => void
  readonly loadProjectsPage?: (cursor?: string, search?: string) => Promise<SessionProjectPage>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const catalog = useProjectCatalog(loadProjectsPage)
  const label = (path: string) => displayNames[path]?.trim() || projectName(path)
  const selectedLabel = selectedProject ? label(selectedProject) : 'Choose project'
  const normalizedQuery = query.trim().normalize('NFC').toLowerCase()
  const allProjects = [
    ...new Set([...(selectedProject ? [selectedProject] : []), ...projects, ...catalog.paths]),
  ]
  const filteredProjects = normalizedQuery
    ? allProjects.filter((path) =>
        `${label(path)} ${path}`.normalize('NFC').toLowerCase().includes(normalizedQuery),
      )
    : allProjects

  function close() {
    catalog.cancel()
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
        if (nextOpen) catalog.reset()
        else close()
      }}
      open={open}
      placement="bottom-end"
      role="dialog"
      trigger={({ toggle }) => (
        <ProjectPickerTrigger label={selectedLabel} path={selectedProject} onClick={toggle} />
      )}
    >
      <div className="mb-1.5 px-1">
        <TextInput
          aria-label="Search projects"
          className="border-border-light bg-bg px-2 text-xs"
          inputSize="sm"
          maxLength={MAX_PROJECT_SEARCH_LENGTH}
          onChange={(event) => {
            setQuery(event.target.value)
            catalog.reset(event.target.value.trim())
          }}
          placeholder="Search projects"
          type="search"
          value={query}
        />
      </div>
      <ProjectPickerOptions
        paths={filteredProjects}
        selectedProject={selectedProject}
        label={label}
        onSelect={(path) => {
          close()
          onSelect(path)
        }}
        catalog={catalog}
        search={query.trim()}
      />
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
