import type {
  ActionCatalog,
  ActionInvocation,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import type { PreparedEnvironment } from '../../domain/prepared-environment'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { LinkedWorktreeCheck } from '../../ports/git-worktree-service'
import type { PreparationPersistence } from './preparation-persistence'

export interface PreparationDependencies {
  readonly rememberReview?: (
    workspace: ActionRunWorkspace,
    definition: PreparationDefinition,
    enabled: boolean,
  ) => Promise<(() => Promise<void>) | void>
  readonly persistence: PreparationPersistence
  readonly catalog: (workspace: ActionRunWorkspace) => Promise<ActionCatalog>
  readonly execute: (input: {
    readonly workspace: ActionRunWorkspace
    readonly invocation: ActionInvocation
    readonly environment: PreparedEnvironment
    readonly captureEnvironment: boolean
    readonly signal?: AbortSignal
    readonly onOutput: (chunk: string) => void
  }) => Promise<{
    readonly exitCode: number | null
    readonly environment: PreparedEnvironment
  }>
  readonly acquireLiveness: () => () => void
  /** Whether a folder is a finished linked worktree of the project, before a run records it. */
  readonly inspectLinkedWorktree: (
    projectPath: string,
    candidatePath: string,
  ) => Promise<LinkedWorktreeCheck>
}
