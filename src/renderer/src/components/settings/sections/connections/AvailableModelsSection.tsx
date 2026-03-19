import type { Provider } from '@shared/types/settings'
import { useState } from 'react'
import { useConnectionModelGroups } from '@/hooks/useConnectionModelGroups'
import { usePreferences } from '@/hooks/useSettings'
import { enabledKey } from './helpers'
import { type ModelGroup, ModelGroupAccordion } from './ModelGroupAccordion'

export function AvailableModelsSection() {
  const { settings, setEnabledModels } = usePreferences()
  const groups = useConnectionModelGroups(settings.providers)

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const enabledSet = new Set(settings.enabledModels)

  function toggleGroup(key: string): void {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleToggle(
    provider: Provider,
    authMethod: 'api-key' | 'subscription',
    modelId: string,
    enabled: boolean,
  ): void {
    const key = enabledKey(provider, authMethod, modelId)
    const current = [...settings.enabledModels]
    const next = enabled ? [...new Set([...current, key])] : current.filter((k) => k !== key)
    void setEnabledModels(next)
  }

  function handleSelectAll(group: ModelGroup): void {
    const keys = group.models.map((m) => enabledKey(group.provider, group.authMethod, String(m.id)))
    void setEnabledModels([...new Set([...settings.enabledModels, ...keys])])
  }

  function handleClear(group: ModelGroup): void {
    const keySet = new Set(
      group.models.map((m) => enabledKey(group.provider, group.authMethod, String(m.id))),
    )
    void setEnabledModels([...settings.enabledModels].filter((k) => !keySet.has(k)))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text-primary">Available Models</h3>
        <p className="text-[13px] text-text-tertiary">
          Choose which models appear in the model selector.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-[13px] text-text-muted">
          Configure a provider above to see available models.
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-[#111418] overflow-hidden">
          {groups.map((group, i) => (
            <ModelGroupAccordion
              key={group.key}
              group={group}
              isExpanded={expandedGroups.has(group.key)}
              isLast={i === groups.length - 1}
              enabledSet={enabledSet}
              onToggleExpand={toggleGroup}
              onToggleModel={handleToggle}
              onSelectAll={handleSelectAll}
              onClear={handleClear}
            />
          ))}
        </div>
      )}
    </div>
  )
}
