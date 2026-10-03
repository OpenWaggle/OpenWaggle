import type { Message } from '@shared/types/agent'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { AgentKernelRunInput } from './agent-kernel-service'

/**
 * What an agent-requested Waggle inherits from the classic Run that requested it: its authorization
 * mode and caller, instructions, and allowlists. Without them the Waggle ran under the Session's own
 * mode, so an ask-for-approval caller's classic Run could hand off to a yolo Waggle.
 */
export type RequestedWaggleAuthority = Pick<
  AgentKernelRunInput,
  | 'runAuthorizationOverride'
  | 'authorityCallerId'
  | 'agentInstructions'
  | 'sessionIdentityContext'
  | 'toolAllowlist'
  | 'skillAllowlist'
  | 'mcpServerAllowlist'
  | 'sessionCapabilities'
  | 'modelMultiAgentEnabled'
>

export interface AgentRequestedWaggleServiceShape {
  readonly runIfRequested: (input: {
    readonly sessionId: SessionId
    readonly runId: string
    readonly messages: readonly Message[]
    readonly model: SupportedModelId
    readonly controller: AbortController
    readonly authority?: Partial<RequestedWaggleAuthority>
  }) => Effect.Effect<boolean, Error>
}

export class AgentRequestedWaggleService extends Context.Tag(
  '@openwaggle/AgentRequestedWaggleService',
)<AgentRequestedWaggleService, AgentRequestedWaggleServiceShape>() {}
