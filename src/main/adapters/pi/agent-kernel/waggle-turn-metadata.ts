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

type TurnStart = SessionEntry | undefined

/**
 * The entry a response's turn starts from: the first of its ancestors, from its parent up, that
 * is not the turn's earlier work. Every entry of a chain it walks gets the same start, so a turn of
 * N tool calls is walked once, not once per response; the walk is a loop, so a deep chain cannot
 * overflow the stack.
 */
function createTurnStartResolver(entryById: ReadonlyMap<string, SessionEntry>) {
  const startById = new Map<string, TurnStart>()
  return (first: SessionEntry | undefined): TurnStart => {
    const walked = new Set<string>()
    let entry = first
    let start: TurnStart
    let resolved = false
    while (entry && !resolved) {
      // A start already found, or a cycle, which has none.
      if (startById.has(entry.id) || walked.has(entry.id)) {
        start = startById.get(entry.id)
        resolved = true
        continue
      }
      walked.add(entry.id)
      if (!continuesTurn(entry) || !entry.parentId) {
        start = entry
        resolved = true
        continue
      }
      entry = entryById.get(entry.parentId)
    }
    for (const id of walked) startById.set(id, start)
    return start
  }
}

/**
 * The Waggle turn of each response, from the turn message its turn starts from. Built once per
 * projection; a Session with no Waggle turn message has no turns to find.
 */
export function createWaggleTurnMetadataResolver(
  entries: readonly SessionEntry[],
  entryById: ReadonlyMap<string, SessionEntry>,
) {
  if (!entries.some(isTurnCustomMessageEntry)) return () => null
  const turnStart = createTurnStartResolver(entryById)
  return (entry: PiAssistantMessageEntry) => {
    const parent = turnStart(entry.parentId ? entryById.get(entry.parentId) : undefined)
    if (!parent) return null
    if (isTurnCustomMessageEntry(parent)) return turnMetadataFromCustomMessage({ entry: parent })
    return isUserMessageEntry(parent) ? turnMetadataForPromptParent(parent, entryById) : null
  }
}
