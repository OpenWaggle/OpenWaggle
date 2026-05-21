import type { SupportedModelId } from '@shared/types/brand'
import type { Provider } from '@shared/types/settings'

export interface FlatModel {
  readonly id: SupportedModelId
  readonly modelId: string
  readonly name: string
  readonly provider: Provider
  readonly providerName: string
  readonly contextWindowLabel?: string
}
