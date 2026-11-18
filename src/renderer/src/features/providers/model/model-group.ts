import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'

export interface ModelGroup {
  readonly key: string
  readonly label: string
  readonly subtitle?: string
  readonly provider: Provider
  /** Pi resolves auth for this provider, so its models are usable. */
  readonly connected: boolean
  readonly models: readonly ModelDisplayInfo[]
}
