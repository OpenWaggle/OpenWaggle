import type { SessionId, WorkingPath } from '@shared/types/brand'
import type {
  GitActionProgressEvent,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStackedAction,
} from '@shared/types/git'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('git')

interface UseStackedGitActionsOptions {
  readonly workingPath: WorkingPath | null
  readonly sessionId?: SessionId
  readonly onCompleted?: () => void
}

function stackedActionToast(result: Awaited<ReturnType<typeof api.runStackedGitAction>>) {
  if (!result.ok) {
    const outputMessage = result.commitOutput?.ok === false ? result.commitOutput.message : null
    return {
      message: outputMessage ? `${result.message} ${outputMessage}` : result.message,
      variant: 'error' as const,
    }
  }
  const outputFailure =
    result.changeRequestOutput?.ok === false
      ? result.changeRequestOutput
      : result.commitOutput?.ok === false
        ? result.commitOutput
        : null
  return outputFailure
    ? { message: outputFailure.message, variant: 'error' as const }
    : {
        message: result.changeRequest
          ? `Opened ${result.changeRequest.url}`
          : 'Git action completed.',
        variant: 'success' as const,
      }
}

/**
 * Dispatches a stacked git action through the main-process workflow service and
 * surfaces the outcome as a toast. Decision logic lives in resolveQuickAction;
 * this hook only runs the chosen action.
 */
export function useStackedGitActions({
  workingPath,
  sessionId,
  onCompleted,
}: UseStackedGitActionsOptions) {
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<GitActionProgressEvent | null>(null)
  const activeOperationId = useRef<string | null>(null)
  const runningRef = useRef(false)
  const showToast = useUIStore((state) => state.showToast)

  useEffect(() => {
    if (typeof api.onGitStackedActionProgress !== 'function') return
    return api.onGitStackedActionProgress((payload) => {
      if (
        payload.operationId === activeOperationId.current &&
        payload.workingPath === workingPath
      ) {
        setProgress(payload.progress)
      }
    })
  }, [workingPath])

  async function run(
    action: GitStackedAction,
    options?: Partial<GitRunStackedActionOptions>,
  ): Promise<GitRunStackedActionResult | undefined> {
    if (!workingPath || runningRef.current || typeof api.runStackedGitAction !== 'function') return
    const operationId = crypto.randomUUID()
    runningRef.current = true
    activeOperationId.current = operationId
    setIsRunning(true)
    setProgress(null)
    try {
      const result = await api.runStackedGitAction(workingPath, {
        action,
        sessionId,
        ...options,
        operationId,
      })
      const toast = stackedActionToast(result)
      showToast(toast.message, toast.variant)
      onCompleted?.()
      return result
    } catch (error) {
      logger.warn('Stacked git action failed', { error: String(error) })
      showToast('Git action failed.', 'error')
      return undefined
    } finally {
      runningRef.current = false
      activeOperationId.current = null
      setIsRunning(false)
    }
  }

  async function cancel() {
    const operationId = activeOperationId.current
    if (!operationId || typeof api.cancelStackedGitAction !== 'function') return false
    return api.cancelStackedGitAction(operationId)
  }

  return { isRunning, progress, run, cancel }
}
