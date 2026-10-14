import type { ModelDisplayInfo } from '@shared/types/llm'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ModelGroup } from '@/features/providers/model'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { ModelCheckboxRow } from './ModelCheckboxRow'

/** Rows rendered before "Show more", so "All providers" stays responsive with large catalogs. */
const INITIAL_ROW_LIMIT = 100

interface ModelListPanelProps {
  /** The provider in scope, or null for all providers. */
  readonly group: ModelGroup | null
  readonly state: {
    /** Every model in scope, ignoring the search and filters. */
    readonly scopeModels: readonly ModelDisplayInfo[]
    /** Models in scope that match the search and filters. */
    readonly visibleModels: readonly ModelDisplayInfo[]
    readonly search: string
    readonly queryActive: boolean
    readonly enabledSet: ReadonlySet<string>
    readonly providerLabels: ReadonlyMap<string, string>
    /** Matches outside the current provider, offered when this one has none. */
    readonly matchesElsewhere: number
  }
  readonly actions: {
    readonly onToggleModel: (modelRef: string, enabled: boolean) => void
    readonly onSelectModels: (models: readonly ModelDisplayInfo[]) => void
    readonly onDeselectModels: (models: readonly ModelDisplayInfo[]) => void
    readonly onShowAllProviders: () => void
  }
}

function EmptyState({
  matchesElsewhere,
  onShowAllProviders,
}: {
  readonly matchesElsewhere: number
  readonly onShowAllProviders: () => void
}) {
  return (
    <div className="space-y-2 px-4 py-8 text-center text-xs text-text-tertiary">
      <p>No models here match.</p>
      {matchesElsewhere > 0 && (
        <Button variant="link" size="none" type="button" onClick={onShowAllProviders}>
          Show {matchesElsewhere} {matchesElsewhere === 1 ? 'match' : 'matches'} in other providers
        </Button>
      )}
    </div>
  )
}

export function ModelListPanel({ group, state, actions }: ModelListPanelProps) {
  const [showAll, setShowAll] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // The button unmounts once every row shows, so keep focus on the first row it revealed.
  function showRemainingRows() {
    const firstRevealed = rows.length
    flushSync(() => setShowAll(true))
    listRef.current
      ?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .item(firstRevealed)
      ?.focus()
  }
  const selectedInScope = state.scopeModels.filter((model) => state.enabledSet.has(model.id)).length
  const rows = showAll ? state.visibleModels : state.visibleModels.slice(0, INITIAL_ROW_LIMIT)
  const hiddenRows = state.visibleModels.length - rows.length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center gap-3 border-border border-b px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-xs font-medium text-text-primary">
            {group?.label ?? 'All providers'}
          </span>
          <span className="text-xs text-text-muted tabular-nums">
            {selectedInScope}/{state.scopeModels.length} selected
          </span>
          {group && (
            <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  group.connected ? 'bg-success' : 'bg-text-muted',
                )}
              />
              {group.connected ? 'Ready to use' : 'Auth required'}
            </span>
          )}
        </div>
        {group && !state.queryActive && (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="unstyled"
              type="button"
              onClick={() => actions.onSelectModels(group.models)}
              aria-label={`Select all ${group.label} models`}
              className="text-xs text-accent transition-colors hover:text-accent/80"
            >
              All
            </Button>
            <Button
              variant="unstyled"
              type="button"
              onClick={() => actions.onDeselectModels(group.models)}
              aria-label={`Deselect all ${group.label} models`}
              className="text-xs text-text-tertiary transition-colors hover:text-text-secondary"
            >
              None
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1 max-sm:max-h-120">
        {state.visibleModels.length === 0 ? (
          state.scopeModels.length === 0 && !state.queryActive ? (
            // The section shows its own loading state; by now the catalog has loaded.
            <p className="px-2 py-3 text-xs text-text-muted">No models are listed here.</p>
          ) : (
            <EmptyState
              matchesElsewhere={state.matchesElsewhere}
              onShowAllProviders={actions.onShowAllProviders}
            />
          )
        ) : (
          <div ref={listRef} className="space-y-px">
            {rows.map((model) => (
              <ModelCheckboxRow
                key={model.id}
                model={model}
                checked={state.enabledSet.has(model.id)}
                search={state.search}
                providerLabel={group ? undefined : state.providerLabels.get(model.provider)}
                onToggle={actions.onToggleModel}
              />
            ))}
            {hiddenRows > 0 && (
              <Button
                variant="link"
                size="none"
                type="button"
                className="px-2 py-2 text-xs"
                onClick={showRemainingRows}
              >
                Show {hiddenRows} more
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
