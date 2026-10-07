import type { MessagePart } from './agent'
import type { SessionId } from './brand'
import type { JsonObject } from './json'
import type { SupportedModelId } from './llm'
import type { AgentTransportEvent, AgentTransportUserMessage } from './stream'

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

/**
 * OpenWaggle-owned setup stages that run before Pi starts the task.
 *
 * The name predates local launches: a local-checkout Session reports the stages it runs too
 * (`syncing-branch`, `connecting-tools`, `starting-task`), so a first send never sits silent while
 * the Host pulls, connects MCP servers, or builds the Pi runtime.
 */
export type WorktreeLaunchStage =
  | 'preparing-workspace'
  | 'fetching-base'
  | 'checking-out-files'
  | 'worktree-created'
  | 'running-setup'
  | 'syncing-branch'
  | 'connecting-tools'
  | 'starting-task'

/** Where the launched task will run. Absent means a managed worktree (the original launch kind). */
export type WorktreeLaunchEnvironment = 'local' | 'worktree'

/** One visible step of a launch, in the order it started. */
export interface WorktreeLaunchStep {
  readonly stage: WorktreeLaunchStage
  readonly label: string
  readonly startedAt: number
  /** Set once the step is known to be done; open steps render as in progress. */
  readonly completedAt?: number
}

/** A Setup action terminal accepted by main and ready for renderer reconciliation. */
export interface WorktreeSetupActionTerminal extends JsonObject {
  readonly terminalId: string
  readonly actionId: string
  readonly actionName: string
  readonly projectRoot: string
  readonly cwd: string
}

/** A point-in-time update produced by the worktree birth path. */
export interface WorktreeLaunchProgress {
  readonly stage: WorktreeLaunchStage
  readonly details: readonly string[]
  /** Headline of the step this stage starts, e.g. "Pulling latest main from origin". */
  readonly label?: string
  /**
   * The step runs alongside the steps already open instead of following them. Sequential steps
   * close every open step when they start; parallel ones close only through `completesStep`.
   */
  readonly parallel?: boolean
  /** Closes the open step of this stage without starting a new one. */
  readonly completesStep?: boolean
  readonly environment?: WorktreeLaunchEnvironment
  readonly progressPercentage?: number
  readonly worktreePath?: string
  readonly branch?: string
  readonly baseRef?: string
  readonly setupAction?: WorktreeSetupActionTerminal
}

/** Reconnectable state for the first-send worktree preflight card. */
export interface WorktreeLaunchSnapshot {
  readonly status: 'running' | 'complete' | 'failed'
  readonly stage: WorktreeLaunchStage
  readonly startedAt: number
  readonly updatedAt: number
  readonly details: readonly string[]
  readonly environment?: WorktreeLaunchEnvironment
  /** Labelled steps in start order; the last one is active while the launch runs. */
  readonly steps?: readonly WorktreeLaunchStep[]
  readonly progressPercentage?: number
  readonly worktreePath?: string
  readonly branch?: string
  readonly baseRef?: string
  readonly setupAction?: WorktreeSetupActionTerminal
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

/** A user message the active Run has incorporated, retained so a reconnect still shows it. */
export interface BackgroundRunUserMessage extends AgentTransportUserMessage {
  readonly messageId: string
  /** When the Run incorporated the message. */
  readonly timestamp: number
  /** The assistant message the snapshot was streaming when the Run incorporated this one. */
  readonly afterAssistantMessageId?: string
}

/**
 * An assistant message the active Run finished streaming, retained so a reconnect (a renderer
 * reload) still shows it: a Run's messages reach the persisted transcript only when it ends.
 */
export interface BackgroundRunAssistantMessage {
  readonly messageId: string
  /** When the message started streaming (Host time). */
  readonly timestamp: number
  /** Its text, reasoning, tool calls and tool results, as `parts` holds the streaming one's. */
  readonly parts: readonly MessagePart[]
}

/** Full snapshot including accumulated message parts for reconnection. */
export interface BackgroundRunSnapshot extends ActiveAgentRunInfo {
  /** The Run the snapshot belongs to; absent from older Hosts. */
  readonly runId?: string
  readonly messageId?: string
  /** When the message `parts` streams started (Host time); absent from older Hosts. */
  readonly messageStartedAt?: number
  readonly parts: readonly MessagePart[]
  readonly userMessages?: readonly BackgroundRunUserMessage[]
  /**
   * The Run's earlier assistant messages, complete, in order, before the one `parts` streams. One
   * the byte caps cannot hold, or one cut short by them, is left out. Absent from older Hosts.
   */
  readonly assistantMessages?: readonly BackgroundRunAssistantMessage[]
  readonly degraded?: {
    readonly reason: 'content-limit'
    readonly omittedBytes: number
    readonly toolCallIds?: readonly string[]
  }
  readonly worktreeLaunch?: WorktreeLaunchSnapshot
}
