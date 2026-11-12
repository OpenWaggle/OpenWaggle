import { Schema } from '@shared/schema'
import { worktreeSetupActionTerminalSchema } from '@shared/schemas/background-run'
import { lenientArray } from '@shared/schemas/lenient'
import { lenientExactOptional } from '@shared/schemas/lenient-exact'
import {
  WORKTREE_CREATED_CUSTOM_EVENT,
  type WorktreeLaunchSnapshot,
} from '@shared/types/background-run'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import { isObjectValue } from '@shared/utils/object-shape'
import { Option } from 'effect'
import type { ChatRow } from './types-chat-row'

/**
 * The value of a worktree-created event, as the Host emits it. Persisted history is read
 * tolerantly: a malformed or empty field is left out, and only the string details are kept.
 */
const decodeWorktreeCreatedValue = Schema.decodeUnknownOption(
  Schema.Struct({
    details: lenientArray(Schema.String),
    worktreePath: lenientExactOptional(Schema.NonEmptyString),
    branch: lenientExactOptional(Schema.NonEmptyString),
    baseRef: lenientExactOptional(Schema.NonEmptyString),
    setupAction: lenientExactOptional(worktreeSetupActionTerminalSchema),
  }),
)

export function isWorktreeCreatedEvent(event: AgentTransportCustomEvent) {
  return event.name === WORKTREE_CREATED_CUSTOM_EVENT
}

export function worktreeLaunchFromCustomEvent(
  event: AgentTransportCustomEvent,
): WorktreeLaunchSnapshot | null {
  if (!isWorktreeCreatedEvent(event) || !isObjectValue(event.value)) return null
  const value = decodeWorktreeCreatedValue(event.value)
  if (Option.isNone(value)) return null
  return {
    status: 'complete',
    stage: 'starting-task',
    startedAt: event.timestamp,
    updatedAt: event.timestamp,
    ...value.value,
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
