import type { Message } from '@shared/types/agent'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { ThinkingLevel } from '@shared/types/settings'
import { Context, type Effect } from 'effect'

export interface AgentRequestedWaggleServiceShape {
  readonly runIfRequested: (input: {
    readonly sessionId: SessionId
    readonly runId: string
    readonly messages: readonly Message[]
    readonly model: SupportedModelId
    readonly thinkingLevel: ThinkingLevel
    readonly controller: AbortController
  }) => Effect.Effect<boolean, Error>
}

export class AgentRequestedWaggleService extends Context.Tag(
  '@openwaggle/AgentRequestedWaggleService',
)<AgentRequestedWaggleService, AgentRequestedWaggleServiceShape>() {}
