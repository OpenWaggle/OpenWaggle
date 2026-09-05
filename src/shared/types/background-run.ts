import type { MessagePart } from './agent'
import type { SessionId } from './brand'
import type { SupportedModelId } from './llm'
import type { AgentTransportEvent } from './stream'

export const WORKTREE_CREATED_CUSTOM_EVENT = 'openwaggle.worktree-created'

/** The run mode for a live Pi-backed execution. */
export type RunMode = 'classic' | 'waggle'

/** Compaction and retry events needed to restore the live chat activity after reconnecting. */
export type BackgroundRunActivityEvent = Extract<
  AgentTransportEvent,
  {
    readonly type: 'compaction_start' | 'compaction_end' | 'auto_retry_start' | 'auto_retry_end'
  }
>

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

/** Lightweight info about an active agent run (no message content). */
export interface ActiveAgentRunInfo {
  readonly activity: 'agent-run'
  readonly sessionId: SessionId
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
  readonly activityEvents: readonly BackgroundRunActivityEvent[]
}

/** Lightweight info about a standalone manual compaction. */
export interface ActiveCompactionInfo {
  readonly activity: 'compaction'
  readonly sessionId: SessionId
  readonly model: SupportedModelId
  readonly reason: 'manual'
  readonly startedAt: number
}

export type ActiveRunInfo = ActiveAgentRunInfo | ActiveCompactionInfo

/** Full snapshot including accumulated message parts for reconnection. */
export interface BackgroundRunSnapshot extends ActiveAgentRunInfo {
  readonly messageId?: string
  readonly parts: readonly MessagePart[]
  readonly worktreeLaunch?: WorktreeLaunchSnapshot
}
