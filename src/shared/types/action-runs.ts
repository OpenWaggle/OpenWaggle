import type { ActionDefinition, ResolvedActionInvocation } from './action-definitions'

export type ActionRunStatus =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'interrupted'

/** A launch snapshot; subsequent definition edits never mutate this execution. */
export interface ActionRun {
  readonly id: string
  readonly requestId: string
  readonly workspaceId: string
  readonly projectPath: string
  readonly workspacePath: string
  readonly action: ActionDefinition
  readonly invocation: ResolvedActionInvocation
  readonly status: ActionRunStatus
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly exitCode: number | null
  readonly error: string | null
  readonly previewUrl: string | null
  readonly ready: boolean
  readonly outputBytes: number
}

export interface ActionOutputSnapshot {
  readonly run: ActionRun
  readonly output: string
  readonly startOffset: number
  readonly endOffset: number
  readonly truncated: boolean
  readonly hasMore: boolean
}

export function isActiveActionRun(run: Pick<ActionRun, 'status'>): boolean {
  return run.status === 'starting' || run.status === 'running' || run.status === 'stopping'
}
