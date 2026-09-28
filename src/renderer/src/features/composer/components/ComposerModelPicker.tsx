import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import { generateDisplayName } from '@shared/types/llm'
import { useChatStore } from '@/features/chat/state'
import { ModelSelector } from '@/features/providers/components'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useComposerModel } from '../hooks/useComposerModel'

function modelDisplayName(providerModels: readonly ProviderInfo[], model: SupportedModelId) {
  for (const provider of providerModels) {
    const match = provider.models.find((candidate) => candidate.id === model)
    if (match?.name.trim()) return match.name.trim()
  }
  return generateDisplayName(model)
}

export function ComposerModelPicker() {
  const settings = usePreferencesStore((s) => s.settings)
  const setSelectedModel = usePreferencesStore((s) => s.setSelectedModel)
  const setDraftSelectedModel = useChatStore((s) => s.setDraftSelectedModel)
  const setSessionModel = useChatStore((s) => s.setSessionModel)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const draftSession = useChatStore((s) => s.draftSession)
  const providerModels = useProviderStore((s) => s.providerModels)
  const composerModel = useComposerModel()

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

  const runningModel = composerModel.appliesToNextMessage ? composerModel.runningModel : undefined
  const title = runningModel
    ? `Applies to your next message. The running turn keeps using ${modelDisplayName(providerModels, runningModel)}.`
    : undefined

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ModelSelector
        value={composerModel.model}
        onChange={selectModel}
        settings={settings}
        providerModels={providerModels}
        disabled={draftSession?.isMaterializing}
        fallbackLabel={composerModel.isSessionModel ? composerModel.model : undefined}
        title={title}
      />
      {runningModel ? (
        <span
          role="status"
          className="shrink-0 whitespace-nowrap text-xs text-text-tertiary @max-xl/composer-toolbar:hidden"
        >
          Next message
        </span>
      ) : null}
    </div>
  )
}
