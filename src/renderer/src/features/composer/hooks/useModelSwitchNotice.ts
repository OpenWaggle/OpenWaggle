import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import { generateDisplayName } from '@shared/types/llm'
import { useProviderStore } from '@/features/providers/state'
import { useComposerModel } from './useComposerModel'

function modelDisplayName(providerModels: readonly ProviderInfo[], model: SupportedModelId) {
  for (const provider of providerModels) {
    const name = provider.models.find((candidate) => candidate.id === model)?.name.trim()
    if (name) return name
  }
  return generateDisplayName(model)
}

/**
 * Explains a model picked while a turn streams: the pick waits for the next message and the
 * running turn keeps the model it started with. `null` when nothing is pending.
 */
export function useModelSwitchNotice() {
  const providerModels = useProviderStore((s) => s.providerModels)
  const composerModel = useComposerModel()
  if (!composerModel.appliesToNextMessage || !composerModel.model) return null
  if (!composerModel.runningModel) return null
  const next = modelDisplayName(providerModels, composerModel.model)
  const running = modelDisplayName(providerModels, composerModel.runningModel)
  return {
    message: `${next} applies to your next message. This turn keeps using ${running}.`,
    title: `Applies to your next message. The running turn keeps using ${running}.`,
  }
}
