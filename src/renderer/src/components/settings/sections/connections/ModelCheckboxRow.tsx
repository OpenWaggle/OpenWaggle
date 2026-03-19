import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'

interface ModelCheckboxRowProps {
  readonly model: ModelDisplayInfo
  readonly checked: boolean
  readonly provider: Provider
  readonly authMethod: 'api-key' | 'subscription'
  readonly onToggle: (
    provider: Provider,
    authMethod: 'api-key' | 'subscription',
    modelId: string,
    enabled: boolean,
  ) => void
}

export function ModelCheckboxRow({
  model,
  checked,
  provider,
  authMethod,
  onToggle,
}: ModelCheckboxRowProps) {
  return (
    <label className="flex items-center gap-2.5 h-8 px-2 rounded-lg hover:bg-bg-hover cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(provider, authMethod, model.id, !checked)}
        className="accent-accent"
      />
      <span className="text-[13px] text-text-primary">{model.name}</span>
    </label>
  )
}
