import type { SubAgentId } from '@shared/types/brand'
import type { SubAgentResult } from '@shared/types/sub-agent'
import { formatErrorMessage } from '@shared/utils/node-error'
import { createLogger } from '../logger'

const logger = createLogger('background-executor')

const MAX_CONCURRENT_BACKGROUND = 4

type CompletionCallback = (result: SubAgentResult) => void

interface BackgroundTask {
  readonly agentId: SubAgentId
  readonly abortController: AbortController
  readonly promise: Promise<SubAgentResult>
  readonly onComplete?: CompletionCallback
}

const activeTasks = new Map<SubAgentId, BackgroundTask>()

export function getBackgroundCount(): number {
  return activeTasks.size
}

export function canStartBackground(): boolean {
  return activeTasks.size < MAX_CONCURRENT_BACKGROUND
}

export function startBackground(
  agentId: SubAgentId,
  runner: (signal: AbortSignal) => Promise<SubAgentResult>,
  onComplete?: CompletionCallback,
): AbortController {
  if (!canStartBackground()) {
    throw new Error(
      `Cannot start background agent: ${String(activeTasks.size)}/${String(MAX_CONCURRENT_BACKGROUND)} slots in use`,
    )
  }

  const abortController = new AbortController()

  const promise = runner(abortController.signal).then(
    (result) => {
      activeTasks.delete(agentId)
      logger.info('Background agent completed', {
        agentId,
        status: result.status,
      })
      onComplete?.(result)
      return result
    },
    (error) => {
      activeTasks.delete(agentId)
      const failedResult: SubAgentResult = {
        agentId,
        status: 'failed',
        output: formatErrorMessage(error),
        turnCount: 0,
        toolCallCount: 0,
      }
      logger.error('Background agent failed', {
        agentId,
        error: formatErrorMessage(error),
      })
      onComplete?.(failedResult)
      return failedResult
    },
  )

  activeTasks.set(agentId, { agentId, abortController, promise, onComplete })
  logger.info('Background agent started', { agentId })

  return abortController
}

export function cancelBackground(agentId: SubAgentId): boolean {
  const task = activeTasks.get(agentId)
  if (!task) return false

  task.abortController.abort()
  logger.info('Background agent cancelled', { agentId })
  return true
}

export function isBackgroundRunning(agentId: SubAgentId): boolean {
  return activeTasks.has(agentId)
}

export function clearAllBackground(): void {
  for (const task of activeTasks.values()) {
    task.abortController.abort()
  }
  activeTasks.clear()
}
