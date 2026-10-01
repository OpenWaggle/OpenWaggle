import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import type { AgentTransportUserMessage } from '@shared/types/stream'
import { piTextAndImageContentToParts } from './message-parts'
import { findUserInputProjection } from './user-input-projection'

export type PiUserMessageEntrySource = Pick<
  AgentSession['sessionManager'],
  'getEntries' | 'getLeafId'
>

/**
 * The transcript content of the user message Pi is about to append, projected exactly as its
 * persisted user node will be. Pi notifies listeners of a user `message_end` before it appends the
 * entry, so the entry becomes the child of the current leaf at the next native log order, below
 * the display projection recorded at `message_start`.
 */
export function pendingUserMessageDisplay(
  source: PiUserMessageEntrySource,
  content: unknown,
): AgentTransportUserMessage {
  const entries = source.getEntries()
  const entryById = new Map<string, SessionEntry>(entries.map((entry) => [entry.id, entry]))
  const projection = findUserInputProjection(source.getLeafId(), entryById)
  return {
    parts: projection?.parts ?? piTextAndImageContentToParts(content),
    sessionNodeCreatedOrder: entries.length,
    ...(projection?.durableTextSha256 ? { durableTextSha256: projection.durableTextSha256 } : {}),
  }
}
