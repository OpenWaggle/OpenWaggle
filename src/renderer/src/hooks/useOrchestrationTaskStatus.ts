import type { ConversationId } from '@shared/types/brand'
import type {
  OrchestrationEventPayload,
  OrchestrationOutputValue,
  OrchestrationTaskStatus,
} from '@shared/types/orchestration'
import { choose } from '@shared/utils/decision'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/ipc'

export interface TaskLiveStatus {
  readonly status: OrchestrationTaskStatus
  readonly output?: string
  readonly error?: string
}

type TaskStatusMap = ReadonlyMap<string, TaskLiveStatus>

const EMPTY_MAP: TaskStatusMap = new Map()

const TERMINAL_STATUSES = new Set<OrchestrationTaskStatus>(['completed', 'failed', 'cancelled'])

function extractOutputText(output: OrchestrationOutputValue | undefined): string | undefined {
  if (output === undefined || output === null) return undefined
  if (typeof output === 'string') return output
  if (typeof output === 'object' && 'text' in output && typeof output.text === 'string') {
    return output.text
  }
  return JSON.stringify(output)
}

function resolveTaskStatus(event: OrchestrationEventPayload): TaskLiveStatus | undefined {
  return choose(event.type)
    .case('task_queued', (): TaskLiveStatus => ({ status: 'queued' }))
    .case('task_started', (): TaskLiveStatus => ({ status: 'running' }))
    .case('task_retried', (): TaskLiveStatus => ({ status: 'retrying' }))
    .case('task_succeeded', (): TaskLiveStatus => {
      const output =
        event.detail?.type === 'task_succeeded' ? extractOutputText(event.detail.output) : undefined
      return { status: 'completed', output }
    })
    .case('task_failed', (): TaskLiveStatus => {
      const error = event.detail?.type === 'task_failed' ? event.detail.error : undefined
      return { status: 'failed', error }
    })
    .catchAll(() => undefined)
}

function applyEvent(
  prev: Map<string, TaskLiveStatus>,
  event: OrchestrationEventPayload,
): Map<string, TaskLiveStatus> {
  if (event.type === 'run_cancelled') {
    const next = new Map(prev)
    for (const [taskId, entry] of next) {
      if (!TERMINAL_STATUSES.has(entry.status)) {
        next.set(taskId, { ...entry, status: 'cancelled' })
      }
    }
    return next
  }

  const { taskId } = event
  if (!taskId) return prev

  const status = resolveTaskStatus(event)
  if (!status) return prev

  const next = new Map(prev)
  next.set(taskId, status)
  return next
}

/**
 * Subscribe to orchestration lifecycle events for the active conversation
 * and maintain per-task status. Returns a lookup function.
 */
export function useOrchestrationTaskStatus(
  conversationId: ConversationId | null,
): (taskId: string) => TaskLiveStatus | undefined {
  const [statusMap, setStatusMap] = useState<TaskStatusMap>(EMPTY_MAP)
  const mapRef = useRef<Map<string, TaskLiveStatus>>(new Map())

  useEffect(() => {
    if (!conversationId) return

    mapRef.current = new Map()
    setStatusMap(EMPTY_MAP)

    const unsub = api.onOrchestrationEvent((payload) => {
      if (payload.conversationId !== conversationId) return
      const updated = applyEvent(mapRef.current, payload)
      if (updated !== mapRef.current) {
        mapRef.current = updated
        setStatusMap(updated)
      }
    })

    return unsub
  }, [conversationId])

  return (taskId: string) => statusMap.get(taskId)
}
