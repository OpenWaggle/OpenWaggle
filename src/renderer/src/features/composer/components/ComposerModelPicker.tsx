import type { SupportedModelId } from '@shared/types/llm'
import { useChatStore } from '@/features/chat/state'
import { ModelSelector } from '@/features/providers/components'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useComposerModel } from '../hooks/useComposerModel'
import { useModelSwitchNotice } from '../hooks/useModelSwitchNotice'

export function ComposerModelPicker() {
  const settings = usePreferencesStore((s) => s.settings)
  const setSelectedModel = usePreferencesStore((s) => s.setSelectedModel)
  const setDraftSelectedModel = useChatStore((s) => s.setDraftSelectedModel)
  const setSessionModel = useChatStore((s) => s.setSessionModel)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const draftSession = useChatStore((s) => s.draftSession)
  const providerModels = useProviderStore((s) => s.providerModels)
  const composerModel = useComposerModel()
  const switchNotice = useModelSwitchNotice()

  function selectModel(model: SupportedModelId) {
    if (activeSessionId) {
      // A Session pick belongs to that Session; it does not change the project's default for new
      // Sessions. The write is durable at once and never reaches a Run that is already streaming.
      void setSessionModel(activeSessionId, model)
      return
    }
    if (draftSession) {
      setDraftSelectedModel(model)
      return
    }
    void setSelectedModel(model)
  }

  return (
    <ModelSelector
      value={composerModel.model}
      onChange={selectModel}
      settings={settings}
      providerModels={providerModels}
      disabled={draftSession?.isMaterializing}
      fallbackLabel={composerModel.isSessionModel ? composerModel.model : undefined}
      title={switchNotice?.title}
    />
  )
}
