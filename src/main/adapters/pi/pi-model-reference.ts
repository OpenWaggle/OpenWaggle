import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { PiModel } from './pi-provider-catalog-types'

function findExplicitProviderModelReference(modelRuntime: ModelRuntime, modelReference: string) {
  const separatorIndex = modelReference.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === modelReference.length - 1) {
    return null
  }

  const provider = modelReference.slice(0, separatorIndex)
  const modelId = modelReference.slice(separatorIndex + 1)
  return modelRuntime.getModel(provider, modelId) ?? null
}

export function findPiToolCapableModel(
  modelRuntime: ModelRuntime,
  modelReference: string,
): PiModel | null {
  const trimmedReference = modelReference.trim()
  if (!trimmedReference) {
    return null
  }

  return findExplicitProviderModelReference(modelRuntime, trimmedReference)
}
