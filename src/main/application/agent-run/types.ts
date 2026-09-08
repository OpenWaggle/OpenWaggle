import type { AgentSendPayload, Message } from '@shared/types/agent'
import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { AgentKernelRunControl } from '../../ports/agent-kernel-service'

export interface AgentRunInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: AgentSendPayload
  readonly model: SupportedModelId
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent) => void
  readonly onControlAvailable?: (control: AgentKernelRunControl) => void
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
