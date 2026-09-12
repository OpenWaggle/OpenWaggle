import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import { createLogger } from '../../../logger'

const logger = createLogger('project-setup-action-progress')

/** A progress-listener defect after terminal acceptance must not make dispatch retryable. */
export function reportAcceptedSetupActionProgress(input: {
  readonly sessionId: string
  readonly report?: (progress: WorktreeLaunchProgress) => void
  readonly progress: WorktreeLaunchProgress
}) {
  try {
    input.report?.(input.progress)
  } catch (error) {
    logger.warn('Accepted Setup action progress could not be reported', {
      sessionId: input.sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
