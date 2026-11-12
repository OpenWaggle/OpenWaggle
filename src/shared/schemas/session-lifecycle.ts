import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import { SESSION_HOST_ERROR_KINDS } from '@shared/domain/session-host-refusals'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  hasUniqueCollaborationItemsBy,
  hasUniqueCollaborationStrings,
  SESSION_COLLABORATION_COLLECTION_LIMIT,
} from '@shared/session-collaboration-collections'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import {
  SESSION_LIFECYCLE_CONTRACT_VERSION,
  SESSION_LIFECYCLE_OPERATIONS,
} from '@shared/types/session-lifecycle'
import { THINKING_LEVELS } from '@shared/types/settings'
import { sessionAttachmentIdsSchema } from './session-attachment'
import {
  sessionInputIdSchema,
  sessionInputItemTextSchema,
  sessionInputPathSchema,
  sessionInputTextSchema,
} from './session-input'
import { sessionTitleSchema } from './session-title'

const projectPathSchema = sessionInputPathSchema

export const specializationSchema = Schema.Struct({
  modelId: Schema.optional(sessionInputIdSchema),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  agentDefinitionName: Schema.optional(sessionInputIdSchema),
})

const newWorktreeSchema = Schema.Struct({
  mode: Schema.Literal('new-worktree'),
  baseRef: Schema.optional(sessionInputItemTextSchema),
  startFromOrigin: Schema.optional(Schema.Boolean),
})

export const launchWorkspaceSchema = Schema.Union(
  Schema.Struct({ mode: Schema.Literal('current') }),
  Schema.Struct({ mode: Schema.Literal('local') }),
  newWorktreeSchema,
  Schema.Struct({ mode: Schema.Literal('existing'), workspaceId: sessionInputIdSchema }),
)

export const spawnWorkspaceSchema = Schema.Union(
  Schema.Struct({ mode: Schema.Literal('share-parent') }),
  Schema.Struct({ mode: Schema.Literal('local') }),
  newWorktreeSchema,
)

export const forkWorkspaceSchema = Schema.Union(
  Schema.Struct({ mode: Schema.Literal('share-source') }),
  Schema.Struct({ mode: Schema.Literal('local') }),
  newWorktreeSchema,
  Schema.Struct({ mode: Schema.Literal('existing'), workspaceId: sessionInputIdSchema }),
)

export const createCommandSchema = Schema.Struct({
  operation: Schema.Literal('create'),
  projectPath: projectPathSchema,
  title: Schema.optional(sessionTitleSchema),
  workspace: Schema.optional(launchWorkspaceSchema),
  specialization: Schema.optional(specializationSchema),
})

export const launchCommandSchema = Schema.Struct({
  operation: Schema.Literal('launch'),
  projectPath: projectPathSchema,
  title: Schema.optional(sessionTitleSchema),
  workspace: Schema.optional(launchWorkspaceSchema),
  specialization: Schema.optional(specializationSchema),
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  objective: sessionInputTextSchema,
  attachmentIds: sessionAttachmentIdsSchema,
  interactionTimeoutMs: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, MAX_NODE_TIMER_DELAY_MS)),
  ),
})

const uniqueSpecificationStringsSchema = Schema.Array(sessionInputItemTextSchema).pipe(
  Schema.maxItems(SESSION_COLLABORATION_COLLECTION_LIMIT),
  Schema.filter(
    (items) =>
      hasUniqueCollaborationStrings(items) || 'Delegation specification items must be unique.',
  ),
)

const delegationDependenciesSchema = Schema.Array(
  Schema.Struct({
    delegationId: sessionInputIdSchema,
    requiredState: Schema.Literal('ready_for_review', 'accepted'),
  }),
).pipe(
  Schema.maxItems(SESSION_COLLABORATION_COLLECTION_LIMIT),
  Schema.filter(
    (dependencies) =>
      hasUniqueCollaborationItemsBy(dependencies, (dependency) => dependency.delegationId) ||
      'Delegation dependency IDs must be unique.',
  ),
)

export const delegationSpecificationSchema = Schema.Struct({
  objective: sessionInputTextSchema,
  deliverables: uniqueSpecificationStringsSchema,
  acceptanceCriteria: uniqueSpecificationStringsSchema,
  dependencies: delegationDependenciesSchema,
  handoffContext: Schema.optional(sessionInputTextSchema),
  resourceReferences: uniqueSpecificationStringsSchema,
})

export const spawnCommandSchema = Schema.Struct({
  operation: Schema.Literal('spawn'),
  parentSessionId: sessionInputIdSchema,
  expectedParentRunId: sessionInputIdSchema,
  /** A manual title; without one the Worker is titled from its objective. */
  title: Schema.optional(sessionTitleSchema),
  workspace: Schema.optional(spawnWorkspaceSchema),
  specialization: Schema.optional(specializationSchema),
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  interactionTimeoutMs: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, MAX_NODE_TIMER_DELAY_MS)),
  ),
  attachmentIds: Schema.optional(sessionAttachmentIdsSchema),
  delegation: delegationSpecificationSchema,
})

export const forkCommandSchema = Schema.Struct({
  operation: Schema.Literal('fork'),
  sourceSessionId: sessionInputIdSchema,
  targetNodeId: Schema.optional(sessionInputIdSchema),
  position: Schema.optional(Schema.Literal('before', 'at')),
  title: Schema.optional(sessionTitleSchema),
  workspace: Schema.optional(forkWorkspaceSchema),
})

export const sessionLifecycleCommandSchema = Schema.Union(
  createCommandSchema,
  forkCommandSchema,
  launchCommandSchema,
  spawnCommandSchema,
)

export const sessionLifecycleRequestSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_LIFECYCLE_CONTRACT_VERSION),
  requestId: sessionInputIdSchema,
  idempotencyKey: sessionInputIdSchema,
  command: sessionLifecycleCommandSchema,
})

const createdRootSchema = Schema.Struct({
  operation: Schema.Literal('create'),
  effect: Schema.Literal('created-root'),
  sessionId: Schema.String,
  workspaceId: Schema.String,
})

const launchedRootSchema = Schema.Struct({
  operation: Schema.Literal('launch'),
  effect: Schema.Literal('launched-root'),
  sessionId: Schema.String,
  runId: Schema.String,
  workspaceId: Schema.String,
})

const forkedSessionSchema = Schema.Struct({
  operation: Schema.Literal('fork'),
  effect: Schema.Literal('forked-session'),
  sessionId: Schema.String,
  sourceSessionId: Schema.String,
  sourceNodeId: Schema.String,
  position: Schema.Literal('before', 'at'),
  workspaceId: Schema.String,
  editorText: Schema.optional(Schema.String),
})

const spawnedWorkerSchema = Schema.Struct({
  operation: Schema.Literal('spawn'),
  effect: Schema.Literal('spawned-worker'),
  sessionId: Schema.String,
  runId: Schema.String,
  workspaceId: Schema.String,
  parentSessionId: Schema.String,
  parentRunId: Schema.String,
  hiveRootSessionId: Schema.String,
  depth: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  delegationId: Schema.String,
  derivedGrantId: Schema.String,
})

const rejectedSchema = Schema.Struct({
  operation: Schema.Literal(...SESSION_LIFECYCLE_OPERATIONS),
  effect: Schema.Literal('rejected'),
  code: Schema.String,
  /** The kind of refusal, from the Session Host's refusal table (ADR 0063). */
  kind: Schema.Literal(...SESSION_HOST_ERROR_KINDS),
  retryable: Schema.Boolean,
  parentConcurrencyLimit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  parentRunningChildren: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  /** The Host's ceiling on Runs of agents' work; it never refuses a Run the person starts. */
  hostRunCeiling: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  /** Active Runs of agents' work across the Host when the request was refused. */
  hostActiveRuns: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
})

export const sessionLifecycleOutcomeSchema = Schema.Union(
  createdRootSchema,
  forkedSessionSchema,
  launchedRootSchema,
  spawnedWorkerSchema,
  rejectedSchema,
)

export const sessionLifecycleResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_LIFECYCLE_CONTRACT_VERSION),
  requestId: Schema.String,
  idempotencyKey: Schema.String,
  replayed: Schema.Boolean,
  outcome: sessionLifecycleOutcomeSchema,
})

export function decodeSessionLifecycleRequest(value: unknown) {
  return decodeUnknownExactOrThrow(sessionLifecycleRequestSchema, value)
}

export function decodeSessionLifecycleResponse(value: unknown) {
  return decodeUnknownExactOrThrow(sessionLifecycleResponseSchema, value)
}

export function decodeSessionLifecycleOutcome(value: unknown) {
  return decodeUnknownExactOrThrow(sessionLifecycleOutcomeSchema, value)
}
