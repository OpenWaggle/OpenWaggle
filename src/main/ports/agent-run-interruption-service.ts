import { Context, type Effect } from 'effect'

export interface AgentRunInterruptionInput {
  readonly sessionId: string
  readonly runId: string
}

export type AgentRunInterruptionResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly code: 'run_not_live' }

export interface AgentRunInterruptionServiceShape {
  readonly interrupt: (
    input: AgentRunInterruptionInput,
  ) => Effect.Effect<AgentRunInterruptionResult>
}

export class AgentRunInterruptionService extends Context.Tag(
  '@openwaggle/AgentRunInterruptionService',
)<AgentRunInterruptionService, AgentRunInterruptionServiceShape>() {}
