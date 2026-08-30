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

export type SessionToolInputV2 = {
  readonly operation: (typeof OPENWAGGLE_MCP_SESSION_OPERATIONS_V2)[number]
  readonly sessionId?: string
  readonly sessionIds?: readonly string[]
  readonly projectPath?: string
  readonly objective?: string
  readonly message?: string
  readonly title?: string
  readonly expectedRunId?: string
  readonly runId?: string
  readonly interactionId?: string
  readonly interactionResponse?: z.infer<typeof interactionResponseSchema>
  readonly followUpId?: string
  readonly followUpIds?: readonly string[]
  readonly queueRevision?: number
  readonly workspace?:
    | 'current'
    | 'local'
    | 'existing'
    | 'new-worktree'
    | 'share-parent'
    | 'share-source'
  readonly workspaceId?: string
  readonly baseRef?: string
  readonly startFromOrigin?: boolean
  readonly targetNodeId?: string
  readonly forkPosition?: 'before' | 'at'
  readonly agent?: string
  readonly model?: string
  readonly thinking?: string
  readonly deliverables?: readonly string[]
  readonly acceptanceCriteria?: readonly string[]
  readonly resourceReferences?: readonly string[]
  readonly limit?: number
  readonly cursor?: string
  readonly afterCreatedOrder?: number
  readonly condition?: 'idle' | 'queue-empty' | 'state-revision-after'
  readonly afterStateRevision?: number
  readonly timeoutMs?: number
  readonly interactionTimeoutMs?: number
  readonly fullTranscript?: boolean
  readonly includeArchived?: boolean
  readonly includeBodies?: boolean
  readonly includeQueueBodies?: boolean
  readonly branchScope?: 'active-branch' | 'tree'
  readonly branchId?: string
  readonly exportOperationId?: string
  readonly exportFormat?: (typeof SESSION_EXPORT_FORMATS)[number]
  readonly destinationPath?: string
  readonly overwriteExisting?: boolean
  readonly exportResources?: readonly string[]
  readonly exportStatuses?: readonly (typeof SESSION_EXPORT_OPERATION_STATUSES)[number][]
  readonly searchMode?: 'hybrid' | 'lexical' | 'semantic'
  readonly requireFresh?: boolean
  readonly catalogScope?: 'current' | 'project' | 'all'
  readonly archived?: boolean
  readonly yolo?: boolean
  readonly runAuthorizationOverride?: 'inherit' | 'ask-for-approval' | 'yolo'
  readonly authorizationMode?: 'inherit' | 'ask-for-approval' | 'yolo'
  readonly idempotencyKey?: string
  readonly reportTarget?: 'upstream' | 'queen' | 'session' | 'sessions' | 'worker-reference'
  readonly targetSessionIds?: readonly string[]
  readonly workerReference?: string
  readonly sourceRunId?: string
  readonly requestReply?: boolean
  readonly replyToReportId?: string
  readonly delegationId?: string
  readonly conflictId?: string
  readonly dependencyAction?: 'add' | 'remove'
  readonly dependencyDelegationId?: string
  readonly dependencyRequiredState?: 'ready_for_review' | 'accepted'
  readonly specificationRevision?: number
  readonly delegationSpecification?: z.infer<typeof mcpDelegationSpecificationSchemaV2>
  readonly proposalId?: string
  readonly conflictKinds?: readonly ('live-overlap' | 'merge-overlap')[]
  readonly conflictStatuses?: readonly ('unacknowledged' | 'acknowledged' | 'resolved')[]
  readonly parentSessionId?: string
  readonly workerSessionId?: string
  readonly states?: readonly z.infer<typeof delegationStates>[number][]
  readonly delegationState?: 'working' | 'waiting' | 'needs_attention'
  readonly claims?: readonly z.infer<typeof sessionClaimSchemaV2>[]
  readonly submissionRevision?: number
  readonly verificationOutcome?: 'passed' | 'failed' | 'inconclusive'
  readonly feedback?: string
  readonly reason?: string
  readonly evidence?: readonly z.infer<typeof evidenceSchema>[]
  readonly revisedSpecification?: z.infer<typeof revisedSpecificationSchema>
}
