import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { createLogger } from '../../logger'

const logger = createLogger('workspace-preparation')

/** Return the durable start receipt while the Host retains the execution and its workspace fence. */
export function acknowledgePreparationStart(
  run: (onStarted: (state: WorkspacePreparation) => void) => Promise<WorkspacePreparation>,
) {
  const receipt = Promise.withResolvers<WorkspacePreparation>()
  // run owns its lifetime independently of the UI request. Its rejection is always observed.
  void run(receipt.resolve).then(receipt.resolve, (error: unknown) => {
    logger.error('Preparation execution failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    receipt.reject(error)
  })
  return receipt.promise
}
