import type { WorktreeInventoryProject } from '@shared/types/worktree-inventory'
import { Search } from 'lucide-react'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'

/** The project picker's value for every project. */
export const ALL_PROJECTS = ''

/** Narrow the list to one project, or to paths, branches and Sessions that match. */
export function WorktreeFilters(props: {
  readonly projects: readonly WorktreeInventoryProject[]
  readonly project: string
  readonly onProjectChange: (project: string) => void
  readonly search: string
  readonly onSearchChange: (search: string) => void
  readonly shown: number
  readonly total: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.projects.length > 1 ? (
        <Select
          aria-label="Project"
          selectSize="sm"
          value={props.project}
          onChange={(event) => props.onProjectChange(event.target.value)}
        >
          <option value={ALL_PROJECTS}>All projects</option>
          {props.projects.map((project) => (
            <option key={project.projectPath} value={project.projectPath}>
              {project.opened ? `${project.name} (open)` : project.name}
            </option>
          ))}
        </Select>
      ) : null}
      <div className="relative min-w-56 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-tertiary"
        />
        <TextInput
          type="search"
          inputSize="sm"
          aria-label="Search worktrees"
          placeholder="Search paths, branches and Sessions…"
          autoComplete="off"
          spellCheck={false}
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && props.search) {
              event.stopPropagation()
              props.onSearchChange('')
            }
          }}
          className="pl-8"
        />
      </div>
      <span className="text-xs text-text-tertiary" aria-live="polite">
        {props.shown === props.total
          ? `${String(props.total)} ${props.total === 1 ? 'worktree' : 'worktrees'}`
          : `${String(props.shown)} of ${String(props.total)} worktrees`}
      </span>
    </div>
  )
}
