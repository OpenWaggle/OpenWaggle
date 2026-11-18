import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { answeringModel, routedModelName } from '../lib/routed-model'
import { useComposerModel } from './useComposerModel'

/**
 * The selected model and, under a virtual selection, the physical model its router sent the latest
 * request to. Assistant messages name the model that answered; the Session refreshes them when a
 * Run completes, so the label follows each Run and survives a reload.
 */
export function useRoutedModelName() {
  const messages = useChatStore((state) => state.activeSession?.messages)
  const providerModels = useProviderStore((state) => state.providerModels)
  const composerModel = useComposerModel()
  const selected = composerModel.runningModel ?? composerModel.model
  const answeredBy = answeringModel({ messages: messages ?? [], selected, providerModels })
  const selectedName = providerModels
    .flatMap((group) => group.models)
    .find((model) => model.id === selected)?.name
  return {
    selectedName: selectedName ?? selected ?? '',
    routedName: routedModelName({ selected, answeredBy, providerModels }),
  }
}
