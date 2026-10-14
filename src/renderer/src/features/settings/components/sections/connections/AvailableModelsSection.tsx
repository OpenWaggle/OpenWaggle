import type { ModelDisplayInfo } from '@shared/types/llm'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useConnectionModelGroups } from '@/features/providers/hooks'
import type { ModelGroup } from '@/features/providers/model'
import { usePreferences, useProviders } from '@/features/settings/hooks/useSettings'
import {
  ALL_PROVIDERS,
  availableModelsView,
  type ModelFilterId,
  type ProviderScope,
} from '@/features/settings/lib/available-models-filter'
import { ModelFilterChips } from './ModelFilterChips'
import { ModelListPanel } from './ModelListPanel'
import { ModelProviderSidebar } from './ModelProviderSidebar'
import { ModelMatchActions, ModelSearchField } from './ModelSearchControls'

function useEnabledModelSelection() {
  const { settings, setEnabledModels } = usePreferences()
  const enabledModels = settings.enabledModels

  return {
    enabledSet: new Set<string>(enabledModels),
    toggle(modelRef: string, enabled: boolean) {
      const next = enabled
        ? [...new Set([...enabledModels, modelRef])]
        : enabledModels.filter((model) => model !== modelRef)
      void setEnabledModels(next)
    },
    select(models: readonly ModelDisplayInfo[]) {
      const refs = models.map((model) => String(model.id))
      void setEnabledModels([...new Set([...enabledModels, ...refs])])
    },
    deselect(models: readonly ModelDisplayInfo[]) {
      const refs = new Set(models.map((model) => String(model.id)))
      void setEnabledModels(enabledModels.filter((model) => !refs.has(model)))
    },
  }
}

function matchAnnouncement(count: number) {
  return count === 1 ? '1 matching model' : `${String(count)} matching models`
}

function AvailableModelsBrowser({ groups }: { readonly groups: readonly ModelGroup[] }) {
  const selection = useEnabledModelSelection()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<ReadonlySet<ModelFilterId>>(new Set())
  const [chosenScope, setChosenScope] = useState<ProviderScope | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const view = availableModelsView(groups, { search, filters }, selection.enabledSet, chosenScope)

  function toggleFilter(filter: ModelFilterId) {
    setFilters((previous) => {
      const next = new Set(previous)
      if (next.has(filter)) next.delete(filter)
      else next.add(filter)
      return next
    })
  }

  return (
    <>
      <div className="space-y-2">
        <ModelSearchField inputRef={searchRef} value={search} onChange={setSearch} />
        <ModelFilterChips active={filters} counts={view.counts} onToggle={toggleFilter} />
      </div>

      {/* Always mounted: a live region inserted with its first text is not announced. */}
      <p role="status" aria-live="polite" className="sr-only">
        {view.queryActive ? matchAnnouncement(view.visibleModels.length) : ''}
      </p>

      {view.queryActive && (
        <ModelMatchActions
          matching={view.visibleModels}
          selectedCount={
            view.visibleModels.filter((model) => selection.enabledSet.has(model.id)).length
          }
          onSelect={selection.select}
          onDeselect={selection.deselect}
          onReset={() => {
            setSearch('')
            setFilters(new Set())
            // The reset button unmounts with the filters, so focus the search field instead.
            searchRef.current?.focus()
          }}
        />
      )}

      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-bg sm:h-128 sm:flex-row">
        <ModelProviderSidebar
          groups={groups}
          scope={view.scope}
          matches={view.matches}
          queryActive={view.queryActive}
          enabledSet={selection.enabledSet}
          onSelectScope={setChosenScope}
          navRef={sidebarRef}
        />
        <ModelListPanel
          key={view.scopedGroup ? `provider:${view.scopedGroup.provider}` : 'all'}
          group={view.scopedGroup}
          state={{
            scopeModels: view.scopeModels,
            visibleModels: view.visibleModels,
            search,
            queryActive: view.queryActive,
            enabledSet: selection.enabledSet,
            providerLabels: new Map(groups.map((group) => [group.provider, group.label])),
            matchesElsewhere: view.matchesElsewhere,
          }}
          actions={{
            onToggleModel: selection.toggle,
            onSelectModels: selection.select,
            onDeselectModels: selection.deselect,
            onShowAllProviders: () => {
              // The link unmounts with the empty list, so focus the provider it switched to.
              flushSync(() => setChosenScope(ALL_PROVIDERS))
              sidebarRef.current
                ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
                ?.focus()
            },
          }}
        />
      </div>
    </>
  )
}

export function AvailableModelsSection() {
  const { settings } = usePreferences()
  const { isLoading } = useProviders()
  const groups = useConnectionModelGroups()
  const catalogModels = groups.flatMap((group) => group.models)
  const enabledSet = new Set<string>(settings.enabledModels)
  const selectedCount = catalogModels.filter((model) => enabledSet.has(model.id)).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-text-primary">Available Models</h3>
          <p className="text-xs text-text-tertiary">
            Choose which models appear in the model selector.
          </p>
        </div>
        {catalogModels.length > 0 && (
          <p className="text-xs text-text-tertiary tabular-nums">
            <span className="text-accent">{selectedCount}</span> of {catalogModels.length} models
            selected
          </p>
        )}
      </div>

      {isLoading && groups.length === 0 ? (
        <p className="text-xs text-text-muted">Loading models…</p>
      ) : groups.length === 0 ? (
        <p className="text-xs text-text-muted">No providers or models were reported.</p>
      ) : (
        <AvailableModelsBrowser groups={groups} />
      )}
    </div>
  )
}
