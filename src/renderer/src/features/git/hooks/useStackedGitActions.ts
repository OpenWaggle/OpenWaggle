import type { WorkingPath } from '@shared/types/brand'
import type { GitRunStackedActionOptions, GitStackedAction } from '@shared/types/git'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('git')

interface UseStackedGitActionsOptions {
  readonly workingPath: WorkingPath | null
  readonly onCompleted?: () => void
}

/**
 * Dispatches a stacked git action through the main-process workflow service and
 * surfaces the outcome as a toast. Decision logic lives in resolveQuickAction;
 * this hook only runs the chosen action.
 */
export function useStackedGitActions({ workingPath, onCompleted }: UseStackedGitActionsOptions) {
  const [isRunning, setIsRunning] = useState(false)
  const showToast = useUIStore((state) => state.showToast)

  async function run(action: GitStackedAction, options?: Partial<GitRunStackedActionOptions>) {
    if (!workingPath || isRunning || typeof api.runStackedGitAction !== 'function') return
    setIsRunning(true)
    try {
      const result = await api.runStackedGitAction(workingPath, { action, ...options })
      if (result.ok) {
        showToast(
          result.changeRequest ? `Opened ${result.changeRequest.url}` : 'Git action completed.',
          'success',
        )
      } else {
        showToast(result.message, 'error')
      }
      onCompleted?.()
    } catch (error) {
      logger.warn('Stacked git action failed', { error: String(error) })
      showToast('Git action failed.', 'error')
    } finally {
      setIsRunning(false)
    }
  }

  return { isRunning, run }
}
