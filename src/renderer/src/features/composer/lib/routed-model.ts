import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import { parseModelRef } from '@shared/types/llm'

interface RoutedModelInput {
  /** The model the composer selects. */
  readonly selected: SupportedModelId | undefined
  /** The physical model that produced the Session's latest response. */
  readonly answeredBy: SupportedModelId | undefined
  readonly providerModels: readonly ProviderInfo[]
}

function catalogModel(providerModels: readonly ProviderInfo[], ref: SupportedModelId) {
  for (const group of providerModels) {
    const model = group.models.find((candidate) => candidate.id === ref)
    if (model) return model
  }
  return undefined
}

/**
 * The display name of the physical model a virtual selection last sent a request to, as Pi's
 * footer shows `auto → gpt-6-luna`. Null for a physical selection or before any response.
 */
export function routedModelName({ selected, answeredBy, providerModels }: RoutedModelInput) {
  if (!selected || !answeredBy || answeredBy === selected) return null
  if (catalogModel(providerModels, selected)?.virtual !== true) return null
  const answering = catalogModel(providerModels, answeredBy)
  return answering?.name ?? parseModelRef(answeredBy)?.modelId ?? answeredBy
}

/** The model of the latest assistant message, which names the physical model that answered. */
export function lastAnsweringModel(
  messages: readonly { readonly role: string; readonly model?: SupportedModelId }[],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant' && message.model) return message.model
  }
  return undefined
}
