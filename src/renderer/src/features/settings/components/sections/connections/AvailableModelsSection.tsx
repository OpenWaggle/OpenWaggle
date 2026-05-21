import type { Provider } from '@shared/types/settings'
import { useState } from 'react'
import { useConnectionModelGroups } from '@/features/providers/hooks'
import type { ModelGroup } from '@/features/providers/model'
import { usePreferences, useProviders } from '@/features/settings/hooks/useSettings'
import { ModelGroupAccordion } from './ModelGroupAccordion'

export function AvailableModelsSection() {
  const { settings, setEnabledModels } = usePreferences()
  const { isLoading } = useProviders()
  const groups = useConnectionModelGroups()

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const enabledSet = new Set(settings.enabledModels)

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleToggle(_provider: Provider, modelRef: string, enabled: boolean) {
    const current = [...settings.enabledModels]
    const next = enabled
      ? [...new Set([...current, modelRef])]
      : current.filter((model) => model !== modelRef)
    void setEnabledModels(next)
  }

  function handleSelectAll(group: ModelGroup) {
    const refs = group.models.map((model) => String(model.id))
    void setEnabledModels([...new Set([...settings.enabledModels, ...refs])])
  }

  function handleClear(group: ModelGroup) {
    const modelRefs = new Set(group.models.map((model) => String(model.id)))
    void setEnabledModels([...settings.enabledModels].filter((model) => !modelRefs.has(model)))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text-primary">Available Models</h3>
        <p className="text-[13px] text-text-tertiary">
          Choose which models appear in the model selector.
        </p>
      </div>

      {isLoading && groups.length === 0 ? (
        <p className="text-[13px] text-text-muted">Loading Pi models…</p>
      ) : groups.length === 0 ? (
        <p className="text-[13px] text-text-muted">Pi did not report any providers or models.</p>
      ) : (
        <div className="rounded-lg border border-border bg-[#111418] overflow-hidden">
          {groups.map((group, i) => (
            <ModelGroupAccordion
              key={group.key}
              group={group}
              state={{
                isExpanded: expandedGroups.has(group.key),
                isLast: i === groups.length - 1,
                enabledSet,
              }}
              actions={{
                onToggleExpand: toggleGroup,
                onToggleModel: handleToggle,
                onSelectAll: handleSelectAll,
                onClear: handleClear,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
