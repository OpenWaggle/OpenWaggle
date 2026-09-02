import {
  WORKTREE_CREATED_CUSTOM_EVENT,
  type WorktreeLaunchSnapshot,
} from '@shared/types/background-run'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import type { ChatRow } from './types-chat-row'

export function isWorktreeCreatedEvent(event: AgentTransportCustomEvent) {
  return event.name === WORKTREE_CREATED_CUSTOM_EVENT
}

function launchFromCustomEvent(event: AgentTransportCustomEvent): WorktreeLaunchSnapshot | null {
  if (
    !isWorktreeCreatedEvent(event) ||
    typeof event.value !== 'object' ||
    event.value === null ||
    Array.isArray(event.value)
  ) {
    return null
  }
  const eventValue = event.value
  const detailsValue = eventValue.details
  const details = Array.isArray(detailsValue)
    ? detailsValue.filter((detail): detail is string => typeof detail === 'string')
    : []
  const stringValue = (key: 'worktreePath' | 'branch' | 'baseRef') => {
    const value = eventValue[key]
    return typeof value === 'string' ? value : undefined
  }
  const worktreePath = stringValue('worktreePath')
  const branch = stringValue('branch')
  const baseRef = stringValue('baseRef')
  return {
    status: 'complete',
    stage: 'starting-task',
    startedAt: event.timestamp,
    updatedAt: event.timestamp,
    details,
    ...(worktreePath ? { worktreePath } : {}),
    ...(branch ? { branch } : {}),
    ...(baseRef ? { baseRef } : {}),
  }
}

export function createWorktreeLaunchRows(input: {
  readonly sessionId: string | null
  readonly liveLaunch?: WorktreeLaunchSnapshot | null
  readonly customMessages: readonly AgentTransportCustomEvent[]
}): ChatRow[] {
  const sessionId = input.sessionId
  if (!sessionId) return []
  if (input.liveLaunch) {
    return [
      {
        type: 'worktree-launch',
        id: `active:${sessionId}`,
        sessionId,
        launch: input.liveLaunch,
      },
    ]
  }
  return input.customMessages.flatMap((event) => {
    const launch = launchFromCustomEvent(event)
    return launch
      ? [
          {
            type: 'worktree-launch',
            id: `persisted:${String(event.timestamp)}`,
            sessionId,
            launch,
          },
        ]
      : []
  })
}
