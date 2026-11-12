import { sessionIdSchema, supportedModelIdSchema } from '@shared/types/brand'
import { Schema } from '../schema'
import {
  agentTransportAutoRetryEndEventSchema,
  agentTransportAutoRetryStartEventSchema,
  agentTransportCompactionEndEventSchema,
  agentTransportCompactionStartEventSchema,
} from './stream'

/** A Setup action terminal accepted by main and ready for renderer reconciliation. */
export const worktreeSetupActionTerminalSchema = Schema.Struct({
  terminalId: Schema.String,
  actionId: Schema.String,
  actionName: Schema.String,
  projectRoot: Schema.String,
  cwd: Schema.String,
})

/**
 * OpenWaggle-owned setup stages that run before Pi starts the task.
 *
 * The name predates local launches: a local-checkout Session reports the stages it runs too
 * (`syncing-branch`, `connecting-tools`, `starting-task`), so a first send never sits silent while
 * the Host pulls, connects MCP servers, or builds the Pi runtime.
 */
export const worktreeLaunchStageSchema = Schema.Literal(
  'preparing-workspace',
  'fetching-base',
  'checking-out-files',
  'worktree-created',
  'running-setup',
  'syncing-branch',
  'connecting-tools',
  'starting-task',
)

export const worktreeLaunchEnvironmentSchema = Schema.Literal('local', 'worktree')

/** One visible step of a launch, in the order it started. */
export const worktreeLaunchStepSchema = Schema.Struct({
  stage: worktreeLaunchStageSchema,
  label: Schema.String,
  startedAt: Schema.Number,
  /** Set once the step is known to be done; open steps render as in progress. */
  completedAt: Schema.optional(Schema.Number),
})

/** A point-in-time update produced by the worktree birth path. */
export const worktreeLaunchProgressSchema = Schema.Struct({
  stage: worktreeLaunchStageSchema,
  details: Schema.Array(Schema.String),
  /** Headline of the step this stage starts, e.g. "Pulling latest main from origin". */
  label: Schema.optional(Schema.String),
  /**
   * The step runs alongside the steps already open instead of following them. Sequential steps
   * close every open step when they start; parallel ones close only through `completesStep`.
   */
  parallel: Schema.optional(Schema.Boolean),
  /** Closes the open step of this stage without starting a new one. */
  completesStep: Schema.optional(Schema.Boolean),
  environment: Schema.optional(worktreeLaunchEnvironmentSchema),
  progressPercentage: Schema.optional(Schema.Number),
  worktreePath: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  setupAction: Schema.optional(worktreeSetupActionTerminalSchema),
})

/** Compaction and retry events needed to restore the live chat activity after reconnecting. */
export const backgroundRunActivityEventSchema = Schema.Union(
  agentTransportCompactionStartEventSchema,
  agentTransportCompactionEndEventSchema,
  agentTransportAutoRetryStartEventSchema,
  agentTransportAutoRetryEndEventSchema,
)

export const backgroundRunActivityEventsSchema = Schema.Array(backgroundRunActivityEventSchema)

/** Reconnectable state for the first-send worktree preflight card. */
export const worktreeLaunchSnapshotSchema = Schema.Struct({
  status: Schema.Literal('running', 'complete', 'failed'),
  stage: worktreeLaunchStageSchema,
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  details: Schema.Array(Schema.String),
  environment: Schema.optional(worktreeLaunchEnvironmentSchema),
  /** Labelled steps in start order; the last one is active while the launch runs. */
  steps: Schema.optional(Schema.Array(worktreeLaunchStepSchema)),
  progressPercentage: Schema.optional(Schema.Number),
  worktreePath: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  setupAction: Schema.optional(worktreeSetupActionTerminalSchema),
  errorMessage: Schema.optional(Schema.String),
})

export const worktreeLaunchEventPayloadSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  launch: Schema.NullOr(worktreeLaunchSnapshotSchema),
})

/** The run mode for a live Pi-backed execution. */
export const runModeSchema = Schema.Literal('classic', 'waggle')

/** Lightweight info about an active agent run (no message content). */
export const activeAgentRunInfoSchema = Schema.Struct({
  activity: Schema.Literal('agent-run'),
  sessionId: sessionIdSchema,
  model: supportedModelIdSchema,
  mode: runModeSchema,
  startedAt: Schema.Number,
  activityEvents: backgroundRunActivityEventsSchema,
})

/** Lightweight info about a standalone manual compaction. */
export const activeCompactionInfoSchema = Schema.Struct({
  activity: Schema.Literal('compaction'),
  sessionId: sessionIdSchema,
  model: supportedModelIdSchema,
  reason: Schema.Literal('manual'),
  startedAt: Schema.Number,
})

export const activeRunInfoSchema = Schema.Union(
  activeAgentRunInfoSchema,
  activeCompactionInfoSchema,
)
