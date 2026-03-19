import { isSubscriptionProvider } from '@shared/types/auth'
import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { enabledKey } from './helpers'
import { ModelCheckboxRow } from './ModelCheckboxRow'
import { PROVIDER_META, SUBSCRIPTION_META } from './meta'

interface ModelGroup {
  readonly key: string
  readonly label: string
  readonly subtitle?: string
  readonly provider: Provider
  readonly authMethod: 'api-key' | 'subscription'
  readonly models: readonly ModelDisplayInfo[]
}

interface ModelGroupAccordionProps {
  readonly group: ModelGroup
  readonly isExpanded: boolean
  readonly isLast: boolean
  readonly enabledSet: ReadonlySet<string>
  readonly onToggleExpand: (key: string) => void
  readonly onToggleModel: (
    provider: Provider,
    authMethod: 'api-key' | 'subscription',
    modelId: string,
    enabled: boolean,
  ) => void
  readonly onSelectAll: (group: ModelGroup) => void
  readonly onClear: (group: ModelGroup) => void
}

export type { ModelGroup }

export function ModelGroupAccordion({
  group,
  isExpanded,
  isLast,
  enabledSet,
  onToggleExpand,
  onToggleModel,
  onSelectAll,
  onClear,
}: ModelGroupAccordionProps) {
  const providerMeta = PROVIDER_META[group.provider]
  const subMeta =
    group.authMethod === 'subscription' && isSubscriptionProvider(group.provider)
      ? SUBSCRIPTION_META[group.provider]
      : undefined
  const Icon = subMeta?.icon ?? providerMeta.icon
  const iconColor = subMeta?.iconColor ?? providerMeta.color
  const enabledCount = group.models.filter((m) =>
    enabledSet.has(enabledKey(group.provider, group.authMethod, m.id)),
  ).length

  return (
    <div className={!isLast ? 'border-b border-border' : ''}>
      {/* Accordion header */}
      <div className="flex items-center h-[52px] px-4 gap-3">
        <button
          type="button"
          onClick={() => onToggleExpand(group.key)}
          aria-expanded={isExpanded}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <Icon className="h-4 w-4 shrink-0" style={{ color: iconColor }} />
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-medium text-text-primary">{group.label}</span>
            {group.models.length > 0 && (
              <span className="ml-2 text-[11px] text-text-muted">
                {enabledCount}/{group.models.length} selected
              </span>
            )}
          </div>
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          )}
        </button>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onSelectAll(group)}
            aria-label={`Select all ${group.label} models`}
            className="text-[11px] text-accent hover:text-accent/80 transition-colors"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onClear(group)}
            aria-label={`Deselect all ${group.label} models`}
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            None
          </button>
        </div>
      </div>

      {/* Accordion body */}
      {isExpanded && (
        <div className="px-4 pb-2 border-t border-border/50">
          {group.models.length === 0 ? (
            <p className="py-3 text-[12px] text-text-muted">Loading models...</p>
          ) : (
            <div className="space-y-px pt-1">
              {group.models.map((model) => (
                <ModelCheckboxRow
                  key={model.id}
                  model={model}
                  checked={enabledSet.has(enabledKey(group.provider, group.authMethod, model.id))}
                  provider={group.provider}
                  authMethod={group.authMethod}
                  onToggle={onToggleModel}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
