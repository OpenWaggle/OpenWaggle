import {
  WORKTREE_CREATED_CUSTOM_EVENT,
  type WorktreeLaunchSnapshot,
  type WorktreeSetupActionTerminal,
} from '@shared/types/background-run'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import type { ChatRow } from './types-chat-row'
import { isObjectValue, uncheckedFields } from '@shared/utils/object-shape'

/** The value of a worktree-created event, as the Host emits it. */
interface WorktreeCreatedValue {
  readonly details: readonly string[]
  readonly worktreePath: string
  readonly branch: string
  readonly baseRef: string
  readonly setupAction: WorktreeSetupActionTerminal
}

export function isWorktreeCreatedEvent(event: AgentTransportCustomEvent) {
  return event.name === WORKTREE_CREATED_CUSTOM_EVENT
}

function setupActionFromValue(value: unknown): WorktreeSetupActionTerminal | undefined {
  const { terminalId, actionId, actionName, projectRoot, cwd } =
    uncheckedFields<WorktreeSetupActionTerminal>(value)
  if (
    typeof terminalId !== 'string' ||
    typeof actionId !== 'string' ||
    typeof actionName !== 'string' ||
    typeof projectRoot !== 'string' ||
    typeof cwd !== 'string'
  ) {
    return undefined
  }
  return { terminalId, actionId, actionName, projectRoot, cwd }
}

export function worktreeLaunchFromCustomEvent(
  event: AgentTransportCustomEvent,
): WorktreeLaunchSnapshot | null {
  if (!isWorktreeCreatedEvent(event) || !isObjectValue(event.value)) {
    return null
  }
  const fields = uncheckedFields<WorktreeCreatedValue>(event.value)
  const details = Array.isArray(fields.details)
    ? fields.details.filter((detail): detail is string => typeof detail === 'string')
    : []
  const stringValue = (value: unknown) => (typeof value === 'string' ? value : undefined)
  const worktreePath = stringValue(fields.worktreePath)
  const branch = stringValue(fields.branch)
  const baseRef = stringValue(fields.baseRef)
  const setupAction = setupActionFromValue(fields.setupAction)
  return {
    status: 'complete',
    stage: 'starting-task',
    startedAt: event.timestamp,
    updatedAt: event.timestamp,
    details,
    ...(worktreePath ? { worktreePath } : {}),
    ...(branch ? { branch } : {}),
    ...(baseRef ? { baseRef } : {}),
    ...(setupAction ? { setupAction } : {}),
  }
}

export function createWorktreeLaunchRows(input: {
  readonly sessionId: string | null
  readonly liveLaunch?: WorktreeLaunchSnapshot | null | undefined
  readonly customMessages: readonly AgentTransportCustomEvent[]
}): ChatRow[] {
  const sessionId = input.sessionId
  if (!sessionId) return []
  if (input.liveLaunch) {
    // A finished local launch has nothing left to say; the run it started takes over.
    if (input.liveLaunch.environment === 'local' && input.liveLaunch.status === 'complete') {
      return []
    }
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
    const launch = worktreeLaunchFromCustomEvent(event)
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
