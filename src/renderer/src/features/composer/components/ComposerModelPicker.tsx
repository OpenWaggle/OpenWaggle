import { useChatStore } from '@/features/chat/state'
import { ModelSelector } from '@/features/providers/components'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useComposerModel } from '../hooks/useComposerModel'

export function ComposerModelPicker() {
  const settings = usePreferencesStore((s) => s.settings)
  const setSelectedModel = usePreferencesStore((s) => s.setSelectedModel)
  const setDraftSelectedModel = useChatStore((s) => s.setDraftSelectedModel)
  const draftSession = useChatStore((s) => s.draftSession)
  const providerModels = useProviderStore((s) => s.providerModels)
  const composerModel = useComposerModel()

  return (
    <ModelSelector
      value={composerModel.model}
      onChange={draftSession ? setDraftSelectedModel : setSelectedModel}
      settings={settings}
      providerModels={providerModels}
      disabled={composerModel.isSessionModel || draftSession?.isMaterializing}
      fallbackLabel={composerModel.isSessionModel ? composerModel.model : undefined}
      title={
        composerModel.isSessionModel
          ? `This Session uses ${composerModel.model}. Its model is fixed for the Session lifetime.`
          : undefined
      }
    />
  )
}
