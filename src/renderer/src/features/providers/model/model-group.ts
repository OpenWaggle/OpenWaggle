import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'

export interface ModelGroup {
  readonly key: string
  readonly label: string
  readonly subtitle?: string
  readonly provider: Provider
  readonly models: readonly ModelDisplayInfo[]
}
