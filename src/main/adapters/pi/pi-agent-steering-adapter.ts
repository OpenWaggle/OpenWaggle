import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { steerPiLiveRun } from './agent-kernel/pi-live-run-registry'

export const PiAgentSteeringServiceLive = Layer.succeed(AgentSteeringService, {
  steer: (input) =>
    Effect.tryPromise({
      try: () => steerPiLiveRun(input),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
})
