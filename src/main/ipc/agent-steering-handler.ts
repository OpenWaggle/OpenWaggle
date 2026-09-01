import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { hydrateAgentRunPayload } from '../application/agent-run/kernel'
import { activeRuns, activeWaggleRuns } from './active-agent-runs'
import { typedHandle } from './typed-ipc'

export function registerAgentSteeringHandler() {
  typedHandle('agent:steer', (_event, sessionId: SessionId, payload: AgentSendPayload) =>
    Effect.gen(function* () {
      const validatedPayload = toAgentSendPayload(
        decodeUnknownOrThrow(agentSendPayloadSchema, payload),
      )
      const classicRun = activeRuns.get(sessionId)
      const activeRun = classicRun ?? activeWaggleRuns.get(sessionId)
      if (!activeRun) {
        return yield* Effect.fail(new Error('The active agent run is not ready for steering.'))
      }
      const isCurrentRun = () =>
        classicRun
          ? activeRuns.isCurrent(sessionId, activeRun.controller)
          : activeWaggleRuns.isCurrent(sessionId, activeRun.controller)
      const queuedSteer = activeRun.metadata.steerTailRef.current
        .catch(() => undefined)
        .then(async () => {
          if (!isCurrentRun()) {
            throw new Error('The active agent run changed before steering was delivered.')
          }
          const hydratedPayload = await Effect.runPromise(hydrateAgentRunPayload(validatedPayload))
          if (activeRun.controller.signal.aborted || !isCurrentRun()) {
            throw new Error('The active agent run ended before steering was delivered.')
          }
          const control = activeRun.metadata.controlRef.current
          if (!control) throw new Error('The active agent run is not ready for steering.')
          await control.steer(hydratedPayload)
        })
      activeRun.metadata.steerTailRef.current = queuedSteer.catch(() => undefined)
      yield* Effect.promise(() => queuedSteer)
      return { preserved: true }
    }),
  )
}
