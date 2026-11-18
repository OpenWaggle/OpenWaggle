import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { AgentSteeringService } from '../../ports/agent-steering-service'

/** A steering runtime whose Runs never leave Undelivered steering messages behind. */
export const noUndeliveredSteers = {
  readUndelivered: () => Effect.succeed([]),
  forgetUndelivered: () => Effect.void,
} as const

/** For tests that settle Runs but never steer one. */
export const NoSteeringLayer = Layer.succeed(AgentSteeringService, {
  steer: () => Effect.die(new Error('This test does not steer Runs.')),
  ...noUndeliveredSteers,
})
