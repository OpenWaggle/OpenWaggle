import { ModelSelector } from '@/features/providers/components'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'

export function ComposerModelPicker() {
  const settings = usePreferencesStore((s) => s.settings)
  const setSelectedModel = usePreferencesStore((s) => s.setSelectedModel)
  const providerModels = useProviderStore((s) => s.providerModels)

  return (
    <ModelSelector
      value={settings.selectedModel}
      onChange={setSelectedModel}
      settings={settings}
      providerModels={providerModels}
    />
  )
}
