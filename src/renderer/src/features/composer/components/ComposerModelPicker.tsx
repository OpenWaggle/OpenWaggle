import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import { useChatStore } from '@/features/chat/state'
import { ModelSelector } from '@/features/providers/components'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { useComposerModel } from '../hooks/useComposerModel'
import { useRoutedModelName } from '../hooks/useRoutedModelName'
import { useSessionSettingsLock } from '../hooks/useSessionSettingsLock'

const logger = createRendererLogger('composer-model-picker')

/**
 * A Session's model the picker does not offer, such as a continued `pi` CLI Session's model the
 * user never enabled: its catalog name, or its ref when the catalog lacks it.
 */
function catalogModelName(
  providerModels: readonly ProviderInfo[],
  model: SupportedModelId | undefined,
) {
  if (!model) return undefined
  for (const group of providerModels) {
    const found = group.models.find((candidate) => candidate.id === model)
    if (found) return found.name
  }
  return model
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
  // Also locked while a draft's first message creates its Session.
  const settingsLock = useSessionSettingsLock(activeSessionId)

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
    // The picker fires this action with `void`, so a transient Settings IPC failure would
    // otherwise float as an unhandled renderer rejection (Sentry issue OPENWAGGLE-6). The pick
    // stays unapplied and the next selection retries it, so the failure is only logged.
    void setSelectedModel(model).catch((error: unknown) => {
      logger.warn('Failed to pick the model', { error: String(error) })
    })
  }

  const fallbackLabel = composerModel.isSessionModel
    ? catalogModelName(providerModels, composerModel.model)
    : undefined
  return (
    <>
      <ModelSelector
        value={composerModel.model}
        onChange={selectModel}
        settings={settings}
        providerModels={providerModels}
        disabled={settingsLock.locked}
        {...(fallbackLabel === undefined ? {} : { fallbackLabel })}
        {...(settingsLock.reason === null ? {} : { title: settingsLock.reason })}
      />
      <RoutedModelLabel />
    </>
  )
}

/** Under a virtual model, the physical model it sent the latest request to (`Auto → GPT-6 Luna`). */
function RoutedModelLabel() {
  const { selectedName, routedName } = useRoutedModelName()
  if (!routedName) return null
  return (
    <span
      className="max-w-40 truncate text-xs text-text-tertiary @max-xl/composer-toolbar:hidden"
      title={`${selectedName} sent the latest request to ${routedName}`}
    >
      → {routedName}
    </span>
  )
}
