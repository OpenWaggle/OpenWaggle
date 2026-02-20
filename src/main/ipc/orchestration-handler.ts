import type { ConversationId } from '@shared/types/brand'
import { ipcMain } from 'electron'
import { cancelActiveOrchestrationRun } from '../orchestration/active-runs'
import { orchestrationRunRepository } from '../orchestration/run-repository'

export function registerOrchestrationHandlers(): void {
  ipcMain.handle('orchestration:get-run', (_event, runId: string) => {
    return orchestrationRunRepository.get(runId)
  })

  ipcMain.handle('orchestration:list-runs', (_event, conversationId?: ConversationId) => {
    return orchestrationRunRepository.list(conversationId)
  })

  ipcMain.handle('orchestration:cancel-run', async (_event, runId: string) => {
    const cancelledActive = cancelActiveOrchestrationRun(runId)
    if (!cancelledActive) {
      await orchestrationRunRepository.markCancelled(runId, 'cancelled-by-user')
    }
  })
}
