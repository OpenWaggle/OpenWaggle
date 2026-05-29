import type { AgentSession, SessionEntry } from '@mariozechner/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  parsePiWaggleTurnDetails,
} from '@openwaggle/pi-waggle/protocol'
import { parseJsonUnknown } from '@shared/schema'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import { projectionForPiEntry } from './entry-projections'

interface PiSessionSnapshotSource {
  readonly sessionManager: Pick<AgentSession['sessionManager'], 'getEntries' | 'getLeafId'>
}

type PiMessageEntry = Extract<SessionEntry, { type: 'message' }>
type PiAssistantMessageEntry = PiMessageEntry & {
  readonly message: Extract<PiMessageEntry['message'], { role: 'assistant' }>
}
type PiUserMessageEntry = PiMessageEntry & {
  readonly message: Extract<PiMessageEntry['message'], { role: 'user' }>
}
type PiTurnCustomMessageEntry = Extract<SessionEntry, { type: 'custom_message' }>

function parsePiEntryTimestamp(timestamp: string) {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAssistantEntry(entry: SessionEntry): entry is PiAssistantMessageEntry {
  return entry.type === 'message' && entry.message.role === 'assistant'
}

function isUserMessageEntry(entry: SessionEntry): entry is PiUserMessageEntry {
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

function currentTurnMetadata(input: {
  readonly entry: PiAssistantMessageEntry
  readonly entryById: ReadonlyMap<string, SessionEntry>
}) {
  if (!input.entry.parentId) {
    return null
  }
  const parent = input.entryById.get(input.entry.parentId)
  if (!parent) {
    return null
  }
  if (isTurnCustomMessageEntry(parent)) {
    return turnMetadataFromCustomMessage({ entry: parent })
  }
  return isUserMessageEntry(parent) ? turnMetadataForPromptParent(parent, input.entryById) : null
}

function mergeMetadataJsonWithWaggle(rawMetadataJson: string, waggle: unknown) {
  const parsed = parseJsonUnknown(rawMetadataJson)
  const metadata = isRecord(parsed) ? parsed : {}
  return JSON.stringify({ ...metadata, waggle })
}

function projectPiEntry(input: {
  readonly entry: SessionEntry
  readonly entryById: ReadonlyMap<string, SessionEntry>
  readonly createdOrder: number
  readonly pathDepth: number
}): ProjectedSessionNodeInput {
  const timestampMs = parsePiEntryTimestamp(input.entry.timestamp)
  const projection = projectionForPiEntry(input.entry)
  const waggleMetadata = isAssistantEntry(input.entry)
    ? currentTurnMetadata({ entry: input.entry, entryById: input.entryById })
    : null

  return {
    id: input.entry.id,
    parentId: input.entry.parentId,
    piEntryType: input.entry.type,
    kind: projection.kind,
    role: projection.role,
    timestampMs,
    contentJson: projection.contentJson,
    metadataJson: waggleMetadata
      ? mergeMetadataJsonWithWaggle(projection.metadataJson, waggleMetadata)
      : projection.metadataJson,
    pathDepth: input.pathDepth,
    createdOrder: input.createdOrder,
  }
}

function getPiEntryDepth(input: {
  readonly entryId: string
  readonly entryById: ReadonlyMap<string, SessionEntry>
  readonly depthById: Map<string, number>
}): number {
  const cached = input.depthById.get(input.entryId)
  if (cached !== undefined) {
    return cached
  }

  const entry = input.entryById.get(input.entryId)
  if (!entry?.parentId) {
    input.depthById.set(input.entryId, 0)
    return 0
  }

  const depth =
    getPiEntryDepth({
      entryId: entry.parentId,
      entryById: input.entryById,
      depthById: input.depthById,
    }) + 1
  input.depthById.set(input.entryId, depth)
  return depth
}

export function projectPiSessionSnapshot(session: PiSessionSnapshotSource) {
  const entries = session.sessionManager.getEntries()
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  const depthById = new Map<string, number>()

  return {
    activeNodeId: session.sessionManager.getLeafId(),
    nodes: entries.map((entry, index) =>
      projectPiEntry({
        entry,
        entryById,
        createdOrder: index,
        pathDepth: getPiEntryDepth({ entryId: entry.id, entryById, depthById }),
      }),
    ),
  }
}
