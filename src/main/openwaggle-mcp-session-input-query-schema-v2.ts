import {
  SESSION_EXPORT_FORMATS,
  SESSION_EXPORT_OPERATION_STATUSES,
} from '@shared/types/session-export-operation'
import { SESSION_QUERY_WAIT_TARGET_LIMIT } from '@shared/types/session-query'
import { z } from 'zod'
import {
  booleanFlag,
  boundedCursor,
  catalogScope,
  discoveryLimit,
  finiteUniqueEnumArray,
  idempotency,
  interactionResponseSchema,
  interactionTimeout,
  newWorktreeFields,
  operationSchema,
  revision,
  runAuthorization,
  searchMode,
  specialization,
  timeout,
  transcriptLimit,
} from './openwaggle-mcp-session-input-schema-shared-v2'
import {
  mcpSessionAttachmentPathsSchemaV2,
  mcpSessionIdSchemaV2,
  mcpSessionItemArraySchemaV2,
  mcpSessionPathSchemaV2,
  mcpSessionResourceReferencesSchemaV2,
  mcpSessionTextSchemaV2,
  mcpSessionTitleSchemaV2,
} from './openwaggle-mcp-session-resource-envelope-v2'

const sessionExportManifestSchemaV2 = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: mcpSessionIdSchemaV2,
    title: mcpSessionTitleSchemaV2,
    branchScope: z.enum(['active-branch', 'tree']),
    activeBranchId: mcpSessionIdSchemaV2.nullable(),
    selectedBranchId: mcpSessionIdSchemaV2.nullable(),
    snapshot: z
      .object({
        nodeHighWaterMark: revision,
        stateRevision: revision,
        queueRevision: revision,
        capturedAt: revision,
        nodeMutationRevision: revision.optional(),
        selectedHeadNodeId: mcpSessionIdSchemaV2.optional(),
      })
      .strict(),
    activeRunId: mcpSessionIdSchemaV2.nullable(),
    activeTurnIncomplete: z.boolean(),
    queue: z
      .object({
        state: z.enum(['running', 'paused']),
        pendingCount: revision,
        bodyScope: z.enum(['included', 'omitted-by-choice']),
        omittedBodyCount: revision,
        items: z.array(
          z
            .object({
              followUpId: mcpSessionIdSchemaV2,
              position: revision,
              createdAt: revision,
              deliveryState: z.enum(['pending', 'needs_attention']),
              attentionReason: z
                .enum(['authorization_ceiling_changed', 'profile_revoked', 'authority_changed'])
                .optional(),
              intent: z.unknown().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()

export const mcpSessionQueryLifecycleOperationSchemasV2 = [
  operationSchema('list', {
    projectPath: mcpSessionPathSchemaV2.optional(),
    catalogScope: catalogScope.optional(),
    archived: booleanFlag.optional(),
    limit: discoveryLimit.optional(),
    cursor: boundedCursor.optional(),
  }),
  operationSchema('search', {
    message: mcpSessionTextSchemaV2.optional(),
    projectPath: mcpSessionPathSchemaV2.optional(),
    catalogScope: catalogScope.optional(),
    limit: discoveryLimit.optional(),
    cursor: boundedCursor.optional(),
    fullTranscript: booleanFlag.optional(),
    includeArchived: booleanFlag.optional(),
    searchMode: searchMode.optional(),
    requireFresh: booleanFlag.optional(),
    timeoutMs: timeout.optional(),
  }),
  operationSchema('read', { sessionId: mcpSessionIdSchemaV2.optional() }),
  operationSchema('turns', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    limit: discoveryLimit.optional(),
    cursor: boundedCursor.optional(),
  }),
  operationSchema('items', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    runId: mcpSessionIdSchemaV2.optional(),
    branchScope: z.enum(['active-branch', 'tree']).optional(),
    branchId: mcpSessionIdSchemaV2.optional(),
    afterCreatedOrder: revision.optional(),
    throughCreatedOrder: revision.optional(),
    snapshotHeadNodeId: mcpSessionIdSchemaV2.optional(),
    limit: transcriptLimit.optional(),
  }),
  operationSchema('status', { sessionId: mcpSessionIdSchemaV2.optional() }),
  operationSchema('export', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    exportFormat: z.enum(SESSION_EXPORT_FORMATS).optional(),
    branchScope: z.enum(['active-branch', 'tree']).optional(),
    branchId: mcpSessionIdSchemaV2.optional(),
    includeQueueBodies: booleanFlag.optional(),
    limit: transcriptLimit.optional(),
    afterCreatedOrder: revision.optional(),
    snapshotManifest: sessionExportManifestSchemaV2.optional(),
  }),
  operationSchema('export-create', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    destinationPath: mcpSessionPathSchemaV2.optional(),
    exportFormat: z.enum(SESSION_EXPORT_FORMATS).optional(),
    branchScope: z.enum(['active-branch', 'tree']).optional(),
    branchId: mcpSessionIdSchemaV2.optional(),
    includeQueueBodies: booleanFlag.optional(),
    overwriteExisting: booleanFlag.optional(),
    exportResources: mcpSessionResourceReferencesSchemaV2.optional(),
    ...idempotency,
  }),
  operationSchema('export-cancel', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    exportOperationId: mcpSessionIdSchemaV2.optional(),
    ...idempotency,
  }),
  operationSchema('exports-list', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    exportStatuses: finiteUniqueEnumArray(SESSION_EXPORT_OPERATION_STATUSES).optional(),
    limit: discoveryLimit.optional(),
    cursor: boundedCursor.optional(),
    includeQueueBodies: booleanFlag.optional(),
  }),
  operationSchema('exports-read', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    exportOperationId: mcpSessionIdSchemaV2.optional(),
    includeQueueBodies: booleanFlag.optional(),
  }),
  operationSchema('exports-wait', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    exportOperationId: mcpSessionIdSchemaV2.optional(),
    timeoutMs: timeout.optional(),
    includeQueueBodies: booleanFlag.optional(),
  }),
  operationSchema('requests-list', { sessionId: mcpSessionIdSchemaV2.optional() }),
  operationSchema('request-respond', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    runId: mcpSessionIdSchemaV2.optional(),
    interactionId: mcpSessionIdSchemaV2.optional(),
    interactionResponse: interactionResponseSchema.optional(),
    ...idempotency,
  }),
  operationSchema('approval-respond', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    runId: mcpSessionIdSchemaV2.optional(),
    interactionId: mcpSessionIdSchemaV2.optional(),
    interactionResponse: interactionResponseSchema.optional(),
    ...idempotency,
  }),
  operationSchema('authorization-set', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    authorizationMode: z.enum(['inherit', 'ask-for-approval', 'yolo']).optional(),
    ...idempotency,
  }),
  operationSchema('rename', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    title: mcpSessionTitleSchemaV2.optional(),
    ...idempotency,
  }),
  operationSchema('archive', { sessionId: mcpSessionIdSchemaV2.optional(), ...idempotency }),
  operationSchema('unarchive', { sessionId: mcpSessionIdSchemaV2.optional(), ...idempotency }),
  operationSchema('handoff', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    workspace: z.enum(['local', 'existing', 'new-worktree']).optional(),
    workspaceId: mcpSessionIdSchemaV2.optional(),
    ...newWorktreeFields,
    ...idempotency,
  }),
  operationSchema('wait', {
    sessionIds: z.array(mcpSessionIdSchemaV2).max(SESSION_QUERY_WAIT_TARGET_LIMIT).optional(),
    sessionId: mcpSessionIdSchemaV2.optional(),
    condition: z
      .enum(['idle', 'queue-empty', 'state-revision-after', 'report-delivered', 'correlated-reply'])
      .optional(),
    afterStateRevision: revision.optional(),
    reportId: mcpSessionIdSchemaV2.optional(),
    correlationId: mcpSessionIdSchemaV2.optional(),
    timeoutMs: timeout.optional(),
  }),
  operationSchema('create', {
    projectPath: mcpSessionPathSchemaV2.optional(),
    title: mcpSessionTitleSchemaV2.optional(),
    workspace: z.enum(['current', 'local', 'existing', 'new-worktree']).optional(),
    workspaceId: mcpSessionIdSchemaV2.optional(),
    ...newWorktreeFields,
    ...specialization,
    ...idempotency,
  }),
  operationSchema('fork', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    targetNodeId: mcpSessionIdSchemaV2.optional(),
    forkPosition: z.enum(['before', 'at']).optional(),
    title: mcpSessionTitleSchemaV2.optional(),
    workspace: z.enum(['share-source', 'local', 'existing', 'new-worktree']).optional(),
    workspaceId: mcpSessionIdSchemaV2.optional(),
    ...newWorktreeFields,
    ...idempotency,
  }),
  operationSchema('launch', {
    projectPath: mcpSessionPathSchemaV2.optional(),
    objective: mcpSessionTextSchemaV2.optional(),
    attachmentPaths: mcpSessionAttachmentPathsSchemaV2.optional(),
    title: mcpSessionTitleSchemaV2.optional(),
    workspace: z.enum(['current', 'local', 'existing', 'new-worktree']).optional(),
    workspaceId: mcpSessionIdSchemaV2.optional(),
    ...newWorktreeFields,
    ...specialization,
    ...runAuthorization,
    interactionTimeoutMs: interactionTimeout.optional(),
    ...idempotency,
  }),
  operationSchema('spawn', {
    sessionId: mcpSessionIdSchemaV2.optional(),
    expectedRunId: mcpSessionIdSchemaV2.optional(),
    objective: mcpSessionTextSchemaV2.optional(),
    attachmentPaths: mcpSessionAttachmentPathsSchemaV2.optional(),
    workspace: z.enum(['share-parent', 'local', 'new-worktree']).optional(),
    ...newWorktreeFields,
    ...specialization,
    deliverables: mcpSessionItemArraySchemaV2.optional(),
    acceptanceCriteria: mcpSessionItemArraySchemaV2.optional(),
    resourceReferences: mcpSessionResourceReferencesSchemaV2.optional(),
    ...runAuthorization,
    interactionTimeoutMs: interactionTimeout.optional(),
    ...idempotency,
  }),
] as const
