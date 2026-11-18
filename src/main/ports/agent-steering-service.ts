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
   * Where the steer came from. The runtime tracks incorporation for every steer, so a Run that
   * ends without incorporating it reports it through `readUndelivered`.
   */
  readonly delivery: SteeringDelivery
}

export type AgentSteeringResult =
  | { readonly accepted: true; readonly receipt: AgentSteerDeliveryReceipt }
  | {
      readonly accepted: false
      /**
       * `steering_capacity_reached`: the Run already holds as many direct steers as it could hand
       * back as Follow-ups if it stopped.
       */
      readonly code: 'run_not_live' | 'run_not_streaming' | 'steering_capacity_reached'
    }

export interface AgentSteeringServiceShape {
  readonly steer: (input: AgentSteeringInput) => Effect.Effect<AgentSteeringResult, Error>
  /**
   * The steers an ended Run never started incorporating, in the order they were steered. Call it
   * after the Run has ended; the list stays until `forgetUndelivered`, so a settlement that fails
   * can be retried with the same steers.
   */
  readonly readUndelivered: (runId: string) => Effect.Effect<readonly UndeliveredSteer[]>
  /** Drop an ended Run's steers once its settlement durably recorded them. */
  readonly forgetUndelivered: (runId: string) => Effect.Effect<void>
}

export class AgentSteeringService extends Context.Tag('@openwaggle/AgentSteeringService')<
  AgentSteeringService,
  AgentSteeringServiceShape
>() {}
