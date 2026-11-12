import type { SessionExportManifest } from '@shared/types/session-export'
import type {
  SESSION_EXPORT_FORMATS,
  SESSION_EXPORT_OPERATION_STATUSES,
} from '@shared/types/session-export-operation'
import type { z } from 'zod'
import type { mcpDelegationSpecificationSchemaV2 } from './openwaggle-mcp-delegation-specification-v2'
import type { sessionClaimSchemaV2 } from './openwaggle-mcp-session-claim-schema-v2'
import type {
  delegationStates,
  evidenceSchema,
  interactionResponseSchema,
  revisedSpecificationSchema,
} from './openwaggle-mcp-session-input-schema-shared-v2'
import type { OPENWAGGLE_MCP_SESSION_OPERATIONS_V2 } from './openwaggle-mcp-session-operations-v2'

export interface SessionToolInputV2 {
  readonly operation: (typeof OPENWAGGLE_MCP_SESSION_OPERATIONS_V2)[number]
  readonly sessionId?: string | undefined
  readonly sessionIds?: readonly string[] | undefined
  readonly projectPath?: string | undefined
  readonly objective?: string | undefined
  readonly message?: string | undefined
  readonly title?: string | undefined
  readonly expectedRunId?: string | undefined
  readonly runId?: string | undefined
  readonly interactionId?: string | undefined
  readonly interactionResponse?: z.infer<typeof interactionResponseSchema> | undefined
  readonly followUpId?: string | undefined
  readonly followUpIds?: readonly string[] | undefined
  readonly queueRevision?: number | undefined
  readonly workspace?:
    | 'current'
    | 'local'
    | 'existing'
    | 'new-worktree'
    | 'share-parent'
    | 'share-source'
    | undefined
  readonly workspaceId?: string | undefined
  readonly baseRef?: string | undefined
  readonly startFromOrigin?: boolean | undefined
  readonly targetNodeId?: string | undefined
  readonly forkPosition?: 'before' | 'at' | undefined
  readonly agent?: string | undefined
  readonly model?: string | undefined
  readonly thinking?: string | undefined
  readonly deliverables?: readonly string[] | undefined
  readonly acceptanceCriteria?: readonly string[] | undefined
  readonly resourceReferences?: readonly string[] | undefined
  readonly attachmentPaths?: readonly string[] | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  readonly afterCreatedOrder?: number | undefined
  readonly throughCreatedOrder?: number | undefined
  readonly snapshotHeadNodeId?: string | undefined
  readonly snapshotManifest?: SessionExportManifest | undefined
  readonly condition?:
    | 'idle'
    | 'queue-empty'
    | 'state-revision-after'
    | 'report-delivered'
    | 'correlated-reply'
    | undefined
  readonly afterStateRevision?: number | undefined
  readonly reportId?: string | undefined
  readonly correlationId?: string | undefined
  readonly timeoutMs?: number | undefined
  readonly interactionTimeoutMs?: number | undefined
  readonly fullTranscript?: boolean | undefined
  readonly includeArchived?: boolean | undefined
  readonly includeBodies?: boolean | undefined
  readonly includeQueueBodies?: boolean | undefined
  readonly branchScope?: 'active-branch' | 'tree' | undefined
  readonly branchId?: string | undefined
  readonly exportOperationId?: string | undefined
  readonly exportFormat?: (typeof SESSION_EXPORT_FORMATS)[number] | undefined
  readonly destinationPath?: string | undefined
  readonly overwriteExisting?: boolean | undefined
  readonly exportResources?: readonly string[] | undefined
  readonly exportStatuses?:
    | readonly (typeof SESSION_EXPORT_OPERATION_STATUSES)[number][]
    | undefined
  readonly searchMode?: 'hybrid' | 'lexical' | 'semantic' | undefined
  readonly requireFresh?: boolean | undefined
  readonly catalogScope?: 'current' | 'project' | 'all' | undefined
  readonly archived?: boolean | undefined
  readonly yolo?: boolean | undefined
  readonly runAuthorizationOverride?: 'inherit' | 'ask-for-approval' | 'yolo' | undefined
  readonly authorizationMode?: 'inherit' | 'ask-for-approval' | 'yolo' | undefined
  readonly idempotencyKey?: string | undefined
  readonly reportTarget?:
    | 'upstream'
    | 'queen'
    | 'session'
    | 'sessions'
    | 'worker-reference'
    | undefined
  readonly targetSessionIds?: readonly string[] | undefined
  readonly workerReference?: string | undefined
  readonly sourceRunId?: string | undefined
  readonly requestReply?: boolean | undefined
  readonly replyToReportId?: string | undefined
  readonly delegationId?: string | undefined
  readonly conflictId?: string | undefined
  readonly dependencyAction?: 'add' | 'remove' | undefined
  readonly dependencyDelegationId?: string | undefined
  readonly dependencyRequiredState?: 'ready_for_review' | 'accepted' | undefined
  readonly specificationRevision?: number | undefined
  readonly delegationSpecification?: z.infer<typeof mcpDelegationSpecificationSchemaV2> | undefined
  readonly proposalId?: string | undefined
  readonly conflictKinds?: readonly ('live-overlap' | 'merge-overlap')[] | undefined
  readonly conflictStatuses?:
    | readonly ('unacknowledged' | 'acknowledged' | 'resolved')[]
    | undefined
  readonly parentSessionId?: string | undefined
  readonly workerSessionId?: string | undefined
  readonly states?: readonly z.infer<typeof delegationStates>[number][] | undefined
  readonly delegationState?: 'working' | 'waiting' | 'needs_attention' | undefined
  readonly claims?: readonly z.infer<typeof sessionClaimSchemaV2>[] | undefined
  readonly submissionRevision?: number | undefined
  readonly verificationOutcome?: 'passed' | 'failed' | 'inconclusive' | undefined
  readonly feedback?: string | undefined
  readonly reason?: string | undefined
  readonly evidence?: readonly z.infer<typeof evidenceSchema>[] | undefined
  readonly revisedSpecification?: z.infer<typeof revisedSpecificationSchema> | undefined
}
