import type {
  AgentSteerDeliveryReceipt,
  HydratedAttachment,
  InlineVisualizationContext,
} from '@shared/types/agent'
import { Context, type Effect } from 'effect'
import type {
  SteeringDelivery,
  UndeliveredSteer,
} from '../domain/session-control/undelivered-steering'

export interface AgentSteeringInput {
  readonly runId: string
  readonly text: string
  readonly attachments: readonly HydratedAttachment[]
  readonly visualizationContext?: InlineVisualizationContext
  readonly requireDurableDelivery?: boolean
  /**
   * Where the steer came from. The runtime tracks incorporation for every steer that names one,
   * so a Run that ends without incorporating it reports it through `takeUndelivered`.
   */
  readonly delivery?: SteeringDelivery
}

export type AgentSteeringResult =
  | { readonly accepted: true; readonly receipt: AgentSteerDeliveryReceipt }
  | { readonly accepted: false; readonly code: 'run_not_live' | 'run_not_streaming' }

export interface AgentSteeringServiceShape {
  readonly steer: (input: AgentSteeringInput) => Effect.Effect<AgentSteeringResult, Error>
  /**
   * The steers an ended Run never started incorporating, in the order they were steered. Each
   * Run's list is handed out once; call it after the Run has ended.
   */
  readonly takeUndelivered: (runId: string) => Effect.Effect<readonly UndeliveredSteer[]>
}

export class AgentSteeringService extends Context.Tag('@openwaggle/AgentSteeringService')<
  AgentSteeringService,
  AgentSteeringServiceShape
>() {}
