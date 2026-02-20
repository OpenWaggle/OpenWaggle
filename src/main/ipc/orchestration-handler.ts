import type { ConversationId } from '@shared/types/brand'
import { cancelActiveOrchestrationRun } from '../orchestration/active-runs'
import { orchestrationRunRepository } from '../orchestration/run-repository'
import { typedHandle } from './typed-ipc'

export function registerOrchestrationHandlers(): void {
  typedHandle('orchestration:get-run', (_event, runId: string) => {
    return orchestrationRunRepository.get(runId)
  })

  typedHandle('orchestration:list-runs', (_event, conversationId?: ConversationId) => {
    return orchestrationRunRepository.list(conversationId)
  })

  typedHandle('orchestration:cancel-run', async (_event, runId: string) => {
    const cancelledActive = cancelActiveOrchestrationRun(runId)
    if (!cancelledActive) {
      await orchestrationRunRepository.markCancelled(runId, 'cancelled-by-user')
    }
  })
}
