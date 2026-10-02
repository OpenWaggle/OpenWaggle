import type { SupportedModelId } from '@shared/types/llm'
import { useChatStore } from '@/features/chat/state'
import { ModelSelector } from '@/features/providers/components'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useComposerModel } from '../hooks/useComposerModel'
import { useSessionSettingsLock } from '../hooks/useSessionSettingsLock'

/** Why the picker waits while a draft's first message creates its Session. */
const MATERIALIZING_REASON = 'Available once the new Session is created'

export function ComposerModelPicker() {
  const settings = usePreferencesStore((s) => s.settings)
  const setSelectedModel = usePreferencesStore((s) => s.setSelectedModel)
  const setDraftSelectedModel = useChatStore((s) => s.setDraftSelectedModel)
  const setSessionModel = useChatStore((s) => s.setSessionModel)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const draftSession = useChatStore((s) => s.draftSession)
  const providerModels = useProviderStore((s) => s.providerModels)
  const composerModel = useComposerModel()
  const settingsLock = useSessionSettingsLock(activeSessionId)
  const materializing = draftSession?.isMaterializing === true

  function selectModel(model: SupportedModelId) {
    if (activeSessionId) {
      // A Session pick belongs to that Session and is stored through the Session Host, which
      // refuses it while a Run is starting, active, or finishing. The picker is locked for that
      // time; a refused write still rolls back with a toast.
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
      disabled={settingsLock.locked || materializing}
      fallbackLabel={composerModel.isSessionModel ? composerModel.model : undefined}
      title={settingsLock.reason ?? (materializing ? MATERIALIZING_REASON : undefined)}
    />
  )
}
