import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  parsePiWaggleTurnDetails,
} from '@openwaggle/pi-waggle/protocol'

type PiMessageEntry = Extract<SessionEntry, { type: 'message' }>
export type PiAssistantMessageEntry = PiMessageEntry & {
  readonly message: Extract<PiMessageEntry['message'], { role: 'assistant' }>
}
type PiUserMessageEntry = PiMessageEntry & {
  readonly message: Extract<PiMessageEntry['message'], { role: 'user' }>
}
type PiTurnCustomMessageEntry = Extract<SessionEntry, { type: 'custom_message' }>

export function isUserMessageEntry(entry: SessionEntry): entry is PiUserMessageEntry {
  return entry.type === 'message' && entry.message.role === 'user'
}

function isTurnCustomMessageEntry(entry: SessionEntry): entry is PiTurnCustomMessageEntry {
  return entry.type === 'custom_message' && entry.customType === PI_WAGGLE_TURN_CUSTOM_TYPE
}

function turnMetadataFromCustomMessage(input: { readonly entry: PiTurnCustomMessageEntry }) {
  const details = parsePiWaggleTurnDetails(input.entry.details)
  if (!details) return null

  return {
    agentIndex: details.agentIndex,
    agentLabel: details.agentLabel,
    agentColor: details.agentColor,
    agentModel: details.agentModel,
    turnNumber: details.turnNumber,
    sessionId: details.runId,
  }
}

function turnMetadataForPromptParent(
  parent: PiUserMessageEntry,
  entryById: ReadonlyMap<string, SessionEntry>,
) {
  if (!parent.parentId) {
    return null
  }
  const turnParent = entryById.get(parent.parentId)
  return turnParent && isTurnCustomMessageEntry(turnParent)
    ? turnMetadataFromCustomMessage({ entry: turnParent })
    : null
}

/** Entries the model never sees as a message, which a turn's response can follow. */
const UNSEEN_ENTRY_TYPES: ReadonlySet<SessionEntry['type']> = new Set<SessionEntry['type']>([
  // A context edit drops an attempt Pi retried.
  'context_edit',
  // Such as the Run identity OpenWaggle stores before a Run's first response.
  'custom',
  // Overflow compaction in the middle of a turn.
  'compaction',
  'model_change',
  'thinking_level_change',
  'label',
  'session_info',
  'usage',
])

/**
 * An entry a turn's later response can follow: an earlier response of the turn (a tool call or a
 * failed attempt), a tool result, or an entry the model does not see.
 */
function continuesTurn(entry: SessionEntry) {
  if (UNSEEN_ENTRY_TYPES.has(entry.type)) return true
  return (
    entry.type === 'message' &&
    (entry.message.role === 'assistant' || entry.message.role === 'toolResult')
  )
}

/** The entry a response's turn starts from: its parent, past the turn's earlier work. */
function turnStartEntry(
  entry: PiAssistantMessageEntry,
  entryById: ReadonlyMap<string, SessionEntry>,
) {
  let parent = entry.parentId ? entryById.get(entry.parentId) : undefined
  const visited = new Set<string>()
  while (parent && continuesTurn(parent) && parent.parentId && !visited.has(parent.id)) {
    visited.add(parent.id)
    parent = entryById.get(parent.parentId)
  }
  return parent
}

/** The Waggle turn a response belongs to, from the turn message its turn starts from. */
export function currentTurnMetadata(input: {
  readonly entry: PiAssistantMessageEntry
  readonly entryById: ReadonlyMap<string, SessionEntry>
}) {
  const parent = turnStartEntry(input.entry, input.entryById)
  if (!parent) {
    return null
  }
  if (isTurnCustomMessageEntry(parent)) {
    return turnMetadataFromCustomMessage({ entry: parent })
  }
  return isUserMessageEntry(parent) ? turnMetadataForPromptParent(parent, input.entryById) : null
}
