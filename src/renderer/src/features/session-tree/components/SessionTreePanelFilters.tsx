import { Search } from 'lucide-react'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import { SESSION_TREE } from '../constants/session-tree'
import type { SessionTreePanelFilters as SessionTreePanelFiltersModel } from '../model/session-tree-panel'

interface SessionTreePanelFiltersProps {
  readonly filters: SessionTreePanelFiltersModel
}

export function SessionTreePanelFilters({ filters }: SessionTreePanelFiltersProps) {
  return (
    <div className="grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2">
      <div className="flex h-8 items-center gap-2">
        <label htmlFor="session-tree-filter" className="text-[12px] text-text-tertiary">
          Filter
        </label>
        <Select
          id="session-tree-filter"
          value={filters.filterMode}
          onChange={(event) => filters.onFilterModeChange(event.target.value)}
        >
          {SESSION_TREE.FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="relative mx-auto w-full min-w-0">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-text-muted" />
        <TextInput
          id="session-tree-search"
          type="search"
          value={filters.searchQuery}
          onChange={(event) => filters.onSearchQueryChange(event.target.value)}
          placeholder="Search nodes"
          inputSize="sm"
          className="rounded-lg border-input-card-border bg-bg-secondary pr-3 pl-9 text-text-secondary focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
          aria-label="Search Session Tree nodes"
        />
      </div>
    </div>
  )
}
