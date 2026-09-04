import type { WorkingPath } from '@shared/types/brand'
import type {
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStackedAction,
} from '@shared/types/git'
import type { RecordSessionCommitInput } from '@shared/types/session-resource'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('git')
const SHORT_COMMIT_HASH_LENGTH = 7

interface UseStackedGitActionsOptions {
  readonly workingPath: WorkingPath | null
  readonly onCompleted?: () => void
  readonly onCommitCreated?: (input: RecordSessionCommitInput) => void | Promise<void>
}

async function reportCreatedCommit(
  result: GitRunStackedActionResult,
  options: Partial<GitRunStackedActionOptions> | undefined,
  onCommitCreated: UseStackedGitActionsOptions['onCommitCreated'],
) {
  if (!result.commitHash || !onCommitCreated) return
  try {
    await onCommitCreated({
      commitHash: result.commitHash,
      title:
        options?.commitMessage?.trim() ||
        `Commit ${result.commitHash.slice(0, SHORT_COMMIT_HASH_LENGTH)}`,
    })
  } catch (error) {
    logger.warn('Could not record the created commit', {
      commitHash: result.commitHash,
      error: String(error),
    })
  }
}

/**
 * Dispatches a stacked git action through the main-process workflow service and
 * surfaces the outcome as a toast. Decision logic lives in resolveQuickAction;
 * this hook only runs the chosen action.
 */
export function useStackedGitActions({
  workingPath,
  onCompleted,
  onCommitCreated,
}: UseStackedGitActionsOptions) {
  const [isRunning, setIsRunning] = useState(false)
  const showToast = useUIStore((state) => state.showToast)

  async function run(action: GitStackedAction, options?: Partial<GitRunStackedActionOptions>) {
    if (!workingPath || isRunning || typeof api.runStackedGitAction !== 'function') return
    setIsRunning(true)
    try {
      const result = await api.runStackedGitAction(workingPath, { action, ...options })
      await reportCreatedCommit(result, options, onCommitCreated)
      if (result.ok) {
        showToast(
          result.changeRequest ? `Opened ${result.changeRequest.url}` : 'Git action completed.',
          'success',
        )
      } else {
        showToast(result.message, 'error')
      }
      onCompleted?.()
      return result
    } catch (error) {
      logger.warn('Stacked git action failed', { error: String(error) })
      showToast('Git action failed.', 'error')
    } finally {
      setIsRunning(false)
    }
  }

  return { isRunning, run }
}
