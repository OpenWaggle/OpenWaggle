import type { SchemaType } from '@shared/schema'
import type { backgroundRunUserMessageSchema } from '@shared/schemas/agent-transport-user-message'
import type {
  activeAgentRunInfoSchema,
  activeCompactionInfoSchema,
  activeRunInfoSchema,
  backgroundRunActivityEventSchema,
  runModeSchema,
  worktreeLaunchEnvironmentSchema,
  worktreeLaunchEventPayloadSchema,
  worktreeLaunchProgressSchema,
  worktreeLaunchSnapshotSchema,
  worktreeLaunchStageSchema,
  worktreeLaunchStepSchema,
  worktreeSetupActionTerminalSchema,
} from '@shared/schemas/background-run'
import type { MessagePart } from './agent'

export const WORKTREE_CREATED_CUSTOM_EVENT = 'openwaggle.worktree-created'

/** The run mode for a live Pi-backed execution. */
export type RunMode = SchemaType<typeof runModeSchema>

/** Compaction and retry events needed to restore the live chat activity after reconnecting. */
export type BackgroundRunActivityEvent = SchemaType<typeof backgroundRunActivityEventSchema>

/**
 * OpenWaggle-owned setup stages that run before Pi starts the task.
 *
 * The name predates local launches: a local-checkout Session reports the stages it runs too
 * (`syncing-branch`, `connecting-tools`, `starting-task`), so a first send never sits silent while
 * the Host pulls, connects MCP servers, or builds the Pi runtime.
 */
export type WorktreeLaunchStage = SchemaType<typeof worktreeLaunchStageSchema>

/** Where the launched task will run. Absent means a managed worktree (the original launch kind). */
export type WorktreeLaunchEnvironment = SchemaType<typeof worktreeLaunchEnvironmentSchema>

export type WorktreeLaunchStep = SchemaType<typeof worktreeLaunchStepSchema>
export type WorktreeSetupActionTerminal = SchemaType<typeof worktreeSetupActionTerminalSchema>
export type WorktreeLaunchProgress = SchemaType<typeof worktreeLaunchProgressSchema>
export type WorktreeLaunchSnapshot = SchemaType<typeof worktreeLaunchSnapshotSchema>
export type WorktreeLaunchEventPayload = SchemaType<typeof worktreeLaunchEventPayloadSchema>
export type ActiveAgentRunInfo = SchemaType<typeof activeAgentRunInfoSchema>
export type ActiveCompactionInfo = SchemaType<typeof activeCompactionInfoSchema>
export type ActiveRunInfo = SchemaType<typeof activeRunInfoSchema>

/** A user message the active Run has incorporated, retained so a reconnect still shows it. */
export type BackgroundRunUserMessage = SchemaType<typeof backgroundRunUserMessageSchema>

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
  readonly runId?: string | undefined
  readonly messageId?: string | undefined
  /** When the message `parts` streams started (Host time); absent from older Hosts. */
  readonly messageStartedAt?: number | undefined
  readonly parts: readonly MessagePart[]
  readonly userMessages?: readonly BackgroundRunUserMessage[] | undefined
  /**
   * The Run's earlier assistant messages, complete, in order, before the one `parts` streams. One
   * the byte caps cannot hold, or one cut short by them, is left out. Absent from older Hosts.
   */
  readonly assistantMessages?: readonly BackgroundRunAssistantMessage[] | undefined
  readonly degraded?: {
    readonly reason: 'content-limit'
    /**
     * All the caps omitted over the Run. On the GUI side it also counts streaming parts the client
     * could not decode, which mark the message cut short like the caps do.
     */
    readonly omittedBytes: number
    readonly toolCallIds?: readonly string[] | undefined
    /** Whether the caps cut the message `parts` streams; the omissions may be an earlier one's. */
    readonly messageCutShort: boolean
  }
  readonly worktreeLaunch?: WorktreeLaunchSnapshot | undefined
}
