import type { MessagePart } from './agent'
import type { SessionId } from './brand'
import type { SupportedModelId } from './llm'

export const WORKTREE_CREATED_CUSTOM_EVENT = 'openwaggle.worktree-created'

/** The run mode for a live Pi-backed execution. */
export type RunMode = 'classic' | 'waggle'

/** OpenWaggle-owned setup stages that run before Pi starts the task. */
export type WorktreeLaunchStage =
  | 'preparing-workspace'
  | 'checking-out-files'
  | 'worktree-created'
  | 'starting-task'

/** A point-in-time update produced by the worktree birth path. */
export interface WorktreeLaunchProgress {
  readonly stage: WorktreeLaunchStage
  readonly details: readonly string[]
  readonly progressPercentage?: number
  readonly worktreePath?: string
  readonly branch?: string
  readonly baseRef?: string
}

/** Reconnectable state for the first-send worktree preflight card. */
export interface WorktreeLaunchSnapshot {
  readonly status: 'running' | 'complete' | 'failed'
  readonly stage: WorktreeLaunchStage
  readonly startedAt: number
  readonly updatedAt: number
  readonly details: readonly string[]
  readonly progressPercentage?: number
  readonly worktreePath?: string
  readonly branch?: string
  readonly baseRef?: string
  readonly errorMessage?: string
}

export interface WorktreeLaunchEventPayload {
  readonly sessionId: SessionId
  readonly launch: WorktreeLaunchSnapshot | null
}

/** Lightweight info about an active background run (no message content). */
export interface ActiveRunInfo {
  readonly sessionId: SessionId
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
}

/** Full snapshot including accumulated message parts for reconnection. */
export interface BackgroundRunSnapshot extends ActiveRunInfo {
  readonly messageId?: string
  readonly parts: readonly MessagePart[]
  readonly worktreeLaunch?: WorktreeLaunchSnapshot
}
