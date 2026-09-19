import { useSelectedSessionModel } from '@/features/chat/hooks'
import { ModelSelector } from '@/features/providers/components'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'

export function ComposerModelPicker() {
  const settings = usePreferencesStore((s) => s.settings)
  const { selectedModel, setSelectedModel } = useSelectedSessionModel()
  const providerModels = useProviderStore((s) => s.providerModels)

  return (
    <ModelSelector
      value={selectedModel}
      onChange={setSelectedModel}
      settings={settings}
      providerModels={providerModels}
    />
  )
}
