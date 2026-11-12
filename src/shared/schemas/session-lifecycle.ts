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
  modelId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  thinkingLevel: Schema.optionalWith(Schema.Literal(...THINKING_LEVELS), { exact: true }),
  agentDefinitionName: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
})

const newWorktreeSchema = Schema.Struct({
  mode: Schema.Literal('new-worktree'),
  baseRef: Schema.optionalWith(sessionInputItemTextSchema, { exact: true }),
  startFromOrigin: Schema.optionalWith(Schema.Boolean, { exact: true }),
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
  title: Schema.optionalWith(sessionTitleSchema, { exact: true }),
  workspace: Schema.optionalWith(launchWorkspaceSchema, { exact: true }),
  specialization: Schema.optionalWith(specializationSchema, { exact: true }),
})

export const launchCommandSchema = Schema.Struct({
  operation: Schema.Literal('launch'),
  projectPath: projectPathSchema,
  title: Schema.optionalWith(sessionTitleSchema, { exact: true }),
  workspace: Schema.optionalWith(launchWorkspaceSchema, { exact: true }),
  specialization: Schema.optionalWith(specializationSchema, { exact: true }),
  runAuthorizationOverride: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_MODES), {
    exact: true,
  }),
  objective: sessionInputTextSchema,
  attachmentIds: sessionAttachmentIdsSchema,
  interactionTimeoutMs: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(0, MAX_NODE_TIMER_DELAY_MS)),
    { exact: true },
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
  handoffContext: Schema.optionalWith(sessionInputTextSchema, { exact: true }),
  resourceReferences: uniqueSpecificationStringsSchema,
})

export const spawnCommandSchema = Schema.Struct({
  operation: Schema.Literal('spawn'),
  parentSessionId: sessionInputIdSchema,
  expectedParentRunId: sessionInputIdSchema,
  /** A manual title; without one the Worker is titled from its objective. */
  title: Schema.optionalWith(sessionTitleSchema, { exact: true }),
  workspace: Schema.optionalWith(spawnWorkspaceSchema, { exact: true }),
  specialization: Schema.optionalWith(specializationSchema, { exact: true }),
  runAuthorizationOverride: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_MODES), {
    exact: true,
  }),
  interactionTimeoutMs: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(0, MAX_NODE_TIMER_DELAY_MS)),
    { exact: true },
  ),
  attachmentIds: Schema.optionalWith(sessionAttachmentIdsSchema, { exact: true }),
  delegation: delegationSpecificationSchema,
})

export const forkCommandSchema = Schema.Struct({
  operation: Schema.Literal('fork'),
  sourceSessionId: sessionInputIdSchema,
  targetNodeId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  position: Schema.optionalWith(Schema.Literal('before', 'at'), { exact: true }),
  title: Schema.optionalWith(sessionTitleSchema, { exact: true }),
  workspace: Schema.optionalWith(forkWorkspaceSchema, { exact: true }),
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
  editorText: Schema.optionalWith(Schema.String, { exact: true }),
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
  parentConcurrencyLimit: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.positive()), {
    exact: true,
  }),
  parentRunningChildren: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    { exact: true },
  ),
  /** The Host's ceiling on Runs of agents' work; it never refuses a Run the person starts. */
  hostRunCeiling: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.positive()), {
    exact: true,
  }),
  /** Active Runs of agents' work across the Host when the request was refused. */
  hostActiveRuns: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.nonNegative()), {
    exact: true,
  }),
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
