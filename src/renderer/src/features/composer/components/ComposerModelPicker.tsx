import type { SupportedModelId } from '@shared/types/llm'
import { useChatStore } from '@/features/chat/state'
import { ModelSelector } from '@/features/providers/components'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useComposerModel } from '../hooks/useComposerModel'
import { useModelSwitchNotice } from '../hooks/useModelSwitchNotice'
import { useSessionSettingsLock } from '../hooks/useSessionSettingsLock'

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
  const settingsLock = useSessionSettingsLock(activeSessionId)

  function selectModel(model: SupportedModelId) {
    if (activeSessionId) {
      // A Session pick belongs to that Session; it does not change the project's default for new
      // Sessions. The picker is locked while a Run goes; a refused write rolls back with a toast.
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
      disabled={settingsLock.locked || draftSession?.isMaterializing}
      fallbackLabel={composerModel.isSessionModel ? composerModel.model : undefined}
      title={settingsLock.reason ?? switchNotice?.title}
    />
  )
}
