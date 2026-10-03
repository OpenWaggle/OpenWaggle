import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import { PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import type { AgentTransportUserMessage } from '@shared/types/stream'
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

/** Where a just-incorporated message sits in the native Session log. */
interface IncorporatedEntryPosition {
  readonly createdOrder: number
  readonly parentId: string | null
  readonly entryById: ReadonlyMap<string, SessionEntry>
}

function logPosition(
  source: PiUserMessageEntrySource,
  appended: (entry: SessionEntry) => boolean,
): IncorporatedEntryPosition & { readonly entry: SessionEntry | null } {
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
): AgentTransportUserMessage {
  const position = logPosition(
    source,
    (entry) => entry.type === 'message' && entry.message === message,
  )
  const projection = findUserInputProjection(position.parentId, position.entryById)
  return {
    // Without a recorded projection this is the snapshot's own fallback: the typed text only,
    // without synthesized attachment blocks, visualization context, or image payloads.
    parts: projection?.parts ?? piUserContentToDisplayParts(message.content),
    sessionNodeCreatedOrder: position.createdOrder,
    ...(projection?.durableTextSha256 ? { durableTextSha256: projection.durableTextSha256 } : {}),
  }
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
): AgentTransportUserMessage {
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
