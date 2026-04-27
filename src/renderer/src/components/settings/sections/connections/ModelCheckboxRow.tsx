import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'

interface ModelCheckboxRowProps {
  readonly model: ModelDisplayInfo
  readonly checked: boolean
  readonly provider: Provider
  readonly onToggle: (provider: Provider, modelRef: string, enabled: boolean) => void
}

export function ModelCheckboxRow({ model, checked, provider, onToggle }: ModelCheckboxRowProps) {
  return (
    <label className="flex items-center gap-2.5 h-8 px-2 rounded-lg hover:bg-bg-hover cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(provider, model.id, !checked)}
        className="accent-accent"
      />
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">{model.name}</span>
      {!model.available && <span className="text-[11px] text-text-muted">Auth required</span>}
    </label>
  )
}
