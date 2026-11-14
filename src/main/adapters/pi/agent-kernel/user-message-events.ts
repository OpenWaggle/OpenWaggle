import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import { PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import type { AgentTransportUserMessage } from '@shared/types/stream'
import { HIVE_WAKE_CUSTOM_TYPE, hiveWakeDisplay } from './hive-wake-prompt'
import { piUserContentToDisplayParts } from './message-parts'
import { findUserInputProjection } from './user-input-projection'
import { visibleWaggleUserMessageDisplay } from './visible-waggle-user-message-projection'

export type PiUserMessageEntrySource = Pick<
  AgentSession['sessionManager'],
  'getEntries' | 'getLeafId'
>

type PiMessageEntry = Extract<SessionEntry, { type: 'message' }>
type PiCustomMessageEntry = Extract<SessionEntry, { type: 'custom_message' }>
type PiUserMessage = Extract<PiMessageEntry['message'], { role: 'user' }>
type PiCustomMessage = Extract<PiMessageEntry['message'], { role: 'custom' }>

function logPosition(source: PiUserMessageEntrySource, appended: (entry: SessionEntry) => boolean) {
  const entries = source.getEntries()
  const entryById = new Map<string, SessionEntry>(entries.map((entry) => [entry.id, entry]))
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && appended(entry)) {
      return { createdOrder: index, parentId: entry.parentId, entryById, entry }
    }
  }
  // Not appended yet: Pi appends the entry as the child of the current leaf, at the end of the log.
  return { createdOrder: entries.length, parentId: source.getLeafId(), entryById, entry: null }
}

/**
 * The transcript content of a user message Pi has just incorporated, projected exactly as its
 * persisted user node is. Pi notifies listeners of a user `message_end` before it appends the
 * entry, below the display projection recorded at `message_start`; if a Pi change appends first,
 * the entry holding this very message object is used instead.
 */
export function incorporatedUserMessageDisplay(
  source: PiUserMessageEntrySource,
  message: PiUserMessage,
) {
  const position = logPosition(
    source,
    (entry) => entry.type === 'message' && entry.message === message,
  )
  const projection = findUserInputProjection(position.parentId, position.entryById)
  const result: AgentTransportUserMessage = {
    // Without a recorded projection this is the snapshot's own fallback: the typed text only,
    // without synthesized attachment blocks, visualization context, or image payloads.
    parts: projection?.parts ?? piUserContentToDisplayParts(message.content),
    sessionNodeCreatedOrder: position.createdOrder,
    ...(projection?.durableTextSha256 ? { durableTextSha256: projection.durableTextSha256 } : {}),
    ...(projection?.scheduledTask ? { scheduledTask: projection.scheduledTask } : {}),
  }
  return result
}

export function isVisibleWaggleUserRequest(message: PiMessageEntry['message']) {
  return (
    message.role === 'custom' &&
    message.customType === PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE &&
    message.display
  )
}

function isEntryOfCustomMessage(entry: SessionEntry, message: PiCustomMessage) {
  return (
    entry.type === 'custom_message' &&
    entry.customType === message.customType &&
    entry.content === message.content &&
    entry.details === message.details
  )
}

/**
 * The transcript content of a visible Waggle user request, projected from the entry Pi appended
 * for it. An idle session appends a custom message before notifying listeners, so the entry is
 * found by the message's own content and details; during a Run Pi appends it right after.
 */
export function incorporatedWaggleUserRequestDisplay(
  source: PiUserMessageEntrySource,
  message: PiCustomMessage,
) {
  const position = logPosition(source, (entry) => isEntryOfCustomMessage(entry, message))
  const entry: Pick<PiCustomMessageEntry, 'customType' | 'content' | 'display' | 'details'> =
    position.entry?.type === 'custom_message' ? position.entry : message
  const display = visibleWaggleUserMessageDisplay(entry)
  return {
    parts: display.parts,
    sessionNodeCreatedOrder: position.createdOrder,
    ...(display.waggleInvocation ? { waggleInvocation: display.waggleInvocation } : {}),
  }
}

/** The transcript row of a Hive wake message, at the log position of the entry Pi appended. */
export function incorporatedHiveWakeDisplay(
  source: PiUserMessageEntrySource,
  message: PiCustomMessage,
) {
  return hiveWakeDisplay(
    logPosition(source, (entry) => isEntryOfCustomMessage(entry, message)).createdOrder,
  )
}

/**
 * How a custom message the Run incorporated is shown as a user row, if it is one: a visible
 * Waggle user request, or the Host's Hive wake notice. Any other custom message is not a row.
 */
export function incorporatedCustomMessageDisplay(message: PiCustomMessage) {
  if (isVisibleWaggleUserRequest(message)) {
    return (source: PiUserMessageEntrySource) =>
      incorporatedWaggleUserRequestDisplay(source, message)
  }
  if (message.customType === HIVE_WAKE_CUSTOM_TYPE) {
    return (source: PiUserMessageEntrySource) => incorporatedHiveWakeDisplay(source, message)
  }
  return null
}
