import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { interruptExactSessionRun } from '../application/active-session-runs'
import { AgentRunInterruptionService } from '../ports/agent-run-interruption-service'

export const LiveAgentRunInterruptionService = Layer.succeed(AgentRunInterruptionService, {
  interrupt: (input) =>
    Effect.promise(() => interruptExactSessionRun(SessionId(input.sessionId), input.runId)).pipe(
      Effect.map((interrupted) =>
        interrupted
          ? ({ accepted: true } as const)
          : ({ accepted: false, code: 'run_not_live' } as const),
      ),
    ),
})
