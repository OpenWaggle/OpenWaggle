import type { Provider } from '@shared/types/settings'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ModelGroup } from '@/features/providers/model'
import { Button } from '@/shared/ui/Button'
import { ModelCheckboxRow } from './ModelCheckboxRow'
import { getProviderMeta } from './meta'

interface ModelGroupAccordionProps {
  readonly group: ModelGroup
  readonly state: {
    readonly isExpanded: boolean
    readonly isLast: boolean
    readonly enabledSet: ReadonlySet<string>
  }
  readonly actions: {
    readonly onToggleExpand: (key: string) => void
    readonly onToggleModel: (provider: Provider, modelRef: string, enabled: boolean) => void
    readonly onSelectAll: (group: ModelGroup) => void
    readonly onClear: (group: ModelGroup) => void
  }
}

export function ModelGroupAccordion({ group, state, actions }: ModelGroupAccordionProps) {
  const providerMeta = getProviderMeta(group.provider)
  const Icon = providerMeta.icon
  const iconColor = providerMeta.color
  const enabledCount = group.models.filter((model) => state.enabledSet.has(model.id)).length

  return (
    <div className={!state.isLast ? 'border-b border-border' : ''}>
      {/* Accordion header */}
      <div className="flex items-center h-[52px] px-4 gap-3">
        <Button
          variant="unstyled"
          type="button"
          onClick={() => actions.onToggleExpand(group.key)}
          aria-expanded={state.isExpanded}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <Icon className="size-4 shrink-0" style={{ color: iconColor }} />
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-medium text-text-primary">{group.label}</span>
            {group.models.length > 0 && (
              <span className="ml-2 text-[11px] text-text-muted">
                {enabledCount}/{group.models.length} selected
              </span>
            )}
          </div>
          {state.isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-text-tertiary" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-text-tertiary" />
          )}
        </Button>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="unstyled"
            type="button"
            onClick={() => actions.onSelectAll(group)}
            aria-label={`Select all ${group.label} models`}
            className="text-[11px] text-accent hover:text-accent/80 transition-colors"
          >
            All
          </Button>
          <Button
            variant="unstyled"
            type="button"
            onClick={() => actions.onClear(group)}
            aria-label={`Deselect all ${group.label} models`}
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            None
          </Button>
        </div>
      </div>

      {/* Accordion body */}
      {state.isExpanded && (
        <div className="px-4 pb-2 border-t border-border/50">
          {group.models.length === 0 ? (
            <p className="py-3 text-[12px] text-text-muted">Loading models&hellip;</p>
          ) : (
            <div className="space-y-px pt-1">
              {group.models.map((model) => (
                <ModelCheckboxRow
                  key={model.id}
                  model={model}
                  checked={state.enabledSet.has(model.id)}
                  provider={group.provider}
                  onToggle={actions.onToggleModel}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
