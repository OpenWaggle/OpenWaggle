import type { ConversationId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { cancelActiveOrchestrationRun } from '../orchestration/active-runs'
import { orchestrationRunRepository } from '../orchestration/run-repository'
import { typedHandle } from './typed-ipc'

export function registerOrchestrationHandlers(): void {
  typedHandle('orchestration:get-run', (_event, runId: string) =>
    Effect.promise(() => orchestrationRunRepository.get(runId)),
  )

  typedHandle('orchestration:list-runs', (_event, conversationId?: ConversationId) =>
    Effect.promise(() => orchestrationRunRepository.list(conversationId)),
  )

  typedHandle('orchestration:cancel-run', (_event, runId: string) =>
    Effect.gen(function* () {
      const cancelledActive = cancelActiveOrchestrationRun(runId)
      if (!cancelledActive) {
        yield* Effect.promise(() =>
          orchestrationRunRepository.markCancelled(runId, 'cancelled-by-user'),
        )
      }
    }),
  )
}
