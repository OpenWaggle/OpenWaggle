import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import type {
  SessionLifecycleOutcome,
  SessionLifecycleRequest,
  SessionLifecycleResponse,
} from '@shared/types/session-lifecycle'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import { SESSION_QUERY_MAX_PATH_LENGTH } from '@shared/types/session-query'
import { THINKING_LEVELS } from '@shared/types/settings'

const projectPathSchema = Schema.String.pipe(Schema.maxLength(SESSION_QUERY_MAX_PATH_LENGTH))

const specializationSchema = Schema.Struct({
  modelId: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  agentDefinitionName: Schema.optional(Schema.String),
})

const newWorktreeSchema = Schema.Struct({
  mode: Schema.Literal('new-worktree'),
  baseRef: Schema.optional(Schema.String),
  startFromOrigin: Schema.optional(Schema.Boolean),
})

const launchWorkspaceSchema = Schema.Union(
  Schema.Struct({ mode: Schema.Literal('current') }),
  Schema.Struct({ mode: Schema.Literal('local') }),
  newWorktreeSchema,
  Schema.Struct({ mode: Schema.Literal('existing'), workspaceId: Schema.String }),
)

const spawnWorkspaceSchema = Schema.Union(
  Schema.Struct({ mode: Schema.Literal('share-parent') }),
  Schema.Struct({ mode: Schema.Literal('local') }),
  newWorktreeSchema,
)

const forkWorkspaceSchema = Schema.Union(
  Schema.Struct({ mode: Schema.Literal('share-source') }),
  Schema.Struct({ mode: Schema.Literal('local') }),
  newWorktreeSchema,
  Schema.Struct({ mode: Schema.Literal('existing'), workspaceId: Schema.String }),
)

const createCommandSchema = Schema.Struct({
  operation: Schema.Literal('create'),
  projectPath: projectPathSchema,
  title: Schema.optional(Schema.String),
  workspace: Schema.optional(launchWorkspaceSchema),
  specialization: Schema.optional(specializationSchema),
})

const launchCommandSchema = Schema.Struct({
  operation: Schema.Literal('launch'),
  projectPath: projectPathSchema,
  title: Schema.optional(Schema.String),
  workspace: Schema.optional(launchWorkspaceSchema),
  specialization: Schema.optional(specializationSchema),
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  objective: Schema.String,
  attachmentIds: Schema.Array(Schema.String),
  interactionTimeoutMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
})

export const delegationSpecificationSchema = Schema.Struct({
  objective: Schema.String,
  deliverables: Schema.Array(Schema.String),
  acceptanceCriteria: Schema.Array(Schema.String),
  dependencies: Schema.Array(
    Schema.Struct({
      delegationId: Schema.String,
      requiredState: Schema.Literal('ready_for_review', 'accepted'),
    }),
  ),
  handoffContext: Schema.optional(Schema.String),
  resourceReferences: Schema.Array(Schema.String),
})

const spawnCommandSchema = Schema.Struct({
  operation: Schema.Literal('spawn'),
  parentSessionId: Schema.String,
  expectedParentRunId: Schema.String,
  workspace: Schema.optional(spawnWorkspaceSchema),
  specialization: Schema.optional(specializationSchema),
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  interactionTimeoutMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  attachmentIds: Schema.optional(Schema.Array(Schema.String)),
  delegation: delegationSpecificationSchema,
})

const forkCommandSchema = Schema.Struct({
  operation: Schema.Literal('fork'),
  sourceSessionId: Schema.String,
  targetNodeId: Schema.optional(Schema.String),
  position: Schema.optional(Schema.Literal('before', 'at')),
  title: Schema.optional(Schema.String),
  workspace: Schema.optional(forkWorkspaceSchema),
})

export const sessionLifecycleRequestSchema: Schema.Schema<SessionLifecycleRequest> = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_LIFECYCLE_CONTRACT_VERSION),
  requestId: Schema.String,
  idempotencyKey: Schema.String,
  command: Schema.Union(
    createCommandSchema,
    forkCommandSchema,
    launchCommandSchema,
    spawnCommandSchema,
  ),
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
  operation: Schema.Literal('create', 'fork', 'launch', 'spawn'),
  effect: Schema.Literal('rejected'),
  code: Schema.String,
  retryable: Schema.Boolean,
  parentConcurrencyLimit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  parentRunningChildren: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  hostRunCeiling: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  hostActiveRuns: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
})

export const sessionLifecycleOutcomeSchema: Schema.Schema<SessionLifecycleOutcome> = Schema.Union(
  createdRootSchema,
  forkedSessionSchema,
  launchedRootSchema,
  spawnedWorkerSchema,
  rejectedSchema,
)

export const sessionLifecycleResponseSchema: Schema.Schema<SessionLifecycleResponse> =
  Schema.Struct({
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
