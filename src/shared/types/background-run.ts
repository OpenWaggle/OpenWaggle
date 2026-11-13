import type { SchemaType } from '@shared/schema'
import type { backgroundRunUserMessageSchema } from '@shared/schemas/agent-transport-user-message'
import type {
  activeAgentRunInfoSchema,
  activeCompactionInfoSchema,
  activeRunInfoSchema,
  backgroundRunActivityEventSchema,
  backgroundRunAssistantMessageSchema,
  backgroundRunSnapshotSchema,
  runModeSchema,
  worktreeLaunchEnvironmentSchema,
  worktreeLaunchEventPayloadSchema,
  worktreeLaunchProgressSchema,
  worktreeLaunchSnapshotSchema,
  worktreeLaunchStepSchema,
  worktreeSetupActionTerminalSchema,
} from '@shared/schemas/background-run'

export const WORKTREE_CREATED_CUSTOM_EVENT = 'openwaggle.worktree-created'

/** The run mode for a live Pi-backed execution. */
export type RunMode = SchemaType<typeof runModeSchema>

/** Compaction and retry events needed to restore the live chat activity after reconnecting. */
export type BackgroundRunActivityEvent = SchemaType<typeof backgroundRunActivityEventSchema>

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
export type BackgroundRunAssistantMessage = SchemaType<typeof backgroundRunAssistantMessageSchema>

/** Full snapshot including accumulated message parts for reconnection. */
export type BackgroundRunSnapshot = SchemaType<typeof backgroundRunSnapshotSchema>
