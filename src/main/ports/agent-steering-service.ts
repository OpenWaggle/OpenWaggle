import type { HydratedAttachment, InlineVisualizationContext } from '@shared/types/agent'
import { Context, type Effect } from 'effect'

export interface AgentSteeringInput {
  readonly runId: string
  readonly text: string
  readonly attachments: readonly HydratedAttachment[]
  readonly visualizationContext?: InlineVisualizationContext
}

export type AgentSteeringResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly code: 'run_not_live' | 'run_not_streaming' }

export interface AgentSteeringServiceShape {
  readonly steer: (input: AgentSteeringInput) => Effect.Effect<AgentSteeringResult, Error>
}

export class AgentSteeringService extends Context.Tag('@openwaggle/AgentSteeringService')<
  AgentSteeringService,
  AgentSteeringServiceShape
>() {}
