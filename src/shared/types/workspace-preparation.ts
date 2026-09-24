import type { ActionCatalog, PreparationProfile } from './action-definitions'

export type PreparationPhase = 'setup' | 'cleanup'
export type PreparationStatus =
  | 'idle'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'review-required'
export interface PreparationExecution {
  readonly status: PreparationStatus
  readonly attemptId: string | null
  readonly startedAt: number | null
  readonly finishedAt: number | null
  readonly exitCode: number | null
  readonly error: string | null
  readonly output: string
  readonly truncated: boolean
}
export interface WorkspacePreparationSnapshot {
  readonly profile: PreparationProfile
  readonly capturedAt: number
  readonly definitions: ActionCatalog['preparation']
}
/** Public projection deliberately excludes the workspace's private exported environment. */
export interface WorkspacePreparation {
  readonly workspaceId: string
  readonly revision: number
  readonly snapshot: WorkspacePreparationSnapshot
  readonly setup: PreparationExecution
  readonly cleanup: PreparationExecution
  readonly updateAvailable: boolean
  /** The pinned snapshot stays usable when the current catalog cannot be inspected. */
  readonly catalogError?: string
}
export type PreparationOperation =
  | { readonly type: 'stop-setup'; readonly attemptId: string }
  | { readonly type: 'preparation' }
  | {
      readonly type: 'select-preparation'
      readonly profileId: string
      readonly expectedRevision: number
    }
  | { readonly type: 'adopt-preparation'; readonly expectedRevision: number }
  | {
      readonly type: 'run-preparation'
      readonly phase: PreparationPhase
      readonly expectedRevision: number
    }
  | {
      readonly type: 'skip-preparation'
      readonly phase: PreparationPhase
      readonly expectedRevision: number
    }
  | {
      readonly type: 'review-snapshot'
      readonly definitionId: string
      readonly enabled: boolean
      readonly expectedRevision: number
    }
