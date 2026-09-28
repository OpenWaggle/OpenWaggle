import { Schema } from '../schema'
import { jsonValueSchema } from './validation'

const activityEventBase = {
  timestamp: Schema.Number,
  model: Schema.optional(Schema.String),
  rawEvent: Schema.optional(jsonValueSchema),
}
const compactionReason = Schema.Literal('manual', 'threshold', 'overflow')

export const worktreeSetupActionTerminalSchema = Schema.Struct({
  terminalId: Schema.String,
  actionId: Schema.String,
  actionName: Schema.String,
  projectRoot: Schema.String,
  cwd: Schema.String,
})

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

export const worktreeLaunchStepSchema = Schema.Struct({
  stage: worktreeLaunchStageSchema,
  label: Schema.String,
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
})

export const worktreeLaunchProgressSchema = Schema.Struct({
  stage: worktreeLaunchStageSchema,
  details: Schema.Array(Schema.String),
  label: Schema.optional(Schema.String),
  parallel: Schema.optional(Schema.Boolean),
  completesStep: Schema.optional(Schema.Boolean),
  environment: Schema.optional(worktreeLaunchEnvironmentSchema),
  progressPercentage: Schema.optional(Schema.Number),
  worktreePath: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  setupAction: Schema.optional(worktreeSetupActionTerminalSchema),
})

export const backgroundRunActivityEventsSchema = Schema.Array(
  Schema.Union(
    Schema.Struct({
      ...activityEventBase,
      type: Schema.Literal('compaction_start'),
      reason: compactionReason,
    }),
    Schema.Struct({
      ...activityEventBase,
      type: Schema.Literal('compaction_end'),
      reason: compactionReason,
      result: jsonValueSchema,
      aborted: Schema.Boolean,
      willRetry: Schema.Boolean,
      errorMessage: Schema.optional(Schema.String),
    }),
    Schema.Struct({
      ...activityEventBase,
      type: Schema.Literal('auto_retry_start'),
      attempt: Schema.Number,
      maxAttempts: Schema.Number,
      delayMs: Schema.Number,
      errorMessage: Schema.String,
    }),
    Schema.Struct({
      ...activityEventBase,
      type: Schema.Literal('auto_retry_end'),
      success: Schema.Boolean,
      attempt: Schema.Number,
      finalError: Schema.optional(Schema.String),
    }),
  ),
)
