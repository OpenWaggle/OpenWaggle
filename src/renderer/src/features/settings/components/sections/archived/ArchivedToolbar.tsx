import type { ArchivedItemsFacets, ArchivedItemsSort } from '@shared/types/archived-items'
import { Loader2, Search, X } from 'lucide-react'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { SegmentedRadioGroup } from '@/shared/ui/SegmentedRadioGroup'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import type { ArchivedItemsList } from '../../../hooks/useArchivedItemsList'
import {
  type ArchivedItemsView,
  effectiveArchivedSort,
  hasArchivedFacetFilter,
  isSearching,
} from '../../../lib/archived-items-view'

const ALL_PROJECTS = '__all__'
const NO_PROJECT = '__none__'

const WITHIN_OPTIONS = [
  ['any', 'Any time'],
  ['day', 'Last 24 hours'],
  ['week', 'Last 7 days'],
  ['month', 'Last 30 days'],
  ['older', 'Older than 30 days'],
] as const satisfies readonly (readonly [ArchivedItemsView['archivedWithin'], string])[]

const SORT_OPTIONS = [
  ['match', 'Best match'],
  ['recent', 'Recently archived'],
  ['oldest', 'Oldest first'],
] as const satisfies readonly (readonly [ArchivedItemsSort, string])[]

function count(value: number | undefined) {
  return (value ?? 0).toLocaleString()
}

function projectValue(projectPath: string | null | undefined) {
  if (projectPath === undefined) return ALL_PROJECTS
  return projectPath ?? NO_PROJECT
}

function projectFromValue(value: string): string | null | undefined {
  if (value === ALL_PROJECTS) return undefined
  return value === NO_PROJECT ? null : value
}

/** The project options: every project with matches, plus the selected one even when it has none. */
function projectOptions(facets: ArchivedItemsFacets | null, selected: string | null | undefined) {
  const projects = facets?.projects ?? []
  const listed =
    selected === undefined || projects.some((project) => project.projectPath === selected)
      ? projects
      : [...projects, { projectPath: selected, count: 0 }]
  return listed.map((project) => ({
    value: projectValue(project.projectPath),
    label: `${projectName(project.projectPath)} (${count(project.count)})`,
  }))
}

function totalProjects(facets: ArchivedItemsFacets | null) {
  return (facets?.projects ?? []).reduce((sum, project) => sum + project.count, 0)
}

/** Search, sort, and the Project, Archived date, and Type facets with their live counts. */
export function ArchivedToolbar({ list }: { readonly list: ArchivedItemsList }) {
  const { view, facets, updateView } = list
  const kindCounts = facets?.kinds

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-tertiary"
          />
          <TextInput
            type="search"
            inputSize="sm"
            aria-label="Search archived items"
            placeholder="Search titles, projects, branches and transcripts…"
            autoComplete="off"
            spellCheck={false}
            value={view.text}
            onChange={(event) => updateView({ text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && view.text) {
                event.stopPropagation()
                updateView({ text: '' })
              }
            }}
            className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {view.text ? (
            <Button
              variant="ghost"
              size="icon-sm"
              radius="sm"
              type="button"
              aria-label="Clear search"
              onClick={() => updateView({ text: '' })}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <Select
          aria-label="Sort"
          value={effectiveArchivedSort(view)}
          onChange={(event) => {
            const sort = SORT_OPTIONS.find(([value]) => value === event.target.value)?.[0]
            // Best match is the default while searching, so choosing it returns to automatic.
            if (sort) updateView({ sort: sort === 'match' ? 'auto' : sort })
          }}
        >
          {SORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value} disabled={value === 'match' && !isSearching(view)}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Project"
          value={projectValue(view.projectPath)}
          onChange={(event) => updateView({ projectPath: projectFromValue(event.target.value) })}
          className="max-w-64"
        >
          <option value={ALL_PROJECTS}>All projects ({count(totalProjects(facets))})</option>
          {projectOptions(facets, view.projectPath).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Archived date"
          value={view.archivedWithin}
          onChange={(event) => {
            const within = WITHIN_OPTIONS.find(([value]) => value === event.target.value)?.[0]
            if (within) updateView({ archivedWithin: within })
          }}
        >
          {WITHIN_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label} ({count(facets?.archivedWithin[value])})
            </option>
          ))}
        </Select>
        <SegmentedRadioGroup
          label="Type"
          value={view.kind}
          onSelect={(kind) => updateView({ kind })}
          options={[
            { value: 'all', label: `All ${count(kindCounts?.all)}` },
            { value: 'session', label: `Sessions ${count(kindCounts?.session)}` },
            { value: 'branch', label: `Branches ${count(kindCounts?.branch)}` },
          ]}
        />
        {hasArchivedFacetFilter(view) ? (
          <Button type="button" variant="link" size="xs" onClick={list.resetFacets}>
            Clear filters
          </Button>
        ) : null}
        <output
          aria-live="polite"
          className="ml-auto flex items-center gap-1.5 text-xs text-text-muted tabular-nums"
        >
          {list.isFetching ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : null}
          {list.total.toLocaleString()} {list.total === 1 ? 'result' : 'results'}
        </output>
      </div>
    </div>
  )
}
