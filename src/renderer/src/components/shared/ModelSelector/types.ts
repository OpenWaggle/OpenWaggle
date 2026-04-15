import type { SupportedModelId } from '@shared/types/brand'
import type { ModelSwitchCompatibility } from '@shared/types/context'
import type { Provider } from '@shared/types/settings'

export interface FlatModel {
  readonly id: SupportedModelId
  readonly name: string
  readonly provider: Provider
  readonly authMethod?: 'api-key' | 'subscription'
  readonly compatibility?: ModelSwitchCompatibility
  readonly contextWindowLabel?: string
}
