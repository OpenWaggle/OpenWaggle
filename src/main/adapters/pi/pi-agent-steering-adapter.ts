import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { steerPiLiveRun } from './agent-kernel/pi-live-run-registry'
import {
  forgetUndeliveredPiSteers,
  readUndeliveredPiSteers,
} from './agent-kernel/pi-steer-delivery-ledger'

export const PiAgentSteeringServiceLive = Layer.succeed(AgentSteeringService, {
  steer: (input) =>
    Effect.tryPromise({
      try: () => steerPiLiveRun(input),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  readUndelivered: (runId) => Effect.sync(() => readUndeliveredPiSteers(runId)),
  forgetUndelivered: (runId) => Effect.sync(() => forgetUndeliveredPiSteers(runId)),
})
