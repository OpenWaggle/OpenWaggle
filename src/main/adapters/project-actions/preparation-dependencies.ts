import type {
  ActionCatalog,
  ActionInvocation,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { PreparationPersistence } from './preparation-persistence'

export interface PreparationDependencies {
  readonly rememberReview?: (
    workspace: ActionRunWorkspace,
    definition: PreparationDefinition,
    enabled: boolean,
  ) => Promise<void>
  readonly persistence: PreparationPersistence
  readonly catalog: (workspace: ActionRunWorkspace) => Promise<ActionCatalog>
  readonly execute: (input: {
    readonly workspace: ActionRunWorkspace
    readonly invocation: ActionInvocation
    readonly environment: Readonly<Record<string, string>>
    readonly captureEnvironment: boolean
    readonly signal?: AbortSignal
    readonly onOutput: (chunk: string) => void
  }) => Promise<{
    readonly exitCode: number | null
    readonly environment: Readonly<Record<string, string>>
  }>
  readonly acquireLiveness: () => () => void
}
