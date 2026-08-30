import type { AgentSendPayload, HydratedAttachment, Message } from '@shared/types/agent'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionCapability } from '@shared/types/session-capability'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { PeerAgentReportContext } from '../../ports/agent-kernel-service'
import type {
  PendingDelegationSpecificationUpdate,
  PendingSessionOrchestrationUpdate,
} from '../../ports/session-orchestration-update-repository'

export interface AgentRunInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: AgentSendPayload
  readonly hydratedAttachments?: readonly HydratedAttachment[]
  readonly model: SupportedModelId
  readonly runAuthorizationOverride?: AgentAuthorizationMode
  readonly authorityCallerId?: string
  readonly agentInstructions?: string
  readonly sessionIdentityContext?: string
  readonly peerAgentReports?: readonly PeerAgentReportContext[]
  readonly onPeerAgentReportsDelivered?: (reportIds: readonly string[]) => void
  readonly orchestrationUpdates?: readonly PendingSessionOrchestrationUpdate[]
  readonly onOrchestrationUpdatesDelivered?: (updateIds: readonly string[]) => void
  readonly delegationSpecificationUpdates?: readonly PendingDelegationSpecificationUpdate[]
  readonly onDelegationSpecificationUpdatesDelivered?: (updateIds: readonly string[]) => void
  readonly toolAllowlist?: readonly string[]
  readonly skillAllowlist?: readonly string[]
  readonly mcpServerAllowlist?: readonly string[]
  readonly sessionCapabilities?: readonly SessionCapability[]
  readonly modelMultiAgentEnabled?: boolean
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent) => void
  readonly onWorktreeLaunch?: (progress: WorktreeLaunchProgress) => void
  readonly onTitleAssigned?: (title: string) => void
}

interface AgentRunResultBase {
  readonly assignedTitle?: string
}

export type AgentRunResult =
  | (AgentRunResultBase & {
      readonly outcome: 'success'
      readonly newMessages: readonly Message[]
    })
  | (AgentRunResultBase & { readonly outcome: 'aborted' })
  | (AgentRunResultBase & {
      readonly outcome: 'invalid-model'
      readonly message: string
      readonly code: string
    })
  | (AgentRunResultBase & {
      readonly outcome: 'not-found'
      readonly message: string
      readonly code: string
    })
  | (AgentRunResultBase & {
      readonly outcome: 'error'
      readonly message: string
      readonly code: string
      readonly transportEmitted?: boolean
    })

export interface ActiveRunIdentity {
  readonly sessionId: SessionId
  readonly runId: string
}
