import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import { Checkbox } from '@/shared/ui/Checkbox'

interface ModelCheckboxRowProps {
  readonly model: ModelDisplayInfo
  readonly checked: boolean
  readonly provider: Provider
  readonly onToggle: (provider: Provider, modelRef: string, enabled: boolean) => void
}

export function ModelCheckboxRow({ model, checked, provider, onToggle }: ModelCheckboxRowProps) {
  return (
    <Checkbox
      checked={checked}
      onChange={() => onToggle(provider, model.id, !checked)}
      className="accent-accent"
      label={
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
            {model.name}
          </span>
          {!model.available && <span className="text-[11px] text-text-muted">Auth required</span>}
        </>
      }
      labelClassName="h-8 gap-2.5 rounded-lg px-2 hover:bg-bg-hover"
    />
  )
}
